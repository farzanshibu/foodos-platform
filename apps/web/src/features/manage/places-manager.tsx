/**
 * SOT: places-manager, floor-plan, place-status, place-parameters-ui
 * WHAT   The floor: every place a guest can be served at, what state it is in, the custom
 *        attributes this venue decided matter about it, and where it sits.
 * WHY    A table and a cinema seat are the same thing wearing different words. `kind` changes
 *        the label and nothing else - same QR, same parameters, same ordering, same requests -
 *        which is why this is one screen and not two parallel ones nobody keeps in step. Both
 *        kinds get both views for the same reason; only the default differs, because twenty
 *        tables read fine as a list and two hundred seats do not.
 * HOW    The attributes shown are not a fixed list. Whatever the venue defined (zone, window
 *        seat, screen, row, recliner) is rendered by data type, so a new one appears here the
 *        moment somebody creates it and nobody ships anything. Every word that differs between
 *        a restaurant and a cinema comes from place-words.ts; nothing here says "seat".
 * WHERE  services/floor/src/floor.handlers.ts, seat-map.tsx, place-editor.tsx,
 *        place-bulk-create.tsx, place-words.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BranchPicker } from "@/features/manage/branch-picker";
import { CreateRow, controlClass, Field } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { type GridSpec, PlaceBulkCreate } from "@/features/manage/place-bulk-create";
import { PlaceEditor, readCoordinate } from "@/features/manage/place-editor";
import type { Place, PlaceKind, PlaceWords } from "@/features/manage/place-words";
import { coordinateHint, PLACE_KIND_WORDS, toneFor, wordsFor } from "@/features/manage/place-words";
import { SeatMap } from "@/features/manage/seat-map";
import { useTRPC } from "@/trpc/react";

type Branch = OutputOf<"branch", "read">["items"][number];
type Parameter = OutputOf<"parameterDefinition", "read">["items"][number];

const VIEWS = ["map", "list"] as const;
type View = (typeof VIEWS)[number];

/** A list is fine for a floor. A screen needs its shape, so that is what it opens as. */
const defaultView = (kind: PlaceKind): View => (kind === "seat" ? "map" : "list");
const defaultCapacity = (kind: PlaceKind): string => (kind === "seat" ? "1" : "4");

