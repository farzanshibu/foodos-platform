/**
 * SOT: branch-picker, branch-scope
 * WHAT   Which branch the screen is about.
 * WHY    Every operational screen is per branch - a pass, a floor, a queue of requests all
 *        belong to one building. A single-branch restaurant never sees this at all, because
 *        asking somebody to choose between one thing is a control that only wastes a tap.
 */
"use client";

import type { OutputOf } from "@foodos/contracts";

type Branch = OutputOf<"branch", "read">["items"][number];

export function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: Branch[];
  value: string;
  onChange: (branchId: string) => void;
}) {
  if (branches.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
    >
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name}
        </option>
      ))}
    </select>
  );
}
