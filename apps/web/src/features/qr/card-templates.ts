/**
 * SOT: card-template-geometry, card-print-size, card-template-spec
 * WHAT   What each printable card template measures, and the smallest QR that still scans
 *        on it.
 * WHY    Two surfaces need the same numbers - the designer's preview and the hosted card
 *        page - and a second copy of them is a card that previews at one shape and prints
 *        at another. The qr service still ENFORCES the minimums when a design is saved;
 *        nothing here can approve a card it would refuse, and nothing here is authoritative.
 * HOW    The key union is derived from the contract's own output type rather than retyped,
 *        and the lookup is a switch with no default, so a template added to the contract
 *        fails to compile here until somebody gives it a size.
 * WHERE  packages/contracts/src/resources/qr.contract.ts, services/qr/src/card.handlers.ts
 */
import type { OutputOf } from "@foodos/contracts";

/** Derived from the wire, never retyped: the templates the contract actually accepts. */
export type CardTemplateKey = OutputOf<"cardDesign", "read">["items"][number]["template"];

export type CardTemplate = {
  readonly key: CardTemplateKey;
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly minQrMm: number;
};

const TABLE_TENT: CardTemplate = {
  key: "table_tent",
  label: "Table tent",
  widthMm: 105,
  heightMm: 150,
  minQrMm: 30,
};

const STICKER: CardTemplate = {
  key: "sticker",
  label: "Sticker",
  widthMm: 50,
  heightMm: 50,
  minQrMm: 30,
};

const POSTER: CardTemplate = {
  key: "poster",
  label: "Poster (A4)",
  widthMm: 210,
  heightMm: 297,
  minQrMm: 40,
};

const COUNTER_CARD: CardTemplate = {
  key: "counter_card",
  label: "Counter card",
  widthMm: 90,
  heightMm: 55,
  minQrMm: 25,
};

/** In the order a person picks from. */
export const CARD_TEMPLATE_SPECS: readonly CardTemplate[] = [
  TABLE_TENT,
  STICKER,
  POSTER,
  COUNTER_CARD,
];

/**
 * What a designer starts on. Named rather than `CARD_TEMPLATE_SPECS[0]`, which
 * `noUncheckedIndexedAccess` correctly reports as possibly absent.
 */
export const DEFAULT_CARD_TEMPLATE: CardTemplate = TABLE_TENT;

/**
 * No `default` and a declared return type: `noImplicitReturns` turns a template the
 * contract knows about but this file does not into a compile error rather than a card
 * silently printed at table-tent size.
 */
export function templateOf(key: CardTemplateKey): CardTemplate {
  switch (key) {
    case "table_tent":
      return TABLE_TENT;
    case "sticker":
      return STICKER;
    case "poster":
      return POSTER;
    case "counter_card":
      return COUNTER_CARD;
  }
}
