/**
 * SOT: request-form-validator, server-driven-form, form-schema-validation
 * WHAT   Turns a stored form schema into a validator, at the moment a request is submitted.
 * WHY    This is what makes the server-driven form safe. The browser renders whatever the
 *        schema said when it loaded; by the time somebody submits, staff may have changed it.
 *        Validating against the CURRENT schema - not the one that was rendered - is the
 *        difference between a configurable form and an open JSONB column.
 * HOW    Built from the same discriminated union the contract publishes, so a field type the
 *        renderer cannot draw is a field this cannot be asked to validate.
 * WHERE  services/requests/src/request.handlers.ts, packages/contracts/src/resources/requests.contract.ts
 */
import "server-only";

import {
  type RequestFormField,
  type RequestFormSchema,
  requestFormSchema,
  ServiceError,
} from "@foodos/contracts";

export type FormValue = string | number | boolean | readonly string[];

/** A label/value pair per answered field, so a console does not re-derive labels from keys. */
export type FormSummaryEntry = { label: string; value: string };

function fieldsOf(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null) return new Map();
  const entries: ReadonlyMap<string, unknown> = new Map(Object.entries(value));
  return entries;
}

function refuse(label: string, expectation: string): never {
  throw new ServiceError("INVALID_INPUT", `"${label}" ${expectation}.`);
}

function validateText(
  field: Extract<RequestFormField, { type: "text" | "textarea" }>,
  raw: unknown,
): string {
  if (typeof raw !== "string") return refuse(field.label, "must be text");
  const trimmed = raw.trim();
  if (field.maxLength !== undefined && trimmed.length > field.maxLength) {
    refuse(field.label, `must be ${field.maxLength} characters or fewer`);
  }
  if (field.type === "text" && field.pattern !== undefined) {
    if (!new RegExp(field.pattern).test(trimmed)) {
      refuse(field.label, "is not in the right format");
    }
  }
  return trimmed;
}

function validateMultiSelect(
  field: Extract<RequestFormField, { type: "multi_select" }>,
  raw: unknown,
): readonly string[] {
  if (!Array.isArray(raw)) return refuse(field.label, "must be a list of choices");
  const chosen = raw.filter((entry): entry is string => typeof entry === "string");
  if (chosen.length !== raw.length || chosen.some((entry) => !field.options.includes(entry))) {
    refuse(field.label, `must only contain: ${field.options.join(", ")}`);
  }
  if (new Set(chosen).size !== chosen.length) refuse(field.label, "has the same choice twice");
  if (field.minSelections !== undefined && chosen.length < field.minSelections) {
    refuse(field.label, `needs at least ${field.minSelections} choices`);
  }
  if (field.maxSelections !== undefined && chosen.length > field.maxSelections) {
    refuse(field.label, `allows at most ${field.maxSelections} choices`);
  }
  return chosen;
}

function validateNumber(
  field: Extract<RequestFormField, { type: "number" }>,
  raw: unknown,
): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return refuse(field.label, "must be a number");
  if (field.min !== undefined && raw < field.min) {
    refuse(field.label, `must be at least ${field.min}`);
  }
  if (field.max !== undefined && raw > field.max) {
    refuse(field.label, `must be at most ${field.max}`);
  }
  return raw;
}

/** One branch per field type, each delegating anything with more than one rule in it. */
function validatePresent(field: RequestFormField, raw: unknown): FormValue {
  switch (field.type) {
    case "text":
    case "textarea":
      return validateText(field, raw);
    case "number":
      return validateNumber(field, raw);
    case "phone":
      return typeof raw === "string" && /^\+?[0-9]{7,15}$/.test(raw.trim())
        ? raw.trim()
        : refuse(field.label, "must be a phone number");
    case "toggle":
      return typeof raw === "boolean" ? raw : refuse(field.label, "must be yes or no");
    case "rating":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= field.scale
        ? raw
        : refuse(field.label, `must be a rating from 1 to ${field.scale}`);
    case "select":
      return typeof raw === "string" && field.options.includes(raw)
        ? raw
        : refuse(field.label, `must be one of: ${field.options.join(", ")}`);
    default:
      return validateMultiSelect(field, raw);
  }
}

function validateField(field: RequestFormField, raw: unknown): FormValue | null {
  if (raw === undefined || raw === null || raw === "") {
    if (field.required) refuse(field.label, "is required");
    return null;
  }
  return validatePresent(field, raw);
}

/**
 * Validates a submission against the schema as it is right now, and returns both the cleaned
 * data and a rendered summary. Unknown keys are dropped rather than stored: the schema is
 * authoritative, and a field nobody declared is a field nobody will ever read.
 */
export function validateSubmission(
  schema: RequestFormSchema,
  submitted: unknown,
): { data: Record<string, FormValue>; summary: FormSummaryEntry[] } {
  const raw = fieldsOf(submitted);
  const data: Record<string, FormValue> = {};
  const summary: FormSummaryEntry[] = [];

  for (const field of schema.fields) {
    const value = validateField(field, raw.get(field.key));
    if (value === null) continue;
    data[field.key] = value;
    summary.push({
      label: field.label,
      value: Array.isArray(value) ? value.join(", ") : String(value),
    });
  }

  return { data, summary };
}

/**
 * Narrows a stored schema by parsing it with the very schema the contract publishes, rather
 * than asserting a shape. A JSONB column can hold anything, including a form written by an
 * older version of this code, and a request nobody can validate is a request nobody may accept.
 */
export function readFormSchema(value: unknown): RequestFormSchema {
  const parsed = requestFormSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServiceError("INTERNAL", "This request type's form could not be read.");
  }
  return parsed.data;
}
