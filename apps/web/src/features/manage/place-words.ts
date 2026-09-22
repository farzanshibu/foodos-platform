/**
 * SOT: place-words, place-vocabulary, place-status-tone
 * WHAT   Every word the floor screens change between a restaurant and a cinema, and the one
 *        description of how a place's status is drawn.
 * WHY    A seat and a table are the same record wearing different nouns. Keeping the nouns in
 *        one table means a venue type is a row here rather than a hunt through the UI for
 *        every string that said "table". The status tones sit beside them because a status has
 *        to read identically in the list and in the map, and two copies of that drift.
 * HOW    `wordsFor(kind)` for the nouns, `STATUS_TONE` for the drawing. Design tokens only -
 *        the map has to survive light, dim and dark - and every status differs by fill, border
 *        style AND a mark, never by hue alone, because a colour-blind manager still has to see
 *        from across the room that row J is full.
 * WHERE  apps/web/src/features/manage/places-manager.tsx, seat-map.tsx, place-editor.tsx,
 *        place-bulk-create.tsx
 */
import type { OutputOf } from "@foodos/contracts";

export type Place = OutputOf<"place", "read">["items"][number];
export type PlaceStatus = Place["status"];
export type PlaceKind = Place["kind"];

type StatusTone = {
  /** The cell or card treatment: fill and border style, both meaningful without colour. */
  readonly cell: string;
  /** A mark that says the same thing as the fill for anyone who cannot see the fill. */
  readonly mark: string;
  readonly word: string;
};

/**
 * Typed as a total map of the contract's statuses, so a status added to the floor contract is
 * a compile error here rather than a place that silently draws as "available".
 */
export const STATUS_TONE = {
  available: { cell: "border-border bg-card text-foreground", mark: "○", word: "Available" },
  occupied: {
    cell: "border-primary bg-primary text-primary-foreground",
    mark: "●",
    word: "Occupied",
  },
  reserved: {
    cell: "border-primary border-dashed bg-primary/15 text-foreground",
    mark: "◑",
    word: "Reserved",
  },
  cleaning: {
    cell: "border-border border-dotted bg-muted text-muted-foreground",
    mark: "◌",
    word: "Cleaning",
  },
  disabled: {
    cell: "border-border bg-transparent text-muted-foreground line-through",
    mark: "✕",
    word: "Out of use",
  },
} as const satisfies Record<PlaceStatus, StatusTone>;

/** The order the status buttons are offered in - deliberate, so it is written out. */
export const STATUSES = [
  "available",
  "occupied",
  "reserved",
  "cleaning",
  "disabled",
] as const satisfies readonly PlaceStatus[];

export const toneFor = (status: PlaceStatus): StatusTone => STATUS_TONE[status];

export type PlaceWords = {
  readonly key: PlaceKind;
  /** Tab label, plural. */
  readonly many: string;
  /** "Add a seat", "No seat here yet". */
  readonly one: string;
  /** The field that names it: "Table", "Seat". */
  readonly labelField: string;
  readonly labelPlaceholder: string;
  readonly capacity: string;
  readonly row: string;
  readonly number: string;
  readonly mapView: string;
  readonly listView: string;
  /** What the top of the grid faces, so a manager knows which way round it is drawn. */
  readonly front: string;
  readonly unplaced: string;
  readonly unplacedHint: string;
  readonly bulkTitle: string;
  readonly bulkHint: string;
  readonly bulkAction: string;
  readonly emptyIcon: string;
  readonly emptyDetail: string;
};

const WORDS = [
  {
    key: "table",
    many: "Tables",
    one: "table",
    labelField: "Table",
    labelPlaceholder: "T12",
    capacity: "Seats",
    row: "Row",
    number: "Table number",
    mapView: "Floor grid",
    listView: "List",
    front: "Entrance",
    unplaced: "Tables not on the grid",
    unplacedHint: "They exist and can be served - they just have no row yet. Open one to place it.",
    bulkTitle: "Add a block of tables",
    bulkHint: "Rows A to D with 6 tables each becomes A1 through D6.",
    bulkAction: "Create these tables",
    emptyIcon: "🪑",
    emptyDetail: "Add them here, then print a code for each one from the QR codes screen.",
  },
  {
    key: "seat",
    many: "Seats",
    one: "seat",
    labelField: "Seat",
    labelPlaceholder: "H14",
    capacity: "Capacity",
    row: "Row",
    number: "Seat number",
    mapView: "Seat map",
    listView: "List",
    front: "Screen",
    unplaced: "Seats not on the map",
    unplacedHint:
      "They exist and can be served - they just have no row and number yet. Open one to place it.",
    bulkTitle: "Add a screen of seats",
    bulkHint: "Rows A to J with 20 seats each becomes A1 through J20.",
    bulkAction: "Create these seats",
    emptyIcon: "🎬",
    emptyDetail: "Add them here, then print a code for each one from the QR codes screen.",
  },
] as const satisfies readonly PlaceWords[];

export const PLACE_KIND_WORDS: readonly PlaceWords[] = WORDS;

/** Total over the contract's kinds, so a third kind of venue cannot be half-translated. */
const BY_KIND = {
  table: WORDS[0],
  seat: WORDS[1],
} as const satisfies Record<PlaceKind, PlaceWords>;

export const wordsFor = (kind: PlaceKind): PlaceWords => BY_KIND[kind];

/** The one sentence that explains a half-filled coordinate, wherever the pair is asked for. */
export const coordinateHint = (words: PlaceWords): string =>
  `Give both a ${words.row.toLowerCase()} and a ${words.number.toLowerCase()}, or neither.`;
