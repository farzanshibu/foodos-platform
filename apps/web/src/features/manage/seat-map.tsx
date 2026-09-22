/**
 * SOT: seat-map, place-grid-view, row-occupancy
 * WHAT   A screen's seating drawn as it is laid out: rows down, numbers across, one cell per
 *        place, plus everything that has no coordinate yet.
 * WHY    Two hundred seats as a list is a list nobody can find H14 in, and a row that is
 *        entirely sold is invisible in it. A grid answers both questions without a click: the
 *        shape is the information. Tables get the same view because a table and a seat are the
 *        same record - a banquet hall is laid out in rows too - only the default differs.
 * HOW    One CSS grid per row, all sharing a column template, so a missing number leaves a real
 *        gap (an aisle) without a spacer element per empty cell - which is what keeps a
 *        200-seat screen to 200 nodes. The grid scrolls inside its own container; the page
 *        never scrolls sideways. Row letters stay put while it scrolls.
 * WHERE  apps/web/src/features/manage/places-manager.tsx, place-words.ts
 */
"use client";

import { cn } from "@foodos/ui/lib/utils";

import type { Place, PlaceWords } from "@/features/manage/place-words";
import { STATUSES, toneFor } from "@/features/manage/place-words";

/** A place that has both halves of a coordinate. Narrowed once, here, never re-checked. */
type Placed = Place & { rowLabel: string; columnNumber: number };

const isPlaced = (place: Place): place is Placed =>
  place.rowLabel !== null && place.columnNumber !== null;

/** "A" before "B" before "AA": shorter first, then alphabetical, which is how rows run. */
const compareRows = (a: string, b: string): number => a.length - b.length || a.localeCompare(b);

type Row = { label: string; seats: readonly Placed[] };

function rowsOf(placed: readonly Placed[]): readonly Row[] {
  const byRow = new Map<string, Placed[]>();
  for (const seat of placed) {
    const seats = byRow.get(seat.rowLabel);
    if (seats === undefined) byRow.set(seat.rowLabel, [seat]);
    else seats.push(seat);
  }
  return [...byRow.entries()]
    .map(([label, seats]) => ({
      label,
      seats: [...seats].sort((a, b) => a.columnNumber - b.columnNumber),
    }))
    .sort((a, b) => compareRows(a.label, b.label));
}

const CELL = "2.75rem";
const HEADER = "5rem";

export function SeatMap({
  places,
  words,
  selectedId,
  onSelect,
  editor,
}: {
  places: readonly Place[];
  words: PlaceWords;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The one editor, passed in rather than built here - see place-editor.tsx. */
  editor: React.ReactNode;
}) {
  const placed = places.filter(isPlaced);
  const unplaced = places.filter((place) => !isPlaced(place));
  const rows = rowsOf(placed);
  const numbers = placed.map((seat) => seat.columnNumber);
  const first = numbers.length === 0 ? 1 : Math.min(...numbers);
  const last = numbers.length === 0 ? 1 : Math.max(...numbers);
  const template = `${HEADER} repeat(${last - first + 1}, ${CELL})`;

  return (
    <div className="space-y-4">
      <StatusLegend />

      {rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
          <div className="min-w-max space-y-1">
            <p className="rounded bg-muted py-1 text-center text-muted-foreground text-xs uppercase tracking-widest">
              {words.front}
            </p>
            <ColumnRuler template={template} first={first} last={last} />
            {rows.map((row) => (
              <SeatRow
                key={row.label}
                row={row}
                template={template}
                first={first}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}

      {selectedId === null ? null : editor}

      {unplaced.length === 0 ? null : (
        <Unplaced places={unplaced} words={words} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}

function ColumnRuler({ template, first, last }: { template: string; first: number; last: number }) {
  const numbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: template }}>
      <span />
      {numbers.map((number) => (
        <span key={number} className="text-center text-muted-foreground text-xs">
          {number}
        </span>
      ))}
    </div>
  );
}

function SeatRow({
  row,
  template,
  first,
  selectedId,
  onSelect,
}: {
  row: Row;
  template: string;
  first: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const taken = row.seats.filter((seat) => seat.status === "occupied").length;
  const full = taken === row.seats.length;

  return (
    <div className="grid items-center gap-1" style={{ gridTemplateColumns: template }}>
      <div className="sticky left-0 z-10 flex items-center gap-2 bg-card pr-2">
        <span className="font-semibold text-foreground text-sm">{row.label}</span>
        {full ? (
          <span className="rounded bg-primary px-1.5 py-0.5 font-medium text-[0.65rem] text-primary-foreground uppercase">
            Full
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">
            {taken}/{row.seats.length}
          </span>
        )}
      </div>
      {row.seats.map((seat) => (
        <SeatCell
          key={seat.id}
          seat={seat}
          column={seat.columnNumber - first + 2}
          selected={seat.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SeatCell({
  seat,
  column,
  selected,
  onSelect,
}: {
  seat: Placed;
  column: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = toneFor(seat.status);
  return (
    <button
      type="button"
      title={`${seat.label} · ${tone.word}`}
      aria-label={`${seat.label}, ${tone.word}`}
      aria-pressed={selected}
      style={{ gridColumnStart: column }}
      onClick={() => {
        onSelect(seat.id);
      }}
      className={cn(
        "flex h-11 flex-col items-center justify-center rounded-md border leading-none transition-colors",
        tone.cell,
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
      )}
    >
      <span className="font-semibold text-xs">{seat.columnNumber}</span>
      <span aria-hidden="true" className="text-[0.6rem]">
        {tone.mark}
      </span>
    </button>
  );
}

/**
 * Created but not on the map. Shown rather than filtered out, because a seat that exists,
 * carries a QR code and can be ordered from is not something a manager should have to find out
 * about from a report. Selecting one opens the same editor, which is where it gets a row.
 */
function Unplaced({
  places,
  words,
  selectedId,
  onSelect,
}: {
  places: readonly Place[];
  words: PlaceWords;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border border-dashed p-3">
      <div>
        <h2 className="font-medium text-foreground text-sm">
          {words.unplaced} ({places.length})
        </h2>
        <p className="text-muted-foreground text-xs">{words.unplacedHint}</p>
      </div>
      <ul className="flex flex-wrap gap-1">
        {places.map((place) => {
          const tone = toneFor(place.status);
          return (
            <li key={place.id}>
              <button
                type="button"
                aria-label={`${place.label}, ${tone.word}`}
                aria-pressed={place.id === selectedId}
                onClick={() => {
                  onSelect(place.id);
                }}
                className={cn(
                  "flex h-9 items-center gap-1 rounded-md border px-2 text-xs",
                  tone.cell,
                  place.id === selectedId && "ring-2 ring-ring",
                )}
              >
                <span className="font-semibold">{place.label}</span>
                <span aria-hidden="true">{tone.mark}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The key. Every status is a fill, a border and a mark, so none of them is only a colour. */
function StatusLegend() {
  return (
    <ul className="flex flex-wrap gap-3">
      {STATUSES.map((status) => {
        const tone = toneFor(status);
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded border text-[0.6rem]",
                tone.cell,
              )}
            >
              {tone.mark}
            </span>
            <span className="text-muted-foreground text-xs">{tone.word}</span>
          </li>
        );
      })}
    </ul>
  );
}
