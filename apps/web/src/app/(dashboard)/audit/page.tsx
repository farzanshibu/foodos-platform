/**
 * SOT: audit-page, audit-toolbar-mount
 * WHAT   The audit trail with its toolbar.
 * WHY    Free-plan organisations never reach this page: auditLog is not in their plan, so
 *        the dashboard layout redirects them to billing first. Nothing here checks for
 *        that. The rows are fetched once and handed to the client table, whose filters are
 *        derived from the data itself.
 * HOW    api.audit.list is the only door; AuditTable owns everything interactive.
 * WHERE  apps/web/src/features/audit/audit-table.tsx
 */
import { AuditTable } from "@/features/audit/audit-table";
import { PageShell } from "@/features/manage/page-shell";
import { api } from "@/trpc/server";

export default async function AuditPage() {
  const { items } = await api.audit.list({ limit: 200 });
  return (
    <PageShell
      title="Audit log"
      description="Every change anybody made, who made it, and whether the platform allowed it."
    >
      <AuditTable items={items} />
    </PageShell>
  );
}
