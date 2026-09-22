/**
 * SOT: floor-contract, table-contract, table-parameters-contract, section-contract,
 *      seat-grid-contract, bulk-place-create
 * WHAT   Input and output schemas for the floor: tables, the sections they sit in, and the
 *        custom parameters a restaurant defines once and assigns per table.
 * WHY    The parameter engine is generic on purpose. A restaurant recording "window seat" and
 *        a cinema recording "recliner" or "aisle" both declare them as data; nothing in this
 *        file, in the service or in the UI knows any of those names - or which venue it is.
 * HOW    No organisation id appears anywhere. `branchId` names which branch a table belongs
 *        to and is not tenant scope - the tenant is the organisation, from the envelope.
 *        `rowLabel` + `columnNumber` are the grid coordinate a seat map draws from, and
 *        `create` takes either one place or a whole grid of them.
 * WHERE  packages/contracts/src/contracts.ts, services/floor
 */
import { z } from "zod";

import { wireDate } from "../wire";

/**
 * A place is anywhere a person sits and is served: a table in a restaurant, a seat in a
 * cinema. The kind changes the words on screen and nothing else - the QR, the parameters,
 * the ordering and the service requests are identical, which is the whole reason this is one
 * concept rather than two parallel ones.
 */
export const PLACE_KINDS = ["table", "seat"] as const;

export const PLACE_STATUSES = [
  "available",
  "occupied",
  "reserved",
  "cleaning",
  "disabled",
] as const;

export type PlaceStatus = (typeof PLACE_STATUSES)[number];

/**
 * Whether a party is sitting here right now.
 *
 * Exactly one status says yes. Every other one - freed, being wiped, held for a later
 * booking, taken out of service - says the people who were here have gone, which is what
 * makes it the moment to close the basket this place was holding. Written as "is anyone
 * still sitting here" rather than as a list of statuses that clear, so a status added later
 * has to opt IN to meaning occupied; the other direction would silently leave a new status
 * inheriting the last party's dishes.
 */
export function placeHoldsAParty(status: PlaceStatus): boolean {
  return status === "occupied";
}
export const PLACE_SHAPES = ["rect", "square", "circle"] as const;
export const PARAMETER_DATA_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "multi_select",
] as const;
export const PARAMETER_CATEGORIES = [
  "seating",
  "ambience",
  "location",
  "service",
  "custom",
] as const;

const cursorPage = {
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(20),
};

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ── Parameter definitions ───────────────────────────────────────────────── */

/**
 * A parameter's value, in the one shape that can carry any of the five data types. It is a
 * union rather than `unknown` so the service can validate a value against its definition
 * without ever reaching for a cast.
 */
export const parameterValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type ParameterValue = z.infer<typeof parameterValue>;

export const parameterDefinitionDto = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  dataType: z.enum(PARAMETER_DATA_TYPES),
  options: z.array(z.string()),
  category: z.enum(PARAMETER_CATEGORIES),
  isCustomerVisible: z.boolean(),
  isFilterable: z.boolean(),
  /** A system parameter cannot be deleted; seats, floor and section are the product's own. */
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: wireDate,
});

/**
 * A select parameter with no options is a dropdown nobody can answer, and a text parameter
 * with options is a list nothing reads. Refused here so neither can be stored.
 */
function refineParameterOptions(
  value: {
    dataType?: (typeof PARAMETER_DATA_TYPES)[number] | undefined;
    options?: readonly string[] | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.dataType === undefined) return;
  const isSelect = value.dataType === "select" || value.dataType === "multi_select";
  const count = value.options?.length ?? 0;
  if (isSelect && count === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: "A select parameter needs at least one option.",
    });
  }
  if (!isSelect && count > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: "Only select parameters take options.",
    });
  }
}

