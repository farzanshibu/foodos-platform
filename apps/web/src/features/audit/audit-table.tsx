/**
 * SOT: audit-toolbar, audit-filters, member-list-ui, filter-options-from-data
 * WHAT   Search plus action and entity filters over the audit trail, with Clear.
 * WHY    A wall of rows is not an audit log you can answer questions with. The filters'
 *        options are derived from the fetched rows themselves, so a dropdown can never
 *        offer a choice that returns nothing - the option list and the data cannot drift.
 * HOW    <AuditTable items={items} /> from the audit page. Filtering happens in the
 *        component over what the server already sent: the page's query is capped by the
 *        contract (200 rows), so no client-side paging fiction is created here.
 * WHERE  apps/web/src/app/(dashboard)/audit/page.tsx, packages/contracts/src/resources/audit.contract.ts
 */
"use client";

import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { EmptyState } from "@foodos/ui/empty-state";
import { Input } from "@foodos/ui/input";
import { Select } from "@foodos/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@foodos/ui/table";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

export type AuditItem = {
  readonly id: string;
  readonly resource: string;
  readonly operation: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly outcome: string;
  readonly createdAt: Date;
};

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

export function AuditTable({ items }: { items: readonly AuditItem[] }) {
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState<string>("");
  const [action, setAction] = useState<string>("");

  // Options come from the data, so every choice the dropdown offers has at least one row.
  const entities = useMemo(() => unique(items.map((item) => item.resource)), [items]);
  const actions = useMemo(
    () =>
      unique(
        items
          .filter((item) => entity === "" || item.resource === entity)
          .map((item) => item.operation),
      ),
    [items, entity],
  );

  const visible = items.filter((item) => {
    if (entity !== "" && item.resource !== entity) return false;
    if (action !== "" && item.operation !== action) return false;
    if (query === "") return true;
    const haystack = `${item.resource}.${item.operation} ${item.actorRole} ${item.outcome}`;
    return haystack.toLowerCase().includes(query.toLowerCase());
  });

  const dirty = query !== "" || entity !== "" || action !== "";

  function clear(): void {
    setQuery("");
    setEntity("");
    setAction("");
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-56"
            type="search"
            aria-label="Search the audit log"
            placeholder="Search the audit log"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            aria-label="Filter by entity"
            className="w-44"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setAction("");
            }}
          >
            <option value="">All entities</option>
            {entities.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by action"
            className="w-44"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">All actions</option>
            {actions.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </Select>
          {dirty ? (
            <Button variant="outline" size="sm" onClick={clear}>
              Clear
            </Button>
          ) : null}
          <span className="ml-auto text-muted-foreground text-sm tabular-nums">
            {String(visible.length)} of {String(items.length)}
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title={dirty ? "Nothing matches those filters" : "No activity yet"}
            detail={
              dirty
                ? "Clear the filters to see everything the log holds."
                : "Every change anybody makes is recorded here, with who made it and whether it was allowed."
            }
            {...(dirty
              ? {
                  action: (
                    <Button variant="outline" size="sm" onClick={clear}>
                      Clear filters
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.resource}.{entry.operation}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{entry.actorRole}</TableCell>
                  <TableCell>
                    {/* The bus only ever writes "success": a refusal never reaches a
                      consumer, so it never becomes a row here. Anything else is a value
                      this column has not seen before and is worth flagging rather than
                      quietly painting green. */}
                    <Badge variant={entry.outcome === "success" ? "success" : "warning"}>
                      {entry.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs tabular-nums">
                    {entry.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
