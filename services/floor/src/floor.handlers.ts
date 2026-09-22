/**
 * SOT: floor-handlers, table-handlers, parameter-handlers, parameter-validation
 * WHAT   Business rules for the floor plan and the custom parameter engine.
 * WHY    The engine is generic, which means the type safety has to be enforced at runtime:
 *        a parameter declares a data type, and a value assigned against it is checked against
 *        that type here. Without this the generic engine is just a JSONB column.
 * HOW    A guest sees customer-visible parameters only. The internal ones - "VIP booth",
 *        "staff table" - never leave this service on a guest's request.
 * WHERE  services/floor/src/floor.service.ts
 */
import "server-only";

import { type InputOf, placeHoldsAParty, ServiceError } from "@foodos/contracts";
import { handlerFor, type ServiceContext, serviceCall } from "@foodos/core";
import { env } from "@foodos/env";

import { parameterService, placeService, sectionService } from "./floor.service";
import type {
  ParameterDefinitionRow,
  PlaceParameterValueRow,
  PlaceRow,
  SectionRow,
} from "./schema";

type CreateInput = InputOf<"place", "create">;
type CreateOneInput = Extract<CreateInput, { mode: "one" }>;
type CreateGridInput = Extract<CreateInput, { mode: "grid" }>;
type ParameterValue = CreateInput["parameters"][number]["value"];
type ManageInput = InputOf<"place", "manage">;

const PLACE_STATUSES = ["available", "occupied", "reserved", "cleaning", "disabled"] as const;
const PLACE_KINDS = ["table", "seat"] as const;
const PLACE_SHAPES = ["rect", "square", "circle"] as const;
const DATA_TYPES = ["text", "number", "boolean", "select", "multi_select"] as const;
const CATEGORIES = ["seating", "ambience", "location", "service", "custom"] as const;

type TableStatus = (typeof PLACE_STATUSES)[number];
type PlaceKind = (typeof PLACE_KINDS)[number];
type TableShape = (typeof PLACE_SHAPES)[number];
type DataType = (typeof DATA_TYPES)[number];
type Category = (typeof CATEGORIES)[number];

const asKind = (value: string): PlaceKind =>
  PLACE_KINDS.find((candidate) => candidate === value) ?? "table";

const asStatus = (value: string): TableStatus =>
  PLACE_STATUSES.find((candidate) => candidate === value) ?? "available";
const asShape = (value: string): TableShape =>
  PLACE_SHAPES.find((candidate) => candidate === value) ?? "rect";
const asDataType = (value: string): DataType =>
  DATA_TYPES.find((candidate) => candidate === value) ?? "text";
const asCategory = (value: string): Category =>
  CATEGORIES.find((candidate) => candidate === value) ?? "custom";

const set = <T>(value: T | undefined, key: string): Record<string, T> =>
  value === undefined ? {} : { [key]: value };

/**
 * The runtime half of the parameter engine's type safety. A definition says what shape its
 * values take; this is what makes that promise true, because JSONB will hold anything and a
 * "number" parameter holding the string "four" is a filter that silently matches nothing.
 */
function assertValueMatches(definition: ParameterDefinitionRow, value: ParameterValue): void {
  const type = asDataType(definition.dataType);
  const wrong = (expected: string): never => {
    throw new ServiceError("INVALID_INPUT", `"${definition.label}" expects ${expected}.`);
  };

  switch (type) {
    case "text":
      if (typeof value !== "string") wrong("some text");
      return;
    case "number":
      if (typeof value !== "number") wrong("a number");
      return;
    case "boolean":
      if (typeof value !== "boolean") wrong("yes or no");
      return;
    case "select":
      if (typeof value !== "string" || !definition.options.includes(value)) {
        wrong(`one of: ${definition.options.join(", ")}`);
      }
      return;
    default:
      if (!Array.isArray(value) || value.some((entry) => !definition.options.includes(entry))) {
        wrong(`any of: ${definition.options.join(", ")}`);
      }
  }
}

/** JSONB comes back as unknown. Narrowed here, once, rather than trusted at each read. */
function readValue(value: unknown): ParameterValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  return "";
}

