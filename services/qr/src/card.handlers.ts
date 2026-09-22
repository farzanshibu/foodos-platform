/**
 * SOT: card-design-handlers, card-render, hosted-card-page
 * WHAT   Business rules for the printable cards a restaurant designs and puts on tables.
 * WHY    A card's QR must be the server's token, not one the designer invented: attaching a
 *        request type to a design creates the authoritative code here, on save, so what gets
 *        printed is what the server will resolve.
 * HOW    Rendering is a command. Rasterising an A4 poster at 300 DPI is not a request-path
 *        job, so the caller gets an acceptance and collects the file from the design.
 * WHERE  services/qr/src/qr.service.ts, services/qr/src/token.ts
 */
import "server-only";

import { ServiceError } from "@foodos/contracts";
import { handlerFor } from "@foodos/core";
import { env } from "@foodos/env";

import { cardService, qrService } from "./qr.service";
import type { CardDesignRow } from "./schema";
import { generateToken, renderQrSvg } from "./token";

const TEMPLATES = ["table_tent", "sticker", "poster", "counter_card"] as const;
type Template = (typeof TEMPLATES)[number];

/**
 * What each template is printed at, and the smallest QR that still scans on it. These are
 * physical facts about paper and phone cameras, so they live with the renderer rather than
 * being retyped in a design tool that cannot enforce them.
 *
 * A function rather than a keyed object because the template names are wire values and so
 * snake_case; this keeps the exhaustiveness without a second vocabulary or a lint exemption.
 */
function specOf(template: Template): { widthMm: number; heightMm: number; minQrMm: number } {
  switch (template) {
    case "table_tent":
      return { widthMm: 105, heightMm: 150, minQrMm: 30 };
    case "sticker":
      return { widthMm: 50, heightMm: 50, minQrMm: 30 };
    case "poster":
      return { widthMm: 210, heightMm: 297, minQrMm: 40 };
    default:
      return { widthMm: 90, heightMm: 55, minQrMm: 25 };
  }
}

type SlotPoint = { x: number; y: number };
type Slots = Record<
  "logo" | "headline" | "subheadline" | "icon" | "qr" | "placeLabel" | "footer",
  SlotPoint
>;

const DEFAULT_SLOTS: Slots = {
  logo: { x: 0, y: 0 },
  headline: { x: 0, y: 0 },
  subheadline: { x: 0, y: 0 },
  icon: { x: 0, y: 0 },
  qr: { x: 0, y: 0 },
  placeLabel: { x: 0, y: 0 },
  footer: { x: 0, y: 0 },
};

const asTemplate = (value: string): Template =>
  TEMPLATES.find((candidate) => candidate === value) ?? "table_tent";

type ThemeShape = {
  bg: string;
  accent: string;
  text: string;
  headline: string;
  subheadline: string | null;
  footer: string | null;
  icon: string | null;
  logoUrl: string | null;
  showPlaceLabel: boolean;
  qr: { sizeMm: number; position: "top" | "center" | "bottom" };
};

const FALLBACK_THEME: ThemeShape = {
  bg: "#ffffff",
  accent: "#111111",
  text: "#111111",
  headline: "Scan to order",
  subheadline: null,
  footer: null,
  icon: null,
  logoUrl: null,
  showPlaceLabel: true,
  qr: { sizeMm: 30, position: "center" },
};

/**
 * JSONB reaches us as unknown, and narrowing it through an index signature would collide with
 * `noPropertyAccessFromIndexSignature`. A Map of the entries sidesteps both: every lookup is
 * honestly `unknown` and there is no cast anywhere in the parse.
 */
function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null) return new Map();
  const entries: ReadonlyMap<string, unknown> = new Map(Object.entries(value));
  return entries;
}

function readTheme(value: unknown): ThemeShape {
  const row = fieldsOf(value);
  if (row.size === 0) return FALLBACK_THEME;

  const text = (key: string, fallback: string): string => {
    const held = row.get(key);
    return typeof held === "string" ? held : fallback;
  };
  const nullableText = (key: string): string | null => {
    const held = row.get(key);
    return typeof held === "string" ? held : null;
  };

  const qr = fieldsOf(row.get("qr"));
  const sizeMm = qr.get("sizeMm");
  const position = qr.get("position");

  return {
    bg: text("bg", FALLBACK_THEME.bg),
    accent: text("accent", FALLBACK_THEME.accent),
    text: text("text", FALLBACK_THEME.text),
    headline: text("headline", FALLBACK_THEME.headline),
    subheadline: nullableText("subheadline"),
    footer: nullableText("footer"),
    icon: nullableText("icon"),
    logoUrl: nullableText("logoUrl"),
    showPlaceLabel: row.get("showPlaceLabel") !== false,
    qr: {
      sizeMm: typeof sizeMm === "number" ? sizeMm : 30,
      position: position === "top" || position === "bottom" ? position : "center",
    },
  };
}

function readSlots(value: unknown): Slots {
  const row = fieldsOf(value);
  if (row.size === 0) return DEFAULT_SLOTS;

  const point = (key: string): SlotPoint => {
    const entry = fieldsOf(row.get(key));
    const x = entry.get("x");
    const y = entry.get("y");
    return { x: typeof x === "number" ? x : 0, y: typeof y === "number" ? y : 0 };
  };

  return {
    logo: point("logo"),
    headline: point("headline"),
    subheadline: point("subheadline"),
    icon: point("icon"),
    qr: point("qr"),
    placeLabel: point("placeLabel"),
    footer: point("footer"),
  };
}

