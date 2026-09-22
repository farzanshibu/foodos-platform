/**
 * SOT: server-driven-form, generic-form-renderer, request-form-fields
 * WHAT   Renders a form from a schema the server sent, and knows nothing else.
 * WHY    This file is the point of the whole request feature. There is no branch anywhere in
 *        it on which request type is being filled in - no `if (key === "charger")`, no list of
 *        known forms. A restaurant adding "request a high chair" this afternoon gets a working
 *        form on every phone in the room without anybody shipping a client.
 * HOW    One case per FIELD TYPE, which is a closed union in the contract. A field type the
 *        renderer cannot draw is one the configuration UI cannot store.
 * WHERE  packages/contracts/src/resources/requests.contract.ts, services/requests/src/form.ts
 */
"use client";

import type { RequestFormField } from "@foodos/contracts";
import { cn } from "@foodos/ui/lib/utils";

export type FormValue = string | number | boolean | string[];

export function RequestFormFields({
  fields,
  values,
  onChange,
}: {
  fields: readonly RequestFormField[];
  values: Record<string, FormValue>;
  onChange: (key: string, value: FormValue) => void;
}) {
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <Field key={field.key} field={field} value={values[field.key]} onChange={onChange} />
      ))}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

function Field({
  field,
  value,
  onChange,
}: {
  field: RequestFormField;
  value: FormValue | undefined;
  onChange: (key: string, value: FormValue) => void;
}) {
  const label = (
    <span className="font-medium text-foreground text-sm">
      {field.label}
      {field.required ? <span className="text-muted-foreground"> *</span> : null}
    </span>
  );
  const help =
    field.help === undefined ? null : (
      <span className="block text-muted-foreground text-xs">{field.help}</span>
    );

  switch (field.type) {
    case "text":
    case "phone":
      return (
        <label className="block space-y-1">
          {label}
          {help}
          <input
            type={field.type === "phone" ? "tel" : "text"}
            value={typeof value === "string" ? value : ""}
            maxLength={field.type === "text" ? field.maxLength : undefined}
            onChange={(event) => {
              onChange(field.key, event.target.value);
            }}
            className={inputClass}
          />
        </label>
      );

    case "textarea":
      return (
        <label className="block space-y-1">
          {label}
          {help}
          <textarea
            rows={3}
            value={typeof value === "string" ? value : ""}
            maxLength={field.maxLength}
            onChange={(event) => {
              onChange(field.key, event.target.value);
            }}
            className={inputClass}
          />
        </label>
      );

    case "number":
      return (
        <label className="block space-y-1">
          {label}
          {help}
          <input
            type="number"
            inputMode="numeric"
            value={typeof value === "number" ? value : ""}
            min={field.min}
            max={field.max}
            onChange={(event) => {
              onChange(field.key, Number(event.target.value));
            }}
            className={inputClass}
          />
        </label>
      );

    case "toggle":
      return (
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span>
            {label}
            {help}
          </span>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => {
              onChange(field.key, event.target.checked);
            }}
          />
        </label>
      );

    case "rating":
      return (
        <fieldset className="space-y-2">
          <legend>{label}</legend>
          {help}
          <div className="flex gap-2">
            {Array.from({ length: field.scale }, (_, index) => index + 1).map((score) => (
              <button
                key={score}
                type="button"
                onClick={() => {
                  onChange(field.key, score);
                }}
                className={cn(
                  "size-10 rounded-md border text-sm",
                  value === score
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {score}
              </button>
            ))}
          </div>
        </fieldset>
      );

    case "select":
      return (
        <fieldset className="space-y-2">
          <legend>{label}</legend>
          {help}
          {field.options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                value === option ? "border-primary" : "border-border",
              )}
            >
              <input
                type="radio"
                name={field.key}
                checked={value === option}
                onChange={() => {
                  onChange(field.key, option);
                }}
              />
              {option}
            </label>
          ))}
        </fieldset>
      );

    default: {
      const held = Array.isArray(value) ? value : [];
      return (
        <fieldset className="space-y-2">
          <legend>{label}</legend>
          {help}
          {field.options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                held.includes(option) ? "border-primary" : "border-border",
              )}
            >
              <input
                type="checkbox"
                checked={held.includes(option)}
                onChange={() => {
                  onChange(
                    field.key,
                    held.includes(option)
                      ? held.filter((entry) => entry !== option)
                      : [...held, option],
                  );
                }}
              />
              {option}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}