function toPlaceDto(args: {
  row: PlaceRow;
  sections: readonly SectionRow[];
  definitions: readonly ParameterDefinitionRow[];
  values: readonly PlaceParameterValueRow[];
  customerVisibleOnly: boolean;
}) {
  const mine = args.values.filter((value) => value.placeId === args.row.id);
  return {
    id: args.row.id,
    branchId: args.row.branchId,
    sectionId: args.row.sectionId,
    sectionName: args.sections.find((section) => section.id === args.row.sectionId)?.name ?? null,
    kind: asKind(args.row.kind),
    label: args.row.label,
    capacity: args.row.capacity,
    status: asStatus(args.row.status),
    shape: asShape(args.row.shape),
    rowLabel: args.row.rowLabel,
    columnNumber: args.row.columnNumber,
    positionX: args.row.positionX === null ? null : Number(args.row.positionX),
    positionY: args.row.positionY === null ? null : Number(args.row.positionY),
    isActive: args.row.isActive,
    parameters: mine.flatMap((value) => {
      const definition = args.definitions.find((entry) => entry.id === value.definitionId);
      if (definition === undefined || !definition.isActive) return [];
      if (args.customerVisibleOnly && !definition.isCustomerVisible) return [];
      return [
        {
          definitionId: definition.id,
          key: definition.key,
          label: definition.label,
          dataType: asDataType(definition.dataType),
          isCustomerVisible: definition.isCustomerVisible,
          value: readValue(value.value),
        },
      ];
    }),
    qrToken: null,
    createdAt: args.row.createdAt,
  };
}

const toDefinitionDto = (row: ParameterDefinitionRow) => ({
  id: row.id,
  key: row.key,
  label: row.label,
  description: row.description,
  dataType: asDataType(row.dataType),
  options: row.options,
  category: asCategory(row.category),
  isCustomerVisible: row.isCustomerVisible,
  isFilterable: row.isFilterable,
  isSystem: row.isSystem,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  createdAt: row.createdAt,
});

const toSectionDto = (row: SectionRow, placeCount: number) => ({
  id: row.id,
  branchId: row.branchId,
  name: row.name,
  floor: row.floor,
  sortOrder: row.sortOrder,
  placeCount,
  createdAt: row.createdAt,
});

/** Validates a whole assignment set against its definitions before any of it is written. */
async function checkedAssignments(
  organizationId: string,
  entries: ReadonlyArray<{ definitionId: string; value: ParameterValue }>,
) {
  if (entries.length === 0) return [];
  const definitions = await parameterService.byIds({
    organizationId,
    ids: entries.map((entry) => entry.definitionId),
  });
  return entries.map((entry) => {
    const definition = definitions.find((candidate) => candidate.id === entry.definitionId);
    if (definition === undefined) {
      throw new ServiceError("NOT_FOUND", "That table parameter does not exist.");
    }
    assertValueMatches(definition, entry.value);
    return entry;
  });
}

async function decorateTables(args: {
  organizationId: string;
  rows: readonly PlaceRow[];
  customerVisibleOnly: boolean;
}) {
  const [definitions, values] = await Promise.all([
    parameterService.all({ organizationId: args.organizationId }),
    parameterService.valuesFor({
      organizationId: args.organizationId,
      placeIds: args.rows.map((row) => row.id),
    }),
  ]);
  const sections = await sectionService.list({
    organizationId: args.organizationId,
    limit: 100,
    cursor: null,
  });
  return args.rows.map((row) =>
    toPlaceDto({
      row,
      sections: sections.items,
      definitions,
      values,
      customerVisibleOnly: args.customerVisibleOnly,
    }),
  );
}

export const placeHandlers = [
  handlerFor("place", "read", async ({ ctx, input }) => {
    const page = await placeService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.branchId, "branchId"),
      ...set(input.sectionId, "sectionId"),
      ...set(input.id, "id"),
      ...set(input.status, "status"),
      ...set(input.kind, "kind"),
      ...set(input.minCapacity, "minCapacity"),
    });

    /** A guest never sees an internal parameter, whatever they ask for. */
    const decorated = await decorateTables({
      organizationId: ctx.orgId,
      rows: page.items,
      customerVisibleOnly: ctx.role === "guest" || input.customerVisibleParametersOnly,
    });

    /**
     * Parameter filters are applied after decoration rather than in SQL: the values are JSONB
     * of five different shapes, and a query that had to know all five would be a query that
     * quietly stops matching the day a sixth is added.
     */
    const filtered =
      input.parameterFilters.length === 0
        ? decorated
        : decorated.filter((table) =>
            input.parameterFilters.every((wanted) =>
              table.parameters.some(
                (held) =>
                  held.definitionId === wanted.definitionId &&
                  JSON.stringify(held.value) === JSON.stringify(wanted.value),
              ),
            ),
          );

    return { items: filtered, nextCursor: page.nextCursor };
  }),

  handlerFor("place", "create", ({ ctx, input }) =>
    input.mode === "one" ? createOnePlace(ctx.orgId, input) : createPlaceGrid(ctx.orgId, input),
  ),

  handlerFor("place", "update", async ({ ctx, input }) => {
    const entries =
      input.parameters === undefined ? [] : await checkedAssignments(ctx.orgId, input.parameters);

    const updated = await placeService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.sectionId, "sectionId"),
        ...set(input.kind, "kind"),
        ...set(input.label, "label"),
        ...set(input.capacity, "capacity"),
        ...set(input.shape, "shape"),
        ...set(input.rowLabel, "rowLabel"),
        ...set(input.columnNumber, "columnNumber"),
        ...set(input.isActive, "isActive"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Table not found.");

    if (entries.length > 0) {
      await parameterService.assign({ organizationId: ctx.orgId, placeId: input.id, entries });
    }
    const [decorated] = await decorateTables({
      organizationId: ctx.orgId,
      rows: [updated],
      customerVisibleOnly: false,
    });
    if (decorated === undefined) throw new ServiceError("INTERNAL", "The table could not be read.");
    return decorated;
  }),

  handlerFor("place", "delete", async ({ ctx, input }) => {
    const removed = await placeService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Table not found.");
    return removed;
  }),

  handlerFor("place", "manage", ({ ctx, input }) => floorAction(ctx, input)),
];