const slugify = (name: string): string =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`;

async function toCardDto(organizationId: string, row: CardDesignRow) {
  const code =
    row.qrCodeId === null ? null : await qrService.byId({ organizationId, id: row.qrCodeId });
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    template: asTemplate(row.template),
    theme: readTheme(row.theme),
    slots: readSlots(row.slots),
    requestTypeId: row.requestTypeId,
    qrCodeId: row.qrCodeId,
    qrToken: code?.token ?? null,
    hostedPath: `/c/${row.slug}`,
    /** Null until the render command has run, and null again the moment the design changes. */
    renderedSvg: row.renderedSvg,
    linkedRequestTypeNames: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A QR smaller than the template's minimum is a card nobody can scan. Refused on save. */
function assertQrFits(template: Template, sizeMm: number): void {
  const spec = specOf(template);
  if (sizeMm < spec.minQrMm) {
    throw new ServiceError(
      "INVALID_INPUT",
      `A ${template.replace(/_/g, " ")} needs a QR of at least ${spec.minQrMm}mm to scan reliably.`,
    );
  }
}

export const cardDesignHandlers = [
  handlerFor("cardDesign", "read", async ({ ctx, input }) => {
    const page = await cardService.list({
      organizationId: ctx.orgId,
      limit: input.limit,
      cursor: input.cursor ?? null,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    });
    return {
      items: await Promise.all(page.items.map((row) => toCardDto(ctx.orgId, row))),
      nextCursor: page.nextCursor,
    };
  }),

  handlerFor("cardDesign", "create", async ({ ctx, input }) => {
    assertQrFits(input.template, input.theme.qr.sizeMm);

    /**
     * Attaching a request type mints the authoritative code here, so the token on the card is
     * the token the server will resolve. A client that generated its own would be printing a
     * code that opens nothing.
     */
    const code =
      input.requestTypeId == null
        ? null
        : await qrService.create({
            id: crypto.randomUUID(),
            organizationId: ctx.orgId,
            restaurantId: "",
            requestTypeId: input.requestTypeId,
            type: "request",
            token: generateToken(),
            label: input.name,
          });

    const created = await cardService.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      name: input.name,
      slug: slugify(input.name),
      template: input.template,
      theme: input.theme,
      slots: { ...DEFAULT_SLOTS, ...(input.slots ?? {}) },
      requestTypeId: input.requestTypeId ?? null,
      qrCodeId: code?.id ?? null,
    });
    if (created === null) throw new ServiceError("INTERNAL", "The design was not created.");
    return toCardDto(ctx.orgId, created);
  }),

  handlerFor("cardDesign", "update", async ({ ctx, input }) => {
    const existing = await cardService.byId({ organizationId: ctx.orgId, id: input.id });
    if (existing === null) throw new ServiceError("NOT_FOUND", "Design not found.");

    const template = input.template ?? asTemplate(existing.template);
    if (input.theme !== undefined) assertQrFits(template, input.theme.qr.sizeMm);

    const updated = await cardService.update({
      organizationId: ctx.orgId,
      id: input.id,
      patch: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.template === undefined ? {} : { template: input.template }),
        ...(input.theme === undefined ? {} : { theme: input.theme }),
        ...(input.slots === undefined
          ? {}
          : { slots: { ...readSlots(existing.slots), ...input.slots } }),
        ...(input.requestTypeId === undefined ? {} : { requestTypeId: input.requestTypeId }),
        /** The design changed, so whatever was rendered from the old one is stale. */
        renderedSvg: null,
      },
    });
    if (updated === null) throw new ServiceError("NOT_FOUND", "Design not found.");
    return toCardDto(ctx.orgId, updated);
  }),

  handlerFor("cardDesign", "delete", async ({ ctx, input }) => {
    const removed = await cardService.remove({ organizationId: ctx.orgId, id: input.id });
    if (removed === null) throw new ServiceError("NOT_FOUND", "Design not found.");
    return removed;
  }),

  /**
   * A command, so this runs off the request path. It is idempotent by construction: rendering
   * the same design twice writes the same SVG, which is what makes a redelivered command
   * harmless rather than a duplicate file.
   */
  handlerFor("cardDesign", "manage", async ({ ctx, input }) => {
    const design = await cardService.byId({ organizationId: ctx.orgId, id: input.id });
    if (design === null) throw new ServiceError("NOT_FOUND", "Design not found.");

    const theme = readTheme(design.theme);
    const code =
      design.qrCodeId === null
        ? null
        : await qrService.byId({ organizationId: ctx.orgId, id: design.qrCodeId });

    const svg = renderQrSvg({
      url: code === null ? env.appUrl() : `${env.appUrl()}/q/${code.token}`,
      sizeMm: theme.qr.sizeMm,
      label: theme.headline,
    });

    await cardService.update({
      organizationId: ctx.orgId,
      id: design.id,
      patch: { renderedSvg: svg },
    });

    return { accepted: true as const, requestId: ctx.requestId };
  }),
];