export const parameterDefinitionContract = {
  read: {
    input: z.object({
      ...cursorPage,
      customerVisibleOnly: z.boolean().default(false),
      includeInactive: z.boolean().default(false),
    }),
    output: pageOf(parameterDefinitionDto),
  },
  create: {
    input: z
      .object({
        key: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z][a-z0-9_]*$/, "Lowercase letters, digits and underscores."),
        label: z.string().min(1).max(60),
        description: z.string().max(200).nullable().optional(),
        dataType: z.enum(PARAMETER_DATA_TYPES),
        options: z.array(z.string().min(1).max(60)).max(50).default([]),
        category: z.enum(PARAMETER_CATEGORIES).default("custom"),
        isCustomerVisible: z.boolean().default(false),
        isFilterable: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
      })
      .superRefine(refineParameterOptions),
    output: parameterDefinitionDto,
  },
  update: {
    input: z
      .object({
        id: z.string(),
        label: z.string().min(1).max(60).optional(),
        description: z.string().max(200).nullable().optional(),
        dataType: z.enum(PARAMETER_DATA_TYPES).optional(),
        options: z.array(z.string().min(1).max(60)).max(50).optional(),
        category: z.enum(PARAMETER_CATEGORIES).optional(),
        isCustomerVisible: z.boolean().optional(),
        isFilterable: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      })
      .superRefine(refineParameterOptions),
    output: parameterDefinitionDto,
  },
  /** Soft delete. Historical values stay, because occupancy reports still read them. */
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Sections ────────────────────────────────────────────────────────────── */

export const sectionDto = z.object({
  id: z.string(),
  branchId: z.string(),
  name: z.string(),
  floor: z.number().int(),
  sortOrder: z.number().int(),
  placeCount: z.number().int(),
  createdAt: wireDate,
});