async function createOnePlace(organizationId: string, input: CreateOneInput) {
  const clash = await placeService.byNumber({
    organizationId,
    branchId: input.branchId,
    label: input.label,
  });
  if (clash !== null) {
    throw new ServiceError("CONFLICT", `This branch already has a table ${input.label}.`);
  }
  const entries = await checkedAssignments(organizationId, input.parameters);

  const id = crypto.randomUUID();
  const created = await placeService.create({
    id,
    organizationId,
    branchId: input.branchId,
    sectionId: input.sectionId ?? null,
    kind: input.kind,
    label: input.label,
    capacity: input.capacity,
    shape: input.shape,
    rowLabel: input.rowLabel ?? null,
    columnNumber: input.columnNumber ?? null,
    positionX: input.positionX == null ? null : String(input.positionX),
    positionY: input.positionY == null ? null : String(input.positionY),
  });
  if (created === null) throw new ServiceError("INTERNAL", "The table was not created.");

  await parameterService.assign({ organizationId, placeId: id, entries });
  const [decorated] = await decorateTables({
    organizationId,
    rows: [created],
    customerVisibleOnly: false,
  });
  if (decorated === undefined) throw new ServiceError("INTERNAL", "The table could not be read.");
  return { places: [decorated], skipped: [] };
}

/**
 * Every place a grid asks for, deduplicated by label. A row list that repeats a letter would
 * otherwise ask for the same seat twice in one statement, and the unique index would refuse
 * the whole insert rather than the duplicate.
 */
function gridPlaces(input: CreateGridInput) {
  const wanted = new Map<string, { label: string; rowLabel: string; columnNumber: number }>();
  for (const row of input.rows) {
    for (let offset = 0; offset < input.columns; offset += 1) {
      const columnNumber = input.startColumn + offset;
      const label = `${input.labelPrefix}${row}${columnNumber}`;
      if (!wanted.has(label)) wanted.set(label, { label, rowLabel: row, columnNumber });
    }
  }
  return [...wanted.values()];
}

/**
 * A screen's seating in one call. Re-running it is safe: the insert conflicts on the labels
 * that already exist and leaves them exactly as they are, so the manager who is not sure the
 * first attempt landed can simply run it again and be told what was already there.
 */
async function createPlaceGrid(organizationId: string, input: CreateGridInput) {
  const entries = await checkedAssignments(organizationId, input.parameters);
  const wanted = gridPlaces(input);

  const created = await placeService.createMany(
    wanted.map((seat) => ({
      id: crypto.randomUUID(),
      organizationId,
      branchId: input.branchId,
      sectionId: input.sectionId ?? null,
      kind: input.kind,
      label: seat.label,
      capacity: input.capacity,
      shape: input.shape,
      rowLabel: seat.rowLabel,
      columnNumber: seat.columnNumber,
    })),
  );

  if (entries.length > 0) {
    for (const row of created) {
      await parameterService.assign({ organizationId, placeId: row.id, entries });
    }
  }

  const made = new Set(created.map((row) => row.label));
  const places =
    created.length === 0
      ? []
      : await decorateTables({ organizationId, rows: created, customerVisibleOnly: false });
  return { places, skipped: wanted.flatMap((seat) => (made.has(seat.label) ? [] : [seat.label])) };
}