export function PlacesManager({
  branches,
  parameters,
}: {
  branches: Branch[];
  parameters: Parameter[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [kind, setKind] = useState<PlaceKind>("table");
  const [view, setView] = useState<View>(defaultView("table"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(defaultCapacity("table"));
  const [row, setRow] = useState("");
  const [number, setNumber] = useState("");

  /**
   * One kind, one branch, one page. The kind is filtered in the service rather than here so a
   * screen's worth of seats does not have to share a page with the restaurant's tables - the
   * contract's ceiling is one screen, and a map that silently stops at row F is worse than no
   * map at all.
   */
  const places = useQuery(
    trpc.place.list.queryOptions(
      {
        limit: 400,
        cursor: null,
        kind,
        parameterFilters: [],
        customerVisibleParametersOnly: false,
        ...(branchId === "" ? {} : { branchId }),
      },
      { enabled: branchId !== "" },
    ),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.place.list.queryKey() });
  };
  const create = useMutation(
    trpc.place.create.mutationOptions({
      onSuccess: () => {
        setLabel("");
        setRow("");
        setNumber("");
        refresh();
      },
    }),
  );
  const act = useMutation(trpc.place.floorAction.mutationOptions({ onSuccess: refresh }));
  const move = useMutation(trpc.place.update.mutationOptions({ onSuccess: refresh }));

  const words = wordsFor(kind);
  const coordinate = readCoordinate(row, number);
  const shown = places.data?.items ?? [];
  const selected = shown.find((place) => place.id === selectedId) ?? null;
  const pending = act.isPending || move.isPending;

  const chooseKind = (next: PlaceKind) => {
    setKind(next);
    setView(defaultView(next));
    setCapacity(defaultCapacity(next));
    setSelectedId(null);
    /** The last create's summary was about the other kind. Carrying it over would be a lie. */
    create.reset();
  };

  const editor =
    selected === null ? null : (
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold text-foreground">{selected.label}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedId(null);
              }}
            >
              Done
            </Button>
          </div>
          <PlaceEditor
            key={selected.id}
            place={selected}
            pending={pending}
            onStatus={(id, status) => {
              act.mutate({ action: "set_status", id, status });
            }}
            onCoordinates={(id, coordinate) => {
              move.mutate({ id, ...coordinate });
            }}
          />
        </CardContent>
      </Card>
    );

  return (
    <PageShell
      title="Places"
      description="Tables on a floor, seats in a screen. Both are served the same way."
      action={<BranchPicker branches={branches} value={branchId} onChange={setBranchId} />}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          options={PLACE_KIND_WORDS.map((entry) => ({ key: entry.key, label: entry.many }))}
          value={kind}
          onChange={chooseKind}
        />
        <Tabs
          options={[
            { key: "map", label: words.mapView },
            { key: "list", label: words.listView },
          ]}
          value={view}
          onChange={(next: View) => {
            setView(next);
          }}
        />
      </div>

      <Gate resource="place" operation="create">
        <CreateRow>
          <Field label={words.labelField} width="w-32">
            <input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              placeholder={words.labelPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={words.capacity} width="w-28">
            <input
              value={capacity}
              inputMode="numeric"
              onChange={(event) => {
                setCapacity(event.target.value);
              }}
              className={controlClass}
            />
          </Field>
          <Coordinates
            words={words}
            row={row}
            number={number}
            valid={coordinate !== null}
            onRow={setRow}
            onNumber={setNumber}
          />
          <Button
            disabled={
              create.isPending || label.trim() === "" || branchId === "" || coordinate === null
            }
            onClick={() => {
              if (coordinate === null) return;
              create.mutate({
                mode: "one",
                branchId,
                kind,
                label: label.trim(),
                capacity: Math.max(1, Number.parseInt(capacity, 10) || 1),
                shape: kind === "seat" ? "circle" : "rect",
                ...coordinate,
                parameters: [],
              });
            }}
          >
            Add {words.one}
          </Button>
        </CreateRow>

        <PlaceBulkCreate
          key={kind}
          words={words}
          pending={create.isPending}
          disabled={branchId === ""}
          onCreate={(spec: GridSpec) => {
            create.mutate({
              mode: "grid",
              branchId,
              kind,
              rows: [...spec.rows],
              columns: spec.columns,
              capacity: spec.capacity,
              labelPrefix: spec.labelPrefix,
              shape: kind === "seat" ? "circle" : "rect",
              parameters: [],
            });
          }}
        />
      </Gate>

      {create.data === undefined ? null : <CreateSummary result={create.data} words={words} />}
      {create.error === null ? null : <Denial error={create.error} resource="place" />}
      {act.error === null ? null : <Denial error={act.error} resource="place" />}
      {move.error === null ? null : <Denial error={move.error} resource="place" />}

      {parameters.length === 0 ? null : (
        <p className="text-muted-foreground text-sm">
          Attributes on this floor: {parameters.map((parameter) => parameter.label).join(", ")}
        </p>
      )}

      <PlacesBody
        loading={places.data === undefined}
        places={shown}
        words={words}
        view={view}
        selectedId={selectedId}
        onSelect={setSelectedId}
        editor={editor}
      />
    </PageShell>
  );
}

/** Where a new one goes, if the person adding it already knows. Blank leaves it unplaced. */
function Coordinates({
  words,
  row,
  number,
  valid,
  onRow,
  onNumber,
}: {
  words: PlaceWords;
  row: string;
  number: string;
  valid: boolean;
  onRow: (value: string) => void;
  onNumber: (value: string) => void;
}) {
  return (
    <>
      <Field label={words.row} width="w-20">
        <input
          value={row}
          maxLength={4}
          placeholder="H"
          onChange={(event) => {
            onRow(event.target.value);
          }}
          className={controlClass}
        />
      </Field>
      <Field label={words.number} width="w-24">
        <input
          value={number}
          inputMode="numeric"
          placeholder="14"
          onChange={(event) => {
            onNumber(event.target.value);
          }}
          className={controlClass}
        />
      </Field>
      {valid ? null : <p className="text-muted-foreground text-xs">{coordinateHint(words)}</p>}
    </>
  );
}

function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => {
            onChange(option.key);
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            value === option.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What the last create actually did. A grid that skipped everything is the normal answer to
 * running it twice, and saying so is the difference between idempotent and broken.
 */
function CreateSummary({
  result,
  words,
}: {
  result: { places: readonly Place[]; skipped: readonly string[] };
  words: PlaceWords;
}) {
  if (result.places.length < 2 && result.skipped.length === 0) return null;
  return (
    <p className="text-muted-foreground text-sm">
      Created {result.places.length} {words.many.toLowerCase()}.
      {result.skipped.length === 0
        ? ""
        : ` ${result.skipped.length} already existed and were left as they were: ${result.skipped.slice(0, 8).join(", ")}${result.skipped.length > 8 ? "…" : ""}`}
    </p>
  );
}

function PlacesBody({
  loading,
  places,
  words,
  view,
  selectedId,
  onSelect,
  editor,
}: {
  loading: boolean;
  places: readonly Place[];
  words: PlaceWords;
  view: View;
  selectedId: string | null;
  onSelect: (id: string) => void;
  editor: React.ReactNode;
}) {
  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (places.length === 0) {
    return (
      <Empty
        icon={words.emptyIcon}
        title={`No ${words.many.toLowerCase()} yet`}
        detail={words.emptyDetail}
      />
    );
  }
  if (view === "map") {
    return (
      <SeatMap
        places={places}
        words={words}
        selectedId={selectedId}
        onSelect={onSelect}
        editor={editor}
      />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {places.map((place) => (
        <li key={place.id}>
          <PlaceTile
            place={place}
            words={words}
            selected={place.id === selectedId}
            onSelect={onSelect}
            editor={editor}
          />
        </li>
      ))}
    </ul>
  );
}

function PlaceTile({
  place,
  words,
  selected,
  onSelect,
  editor,
}: {
  place: Place;
  words: PlaceWords;
  selected: boolean;
  onSelect: (id: string) => void;
  editor: React.ReactNode;
}) {
  const tone = toneFor(place.status);
  return (
    <Card className={cn("h-full", tone.cell)}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold text-lg">{place.label}</p>
          <span className="text-xs opacity-80">
            {place.capacity} {words.capacity.toLowerCase()}
          </span>
        </div>

        {/* Not a Badge: its outline variant paints text-foreground, which an occupied card's
            own fill would then have to fight. Inheriting the card's colour cannot clash. */}
        <p className="flex items-center gap-1 font-medium text-xs">
          <span aria-hidden="true">{tone.mark}</span>
          {tone.word}
        </p>

        {place.rowLabel === null || place.columnNumber === null ? null : (
          <p className="text-xs opacity-80">
            {words.row} {place.rowLabel} · {place.columnNumber}
          </p>
        )}

        {place.parameters.length === 0 ? null : (
          <ul className="space-y-0.5 text-xs opacity-80">
            {place.parameters.map((parameter) => (
              <li key={parameter.definitionId}>
                {parameter.label}:{" "}
                {Array.isArray(parameter.value)
                  ? parameter.value.join(", ")
                  : String(parameter.value)}
              </li>
            ))}
          </ul>
        )}

        {selected ? (
          editor
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              onSelect(place.id);
            }}
          >
            Change
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