export const sectionContract = {
  read: {
    input: z.object({ ...cursorPage, branchId: z.string().optional() }),
    output: pageOf(sectionDto),
  },
  create: {
    input: z.object({
      branchId: z.string(),
      name: z.string().min(1).max(60),
      floor: z.number().int().min(-5).max(200).default(1),
      sortOrder: z.number().int().default(0),
    }),
    output: sectionDto,
  },
  update: {
    input: z.object({
      id: z.string(),
      name: z.string().min(1).max(60).optional(),
      floor: z.number().int().min(-5).max(200).optional(),
      sortOrder: z.number().int().optional(),
    }),
    output: sectionDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
} as const;

/* ── Tables ──────────────────────────────────────────────────────────────── */

/** A resolved parameter, carrying enough of its definition that a card can render itself. */
export const placeParameterDto = z.object({
  definitionId: z.string(),
  key: z.string(),
  label: z.string(),
  dataType: z.enum(PARAMETER_DATA_TYPES),
  isCustomerVisible: z.boolean(),
  value: parameterValue,
});

export const placeDto = z.object({
  id: z.string(),
  branchId: z.string(),
  sectionId: z.string().nullable(),
  sectionName: z.string().nullable(),
  kind: z.enum(PLACE_KINDS),
  /** What it is called where it stands: "T12" on a floor, "H14" in a screen. */
  label: z.string(),
  /** How many people it seats. A table seats several; a cinema seat seats one. */
  capacity: z.number().int().min(1),
  status: z.enum(PLACE_STATUSES),
  shape: z.enum(PLACE_SHAPES),
  /**
   * Where it sits in a seating grid: row "H", number 14. Both null on a place nobody has put
   * in a grid, which is the normal state of a restaurant table - a floor is not rows. They are
   * deliberately not positionX/positionY: those are a free-form plan coordinate a waiter drags
   * around, while these are what is printed on the seat and said out loud, and a seat must not
   * be renamed by moving its drawing.
   */
  rowLabel: z.string().nullable(),
  columnNumber: z.number().int().nullable(),
  positionX: z.number().nullable(),
  positionY: z.number().nullable(),
  isActive: z.boolean(),
  parameters: z.array(placeParameterDto),
  /** Populated when the branch has generated a table QR; null until it has. */
  qrToken: z.string().nullable(),
  createdAt: wireDate,
});

const placeParameterAssignment = z.object({
  definitionId: z.string(),
  value: parameterValue,
});

/** "A", "H", "AA". Short because it is read off a seat back in the dark. */
const rowLabel = z.string().min(1).max(4);
const columnNumber = z.number().int().min(1).max(200);

/** One call may lay out one screen. Above this the operator wanted two screens, not one. */
const GRID_MAX_PLACES = 400;

export const placeContract = {
  read: {
    input: z.object({
      ...cursorPage,
      /**
       * Wider than every other page in the product, deliberately. A floor plan and a seat map
       * are read whole - half a cinema screen is not a smaller answer, it is a wrong one - and
       * the shared ceiling of 100 is smaller than a single screen. Bounded by the same number
       * `create` will lay out in one call, so one screen always fits in one page.
       */
      limit: z.number().int().min(1).max(400).default(50),
      branchId: z.string().optional(),
      sectionId: z.string().optional(),
      id: z.string().optional(),
      status: z.enum(PLACE_STATUSES).optional(),
      kind: z.enum(PLACE_KINDS).optional(),
      /** Reservation matching: only places whose parameters satisfy every filter. */
      minCapacity: z.number().int().min(1).optional(),
      parameterFilters: z.array(placeParameterAssignment).max(10).default([]),
      customerVisibleParametersOnly: z.boolean().default(false),
    }),
    output: pageOf(placeDto),
  },
  /**
   * One place, or a whole grid of them in one call. A cinema screen is 200 seats laid out in
   * rows, and 200 browser round trips is not a workflow anyone would run twice - so the batch
   * lives here, on the operation the registry already marks admin-only, metered and audited,
   * rather than on `manage`, where a waiter could have minted a screen's worth of seats
   * outside the plan gate.
   */
  create: {
    input: z
      .discriminatedUnion("mode", [
        z.object({
          mode: z.literal("one"),
          branchId: z.string(),
          sectionId: z.string().nullable().optional(),
          kind: z.enum(PLACE_KINDS).default("table"),
          label: z.string().min(1).max(24),
          capacity: z.number().int().min(1).max(64).default(2),
          shape: z.enum(PLACE_SHAPES).default("rect"),
          rowLabel: rowLabel.nullable().optional(),
          columnNumber: columnNumber.nullable().optional(),
          positionX: z.number().nullable().optional(),
          positionY: z.number().nullable().optional(),
          parameters: z.array(placeParameterAssignment).max(30).default([]),
        }),
        z.object({
          mode: z.literal("grid"),
          branchId: z.string(),
          sectionId: z.string().nullable().optional(),
          kind: z.enum(PLACE_KINDS).default("seat"),
          /**
           * The rows in the order they run, front to back. Sent rather than derived from a
           * range so that what the operator approved in the preview is exactly what is
           * written, and so a venue whose rows skip a letter can say so.
           */
          rows: z.array(rowLabel).min(1).max(40),
          /** Seats per row, numbered from `startColumn`. */
          columns: z.number().int().min(1).max(60),
          startColumn: columnNumber.default(1),
          /** "S3-" for a screen whose row letters repeat elsewhere in the same branch. */
          labelPrefix: z.string().max(8).default(""),
          capacity: z.number().int().min(1).max(64).default(1),
          shape: z.enum(PLACE_SHAPES).default("circle"),
          parameters: z.array(placeParameterAssignment).max(30).default([]),
        }),
      ])
      .superRefine((value, ctx) => {
        if (value.mode !== "grid") return;
        if (value.rows.length * value.columns > GRID_MAX_PLACES) {
          ctx.addIssue({
            code: "custom",
            path: ["columns"],
            message: `That is more than ${GRID_MAX_PLACES} places. Lay out one screen at a time.`,
          });
        }
      }),
    /**
     * Everything the call created, and the labels it left alone. A grid re-run against a
     * branch that already has those labels adds nothing and reports them as skipped, so the
     * operator who is unsure whether it worked the first time can simply run it again.
     */
    output: z.object({
      places: z.array(placeDto),
      skipped: z.array(z.string()),
    }),
  },
  update: {
    input: z.object({
      id: z.string(),
      sectionId: z.string().nullable().optional(),
      kind: z.enum(PLACE_KINDS).optional(),
      label: z.string().min(1).max(24).optional(),
      capacity: z.number().int().min(1).max(64).optional(),
      shape: z.enum(PLACE_SHAPES).optional(),
      /** Null clears the coordinate, which is how a place leaves the grid without being deleted. */
      rowLabel: rowLabel.nullable().optional(),
      columnNumber: columnNumber.nullable().optional(),
      isActive: z.boolean().optional(),
      parameters: z.array(placeParameterAssignment).max(30).optional(),
    }),
    output: placeDto,
  },
  delete: { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) },
  /**
   * The two things floor staff do that are not administration: move a table on the plan,
   * and change its state. Both are `member`, because a waiter seating a party is not an
   * admin action, and bulk-applying a parameter to a whole section is how a real restaurant
   * marks its terrace.
   */
  manage: {
    input: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("set_status"),
        id: z.string(),
        status: z.enum(PLACE_STATUSES),
      }),
      z.object({
        action: z.literal("move"),
        positions: z
          .array(z.object({ id: z.string(), positionX: z.number(), positionY: z.number() }))
          .min(1)
          .max(200),
      }),
      z.object({
        action: z.literal("bulk_parameters"),
        ids: z.array(z.string()).min(1).max(200),
        parameters: z.array(placeParameterAssignment).min(1).max(30),
      }),
    ]),
    output: z.object({ changed: z.number().int() }),
  },
} as const;
