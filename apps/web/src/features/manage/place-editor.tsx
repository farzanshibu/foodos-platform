/**
 * SOT: place-editor, place-status-change, place-grid-coordinate-edit, place-coordinate-rule
 * WHAT   The one thing that edits a place: its state, and where it sits in the grid. Also the
 *        rule that a coordinate is both halves or neither.
 * WHY    There is exactly one of these because there are two ways to reach a place - a card in
 *        the list and a cell in the seat map - and a second editor would be the copy that stops
 *        matching. Both views render this component; neither knows what it contains.
 * HOW    Mount it with `key={place.id}`. The coordinate inputs start from the place they were
 *        given, so remounting is what makes selecting a different seat show that seat's row
 *        rather than the previous one's. `readCoordinate` is exported because the create row
 *        asks the same question of the same two boxes.
 * WHERE  apps/web/src/features/manage/places-manager.tsx, seat-map.tsx
 */
"use client";

import { Button } from "@foodos/ui/button";
import { Gate } from "@foodos/ui/gate";
import { useState } from "react";

import { controlClass, Field } from "@/features/manage/inline-create";
import type { Place, PlaceStatus, PlaceWords } from "@/features/manage/place-words";
import { coordinateHint, STATUSES, toneFor, wordsFor } from "@/features/manage/place-words";

export type Coordinate = { rowLabel: string | null; columnNumber: number | null };

/**
 * Both halves or neither. A row with no number is not a position, it is half of one, and the
 * map would quietly file it under unplaced without ever saying why. `null` means the pair is
 * half-filled, which is what both callers disable their button on.
 */
export function readCoordinate(row: string, number: string): Coordinate | null {
  const rowLabel = row.trim().toUpperCase();
  const digits = number.trim();
  if (rowLabel === "" && digits === "") return { rowLabel: null, columnNumber: null };
  const columnNumber = Number.parseInt(digits, 10);
  if (rowLabel === "" || !Number.isFinite(columnNumber) || columnNumber < 1) return null;
  return { rowLabel, columnNumber };
}

export function PlaceEditor({
  place,
  pending,
  onStatus,
  onCoordinates,
}: {
  place: Place;
  pending: boolean;
  onStatus: (id: string, status: PlaceStatus) => void;
  onCoordinates: (id: string, coordinate: Coordinate) => void;
}) {
  return (
    <div className="space-y-3">
      <Gate resource="place" operation="manage">
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={place.status === status ? "default" : "outline"}
              disabled={pending}
              onClick={() => {
                onStatus(place.id, status);
              }}
            >
              <span aria-hidden="true">{toneFor(status).mark}</span>
              {toneFor(status).word}
            </Button>
          ))}
        </div>
      </Gate>

      <Gate resource="place" operation="update">
        <CoordinateForm
          place={place}
          pending={pending}
          words={wordsFor(place.kind)}
          onCoordinates={onCoordinates}
        />
      </Gate>
    </div>
  );
}

/**
 * How a place gets onto the grid, and the only way one gets off it: clearing both boxes sends
 * null for each, which is a place that still exists and is still served but is no longer drawn.
 * Deleting it would have been the alternative, and that is not the same thing.
 */
function CoordinateForm({
  place,
  pending,
  words,
  onCoordinates,
}: {
  place: Place;
  pending: boolean;
  words: PlaceWords;
  onCoordinates: (id: string, coordinate: Coordinate) => void;
}) {
  const [row, setRow] = useState(place.rowLabel ?? "");
  const [column, setColumn] = useState(
    place.columnNumber === null ? "" : String(place.columnNumber),
  );
  const coordinate = readCoordinate(row, column);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={words.row} width="w-20">
        <input
          value={row}
          maxLength={4}
          onChange={(event) => {
            setRow(event.target.value);
          }}
          className={controlClass}
        />
      </Field>
      <Field label={words.number} width="w-24">
        <input
          value={column}
          inputMode="numeric"
          onChange={(event) => {
            setColumn(event.target.value);
          }}
          className={controlClass}
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || coordinate === null}
        onClick={() => {
          if (coordinate !== null) onCoordinates(place.id, coordinate);
        }}
      >
        Save position
      </Button>
      {coordinate === null ? (
        <p className="text-muted-foreground text-xs">{coordinateHint(words)}</p>
      ) : null}
    </div>
  );
}
