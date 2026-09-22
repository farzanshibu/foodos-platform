/**
 * SOT: over-plan-banner, over-plan, plan-overages, exceeded-plan
 * WHAT   The banner every page shows while an organisation is running past its plan.
 * WHY    An org can exceed its plan however it likes - usage recorded before a downgrade,
 *        a change made directly in the billing provider - and the old behaviour was to
 *        carry on as if the plan still fit. Saying so once per page, naming what must come
 *        down, is the honest version. It disappears the moment the tenant fits again.
 * HOW    The dashboard layout computes `planOverages(entitlements)` - the same pure
 *        derivation the billing service refuses downgrades with - and renders this above
 *        everything else. Rows are labels from the registry; nothing here knows a limit.
 * HOW    Warning, not danger: nothing has broken and nothing is being taken away yet, and a
 *        red bar on every page for a soft state is how people learn to ignore red bars.
 * WHERE  apps/web/src/app/(dashboard)/layout.tsx, packages/registry/src/derive.ts
 */
import { BILLING_HREF } from "@foodos/registry";

import { Alert } from "./ui/alert";

export function OverPlanBanner({ rows }: { readonly rows: readonly string[] }) {
  if (rows.length === 0) return null;
  const one = rows.length === 1;
  return (
    <Alert
      tone="warning"
      className="rounded-none border-x-0 border-t-0 px-4 md:px-8"
      title="Over your plan"
    >
      <p>
        <strong className="font-medium text-foreground">{rows.join(", ")}</strong> exceed
        {one ? "s" : ""} the amount your plan includes. Bring {one ? "it" : "them"} back within the
        plan
        {BILLING_HREF === undefined ? null : (
          <>
            {" or "}
            <a href={BILLING_HREF}>change plan</a>
          </>
        )}
        .
      </p>
    </Alert>
  );
}