async function floorAction(ctx: ServiceContext, input: ManageInput) {
  const organizationId = ctx.orgId;

  if (input.action === "set_status") {
    const updated = await placeService.update({
      organizationId,
      id: input.id,
      patch: { status: input.status },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Table not found.");

    /**
     * Clearing a table closes what it was holding, so the next party to scan this code starts
     * an empty basket instead of walking into the last party's dishes. Orders owns the basket
     * and this service owns the table, so it is asked over the bus rather than joined to.
     *
     * The status is written FIRST and deliberately. There is no transaction spanning two
     * services, so one of the two has to be able to fail after the other committed, and the
     * orders are not equally bad: a table freed whose basket is still open is the bug this
     * fixes, while a basket closed under a table that is still occupied would throw away a
     * party's order mid-meal. So the survivable failure is the one left possible - and
     * because closing is idempotent, sending the same status again finishes the job.
     */
    if (!placeHoldsAParty(input.status)) {
      await serviceCall({
        ctx,
        resource: "cart",
        operation: "manage",
        input: { action: "close_at_place", placeId: input.id },
        secret: env.envelopeSecret(),
      });
    }
    return { changed: 1 };
  }

  if (input.action === "move") {
    let changed = 0;
    for (const position of input.positions) {
      const updated = await placeService.update({
        organizationId,
        id: position.id,
        patch: { positionX: String(position.positionX), positionY: String(position.positionY) },
      });
      if (updated !== null) changed += 1;
    }
    return { changed };
  }

  const entries = await checkedAssignments(organizationId, input.parameters);
  for (const placeId of input.ids) {
    await parameterService.assign({ organizationId, placeId, entries });
  }
  return { changed: input.ids.length };
}

export const sectionHandlers = [
  handlerFor("section", "read", async ({ ctx, input }) => {
    const page = await sectionService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...set(input.branchId, "branchId"),
    });
    const counts = await sectionService.placeCounts({
      organizationId: ctx.orgId,
      sectionIds: page.items.map((row) => row.id),
    });
    return {
      items: page.items.map((row) => toSectionDto(row, counts.get(row.id) ?? 0)),
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("section", "create", async ({ ctx, input }) => {
    const created = await sectionService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      branchId: input.branchId,
      name: input.name,
      floor: input.floor,
      sortOrder: input.sortOrder,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The section was not created.");
    return toSectionDto(created, 0);
  }),

  handlerFor("section", "update", async ({ ctx, input }) => {
    const updated = await sectionService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.name, "name"),
        ...set(input.floor, "floor"),
        ...set(input.sortOrder, "sortOrder"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Section not found.");
    const counts = await sectionService.placeCounts({
      organizationId: ctx.orgId,
      sectionIds: [updated.id],
    });
    return toSectionDto(updated, counts.get(updated.id) ?? 0);
  }),

  handlerFor("section", "delete", async ({ ctx, input }) => {
    const removed = await sectionService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Section not found.");
    return removed;
  }),
];

export const parameterHandlers = [
  handlerFor("parameterDefinition", "read", async ({ ctx, input }) => {
    const page = await parameterService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      includeInactive: input.includeInactive,
    });
    const visible =
      ctx.role === "guest" || input.customerVisibleOnly
        ? page.items.filter((row) => row.isCustomerVisible)
        : page.items;
    return { items: visible.map(toDefinitionDto), nextCursor: page.nextCursor };
  }),

  handlerFor("parameterDefinition", "create", async ({ ctx, input }) => {
    const clash = await parameterService.byKey({ organizationId: ctx.orgId, key: input.key });
    if (clash !== null) {
      throw new ServiceError("CONFLICT", `A parameter called "${input.key}" already exists.`);
    }
    const created = await parameterService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      dataType: input.dataType,
      options: input.options,
      category: input.category,
      isCustomerVisible: input.isCustomerVisible,
      isFilterable: input.isFilterable,
      sortOrder: input.sortOrder,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The parameter was not created.");
    return toDefinitionDto(created);
  }),

  handlerFor("parameterDefinition", "update", async ({ ctx, input }) => {
    const existing = await parameterService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Parameter not found.");
    if (existing.isSystem && input.dataType !== undefined && input.dataType !== existing.dataType) {
      throw new ServiceError("CONFLICT", "A built-in parameter cannot change its type.");
    }
    const updated = await parameterService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...set(input.label, "label"),
        ...set(input.description, "description"),
        ...set(input.dataType, "dataType"),
        ...set(input.options, "options"),
        ...set(input.category, "category"),
        ...set(input.isCustomerVisible, "isCustomerVisible"),
        ...set(input.isFilterable, "isFilterable"),
        ...set(input.sortOrder, "sortOrder"),
        ...set(input.isActive, "isActive"),
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Parameter not found.");
    return toDefinitionDto(updated);
  }),

  /**
   * Soft. Values already assigned stay in place, because last quarter's occupancy report
   * still reads them and a hard delete would take their labels with it.
   */
  handlerFor("parameterDefinition", "delete", async ({ ctx, input }) => {
    const existing = await parameterService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Parameter not found.");
    if (existing.isSystem) {
      throw new ServiceError("CONFLICT", "A built-in table parameter cannot be removed.");
    }
    await parameterService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: { isActive: false },
    });
    return { id: input.id };
  }),
];
