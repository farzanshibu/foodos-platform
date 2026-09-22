/**
 * SOT: place-bulk-create, seat-grid-generator, row-range
 * WHAT   The form that lays out a whole screen: a range of rows, a count per row, a preview of
 *        exactly what it will make, and one button that makes it.
 * WHY    Two hundred seats created one at a time is not a workflow anybody runs twice, and two
 *        hundred mutations fired from a browser is the same mistake with a loop around it. The
 *        rows are expanded here and sent as a list, so what the operator approved in the
 *        preview is literally the payload - the service does not re-derive it and cannot
 *        disagree.
 * HOW    Re-running the same range is safe: the service inserts on the label's unique index and
 *        reports what was already there, so an operator who is unsure whether the first attempt
 *        landed can simply press it again.
 * NOTE   The plan check here is a MIRROR, not the gate. `useResourceDecision` is the same pure
 *        function the gateway calls, asked about the same grid, so the button greys out on the
 *        registry's numbers and the refusal is worded by the registry - but the enforcement is
 *        `dispatch` step 6, and this file could be deleted without opening a hole.
 * WHERE  apps/web/src/features/manage/places-manager.tsx
 */
"use client";

import { DEFAULT_UNITS, refusalMessage } from "@foodos/registry";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { useResourceDecision } from "@foodos/ui/feature-gate";
import { useState } from "react";

import { controlClass, Field } from "@/features/manage/inline-create";
import type { PlaceWords } from "@/features/manage/place-words";

/** Matches the contract's own ceiling: one call lays out one screen. */
const MAX_PLACES = 400;
const MAX_ROWS = 40;

export type GridSpec = {
  rows: readonly string[];
  columns: number;
  labelPrefix: string;
  capacity: number;
};

/** "A" is 1, "Z" is 26, "AA" is 27 - spreadsheet order, which is also cinema row order. */
function indexOfRow(label: string): number | null {
  if (!/^[A-Z]{1,2}$/.test(label)) return null;
  let index = 0;
  for (const letter of label) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index;
}

function labelOfRow(index: number): string {
  let remaining = index;
  let label = "";
  while (remaining > 0) {
    const position = (remaining - 1) % 26;
    label = String.fromCharCode(65 + position) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

function rowRange(from: string, to: string): readonly string[] {
  const start = indexOfRow(from.trim().toUpperCase());
  const end = indexOfRow(to.trim().toUpperCase());
  if (start === null || end === null || end < start || end - start + 1 > MAX_ROWS) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => labelOfRow(start + offset));
}

export function PlaceBulkCreate({
  words,
  pending,
  disabled,
  onCreate,
}: {
  words: PlaceWords;
  pending: boolean;
  disabled: boolean;
  onCreate: (spec: GridSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("A");
  const [to, setTo] = useState("J");
  const [perRow, setPerRow] = useState("20");
  const [prefix, setPrefix] = useState("");
  const [capacity, setCapacity] = useState(words.key === "seat" ? "1" : "4");

  const rows = rowRange(from, to);
  const columns = Math.max(0, Number.parseInt(perRow, 10) || 0);
  const total = rows.length * columns;
  /**
   * The plan's own arithmetic, asked the same way the gateway will ask it: the same pure
   * function, over the same entitlements, about the same number of places. This is a mirror
   * and not the enforcement - the gate that matters refuses on the server - so what it owes
   * the operator is agreement, which it can only have by asking rather than by re-deriving.
   * The refusal sentence comes back from the registry for the same reason.
   */
  const decision = useResourceDecision("place", Math.max(total, DEFAULT_UNITS));

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {words.bulkTitle}
      </Button>
    );
  }

  const tooMany = total > MAX_PLACES;
  /** Null while the plan fits, and while the size refusal below is already saying enough. */
  const refusal = tooMany || decision.allowed ? null : refusalMessage("place", decision);
  const ready = total > 0 && !tooMany && decision.allowed && !disabled;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-foreground">{words.bulkTitle}</h2>
            <p className="text-muted-foreground text-sm">{words.bulkHint}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label={`${words.row} from`} width="w-20">
            <input
              value={from}
              maxLength={2}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Field label={`${words.row} to`} width="w-20">
            <input
              value={to}
              maxLength={2}
              onChange={(event) => {
                setTo(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Field label={`Per ${words.row.toLowerCase()}`} width="w-24">
            <input
              value={perRow}
              inputMode="numeric"
              onChange={(event) => {
                setPerRow(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Field label={words.capacity} width="w-24">
            <input
              value={capacity}
              inputMode="numeric"
              onChange={(event) => {
                setCapacity(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Field label="Label prefix" width="w-28">
            <input
              value={prefix}
              maxLength={8}
              placeholder="S3-"
              onChange={(event) => {
                setPrefix(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
        </div>

        <GridPreview rows={rows} columns={columns} prefix={prefix} words={words} />

        {tooMany ? (
          <p className="text-destructive text-sm">
            That is {total} {words.many.toLowerCase()}, more than the {MAX_PLACES} one call may lay
            out. Do one {words.front.toLowerCase()} at a time.
          </p>
        ) : null}

        {refusal === null ? null : <p className="text-muted-foreground text-sm">{refusal}</p>}

        <Button
          disabled={pending || !ready}
          onClick={() => {
            onCreate({
              rows,
              columns,
              labelPrefix: prefix.trim(),
              capacity: Math.max(1, Number.parseInt(capacity, 10) || 1),
            });
          }}
        >
          {words.bulkAction}
        </Button>
      </CardContent>
    </Card>
  );
}

/** What the button is about to do, in the labels it will actually write. */
function GridPreview({
  rows,
  columns,
  prefix,
  words,
}: {
  rows: readonly string[];
  columns: number;
  prefix: string;
  words: PlaceWords;
}) {
  const firstRow = rows.at(0);
  const lastRow = rows.at(-1);
  if (firstRow === undefined || lastRow === undefined || columns === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Give a {words.row.toLowerCase()} range like A to J, and how many {words.many.toLowerCase()}{" "}
        each {words.row.toLowerCase()} holds.
      </p>
    );
  }
  const trimmed = prefix.trim();
  return (
    <div className="rounded-md border border-border border-dashed p-3 text-sm">
      <p className="text-foreground">
        {rows.length} {rows.length === 1 ? words.row.toLowerCase() : `${words.row.toLowerCase()}s`}{" "}
        × {columns} = <span className="font-semibold">{rows.length * columns}</span>{" "}
        {words.many.toLowerCase()}
      </p>
      <p className="text-muted-foreground">
        {trimmed}
        {firstRow}1 through {trimmed}
        {lastRow}
        {columns}. Any label that already exists is left exactly as it is.
      </p>
    </div>
  );
}
