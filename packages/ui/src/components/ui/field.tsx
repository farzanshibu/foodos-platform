/**
 * SOT: field, label, form-row, field-error, field-hint
 * WHAT   A labelled control: label, optional hint, the control itself, and the error.
 * WHY    Placeholders were doing the job of labels on several screens, which disappears the
 *        moment somebody types and leaves a screen reader with an unnamed box. A field
 *        wires `htmlFor`, `aria-describedby` and `aria-invalid` so no caller has to
 *        remember three attributes to be accessible.
 * HOW    <Field label="Name" hint="Shown to guests" error={error}><Input …/></Field> - the
 *        control is cloned with the ids it needs, so it stays a plain <Input>.
 */
"use client";

import * as React from "react";

import { cn } from "../../lib/utils";

export function Label({
  className,
  htmlFor,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { readonly htmlFor: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is required by the signature above
    <label
      htmlFor={htmlFor}
      className={cn(
        "font-medium text-foreground text-sm leading-none has-[+_:disabled]:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    required?: boolean;
  }>;
}) {
  const generated = React.useId();
  const id = children.props.id ?? generated;
  const hintId = hint === undefined ? null : `${id}-hint`;
  const errorId = error === undefined || error === null ? null : `${id}-error`;
  const describedBy = [hintId, errorId].filter((value) => value !== null).join(" ");

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {hintId === null ? null : (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {React.cloneElement(children, {
        id,
        required,
        ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
        ...(errorId === null ? {} : { "aria-invalid": true }),
      })}
      {errorId === null ? null : (
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
