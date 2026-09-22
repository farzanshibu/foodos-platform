/**
 * SOT: menu-import-ui, import-dry-run-ui, menu-export-download
 * WHAT   The import flow on the Items screen: pick a CSV, read the whole file back as a
 *        table of what would happen, then confirm. And the export button that produces a file
 *        in exactly the format the import expects.
 * WHY    Nobody should find out what an import did by looking at their menu afterwards. The
 *        dry run is not an optional preview - it is the only way in, and the confirm button
 *        stays disabled while a single row is still wrong, because the catalogue writes all
 *        the rows or none of them. A rejection here reads as a sentence a restaurant manager
 *        can act on, with the row number from their own spreadsheet.
 * HOW    Rows are parsed in the browser by menu-csv.ts and sent already shaped, rejections
 *        included, so the report covers the whole file rather than the part that parsed.
 * WHERE  apps/web/src/features/manage/items-manager.tsx, services/catalog/src/menu-import.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@foodos/ui/table";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { type MenuCsvParse, parseMenuCsv } from "@/features/manage/menu-csv";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Report = NonNullable<OutputOf<"menuItem", "manage">["report"]>;
type ReportRow = Report["rows"][number];
type ParsedFile = Extract<MenuCsvParse, { ok: true }>;

/** The browser hands the file to the person who asked for it; nothing is stored anywhere. */
function saveCsv(csv: string, name: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function OutcomeBadge({ outcome }: { outcome: ReportRow["outcome"] }) {
  if (outcome === "create") return <Badge variant="secondary">Add</Badge>;
  if (outcome === "update") return <Badge variant="outline">Update</Badge>;
  return <Badge variant="destructive">Rejected</Badge>;
}

function ReportTable({ report }: { report: Report }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Row</TableHead>
          <TableHead>Dish</TableHead>
          <TableHead>Section</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>What happens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => (
          <TableRow key={row.rowNumber}>
            <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
            <TableCell className="font-medium text-foreground">
              {row.name === "" ? "—" : row.name}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.category === "" ? "—" : row.category}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.pricePaise === null ? "—" : money(row.pricePaise)}
            </TableCell>
            <TableCell className="space-y-1">
              <OutcomeBadge outcome={row.outcome} />
              {row.reasons.map((reason) => (
                <p key={reason} className="text-destructive text-xs">
                  {reason}
                </p>
              ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One sentence saying whether this file may be imported, and why not when it may not. */
function Verdict({ report, imported }: { report: Report; imported: number | null }) {
  if (imported !== null) {
    return (
      <p className="text-foreground text-sm" role="status">
        Imported {imported} {imported === 1 ? "dish" : "dishes"}. They are on the menu now.
      </p>
    );
  }
  if (report.rejectCount > 0) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {report.rejectCount} of {report.rows.length}{" "}
        {report.rows.length === 1 ? "row needs" : "rows need"} fixing. Nothing is imported until
        every row is right — correct them in your spreadsheet and pick the file again.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-sm">
      {report.createCount} to add, {report.updateCount} to update. Nothing has changed yet.
    </p>
  );
}

export function MenuImport({ menuId, onImported }: { menuId: string; onImported: () => void }) {
  const trpc = useTRPC();
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const check = useMutation(
    trpc.menuItem.bulk.mutationOptions({
      onSuccess: (result) => {
        setReport(result.report);
      },
    }),
  );
  const apply = useMutation(
    trpc.menuItem.bulk.mutationOptions({
      onSuccess: (result) => {
        setReport(result.report);
        // A commit can still come back refused: somebody may have deleted a section between
        // the check and the confirm. Nothing was written, so this stays on the report rather
        // than claiming an import of nothing.
        if (result.report !== null && result.report.rejectCount > 0) return;
        setImported(result.changed);
        onImported();
      },
    }),
  );
  const download = useMutation(
    trpc.menuItem.bulk.mutationOptions({
      onSuccess: (result) => {
        if (result.document !== null) saveCsv(result.document, `menu-${menuId}`);
      },
    }),
  );

  const send = (parsed: ParsedFile, dryRun: boolean) => ({
    action: "import" as const,
    menuId,
    dryRun,
    totalRows: parsed.totalRows,
    rows: parsed.rows,
    rejected: parsed.rejected,
  });

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Cleared so that picking the same file again, after fixing it, runs the check again.
    event.target.value = "";
    if (picked === undefined) return;
    setProblem(null);
    setReport(null);
    setImported(null);
    setFile(null);
    void picked.text().then((text) => {
      const parsed = parseMenuCsv(text);
      if (!parsed.ok) {
        setProblem(parsed.problem);
        return;
      }
      setFile(parsed);
      check.mutate(send(parsed, true));
    });
  };

  return (
    <Gate resource="menuItem" operation="manage">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-60 flex-1 space-y-1">
              <p className="font-medium text-foreground text-sm">
                Import a menu from a spreadsheet
              </p>
              <p className="text-muted-foreground text-xs">
                Save your sheet as CSV. Every row is checked before anything is written, and a file
                with one bad row imports nothing.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending || menuId === ""}
              onClick={() => {
                download.mutate({ action: "export", menuId });
              }}
            >
              Export this menu
            </Button>
          </div>

          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Menu CSV file"
            disabled={check.isPending || apply.isPending || menuId === ""}
            onChange={onPick}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-secondary-foreground file:text-sm"
          />

          {problem === null ? null : (
            <p className="text-destructive text-sm" role="alert">
              {problem}
            </p>
          )}
          {check.error === null ? null : <Denial error={check.error} resource="menuItem" />}
          {apply.error === null ? null : <Denial error={apply.error} resource="menuItem" />}
          {download.error === null ? null : <Denial error={download.error} resource="menuItem" />}
          {check.isPending ? (
            <p className="text-muted-foreground text-sm">Checking every row…</p>
          ) : null}

          {report === null ? null : (
            <div className="space-y-3">
              <Verdict report={report} imported={imported} />
              <div className="rounded-md border border-border">
                <ReportTable report={report} />
              </div>
              {imported !== null || file === null ? null : (
                <Button
                  disabled={apply.isPending || report.rejectCount > 0}
                  onClick={() => {
                    apply.mutate(send(file, false));
                  }}
                >
                  Import {report.createCount + report.updateCount}{" "}
                  {report.createCount + report.updateCount === 1 ? "dish" : "dishes"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Gate>
  );
}
