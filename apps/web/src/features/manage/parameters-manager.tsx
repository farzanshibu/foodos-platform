/**
 * SOT: parameters-manager, table-attributes, generic-parameter-engine
 * WHAT   The custom attributes a restaurant decides its tables have.
 * WHY    This is the configuration half of a generic engine. Nothing in the product knows
 *        what a "window seat" is - it is a row with a data type, and the type is what the
 *        floor service validates values against. Adding one here makes it appear on the
 *        table editor, in the QR session header and in reservation matching at once.
 * HOW    Deleting is soft. Occupancy reports still read last quarter's values, and a hard
 *        delete would take their labels with them.
 * WHERE  services/floor/src/floor.handlers.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CreateRow, controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { useTRPC } from "@/trpc/react";

type Parameter = OutputOf<"parameterDefinition", "read">["items"][number];

const TYPES = [
  { key: "boolean", label: "Yes or no" },
  { key: "select", label: "One of a list" },
  { key: "multi_select", label: "Any of a list" },
  { key: "number", label: "A number" },
  { key: "text", label: "Free text" },
] as const;

const CATEGORIES = ["seating", "ambience", "location", "service", "custom"] as const;

const slugify = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

export function ParametersManager() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState<(typeof TYPES)[number]["key"]>("boolean");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("custom");
  const [options, setOptions] = useState("AC, Non-AC, Outdoor");
  const [visible, setVisible] = useState(true);

  const parameters = useQuery(
    trpc.parameterDefinition.list.queryOptions({
      limit: 50,
      cursor: null,
      customerVisibleOnly: false,
      includeInactive: false,
    }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.parameterDefinition.list.queryKey() });
  };
  const create = useMutation(
    trpc.parameterDefinition.create.mutationOptions({
      onSuccess: () => {
        setLabel("");
        refresh();
      },
    }),
  );
  const update = useMutation(
    trpc.parameterDefinition.update.mutationOptions({ onSuccess: refresh }),
  );
  const remove = useMutation(
    trpc.parameterDefinition.remove.mutationOptions({ onSuccess: refresh }),
  );

  const needsOptions = dataType === "select" || dataType === "multi_select";
  const parsedOptions = options
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");

  return (
    <PageShell
      title="Table attributes"
      description="Zone, window seat, charging point — whatever matters about your tables."
    >
      <Gate resource="parameterDefinition" operation="create">
        <CreateRow>
          <Field label="What is it called?">
            <input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              placeholder="Window seat"
              className={controlClass}
            />
          </Field>
          <Field label="Kind of answer" width="w-44">
            <select
              value={dataType}
              onChange={(event) => {
                const chosen = TYPES.find((entry) => entry.key === event.target.value);
                if (chosen !== undefined) setDataType(chosen.key);
              }}
              className={controlClass}
            >
              {TYPES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Group" width="w-36">
            <select
              value={category}
              onChange={(event) => {
                const chosen = CATEGORIES.find((entry) => entry === event.target.value);
                if (chosen !== undefined) setCategory(chosen);
              }}
              className={controlClass}
            >
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>
          {needsOptions ? (
            <Field label="Options — comma separated">
              <input
                value={options}
                onChange={(event) => {
                  setOptions(event.target.value);
                }}
                className={controlClass}
              />
            </Field>
          ) : null}
          <label className="flex items-center gap-2 pb-2 text-foreground text-sm">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => {
                setVisible(event.target.checked);
              }}
            />
            guests can see it
          </label>
          <Button
            disabled={
              create.isPending ||
              label.trim().length < 2 ||
              (needsOptions && parsedOptions.length === 0)
            }
            onClick={() => {
              create.mutate({
                key: slugify(label),
                label: label.trim(),
                dataType,
                category,
                isCustomerVisible: visible,
                isFilterable: true,
                options: needsOptions ? parsedOptions : [],
                sortOrder: parameters.data?.items.length ?? 0,
              });
            }}
          >
            Add attribute
          </Button>
        </CreateRow>
      </Gate>

      {create.error === null ? null : <Denial error={create.error} />}
      {remove.error === null ? null : <Denial error={remove.error} />}

      {parameters.data === undefined ? (
        <SkeletonRows />
      ) : parameters.data.items.length === 0 ? (
        <Empty
          icon="🏷️"
          title="No attributes yet"
          detail="Add one and it appears on every table editor and in the guest's header."
        />
      ) : (
        <ListCard>
          <ul>
            {parameters.data.items.map((parameter) => (
              <li key={parameter.id}>
                <ParameterRow
                  parameter={parameter}
                  pending={update.isPending || remove.isPending}
                  onToggleVisible={() => {
                    update.mutate({
                      id: parameter.id,
                      isCustomerVisible: !parameter.isCustomerVisible,
                    });
                  }}
                  onRetire={() => {
                    remove.mutate({ id: parameter.id });
                  }}
                />
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}

function ParameterRow({
  parameter,
  onToggleVisible,
  onRetire,
  pending,
}: {
  parameter: Parameter;
  onToggleVisible: () => void;
  onRetire: () => void;
  pending: boolean;
}) {
  const shape = parameter.dataType.replace(/_/g, " ");
  const choices = parameter.options.length === 0 ? "" : ` · ${parameter.options.join(", ")}`;

  return (
    <ListRow
      title={parameter.label}
      subtitle={`${shape}${choices} · ${parameter.category}`}
      meta={
        <div className="flex gap-1">
          {parameter.isSystem ? <Badge variant="outline">built in</Badge> : null}
          <Badge variant={parameter.isCustomerVisible ? "secondary" : "outline"}>
            {parameter.isCustomerVisible ? "guests see it" : "internal"}
          </Badge>
        </div>
      }
      actions={
        parameter.isSystem ? null : (
          <div className="flex gap-2">
            <Gate resource="parameterDefinition" operation="update">
              <Button size="sm" variant="outline" disabled={pending} onClick={onToggleVisible}>
                {parameter.isCustomerVisible ? "Hide from guests" : "Show to guests"}
              </Button>
            </Gate>
            <Gate resource="parameterDefinition" operation="delete">
              <Button size="sm" variant="ghost" disabled={pending} onClick={onRetire}>
                Retire
              </Button>
            </Gate>
          </div>
        )
      }
    />
  );
}
