/**
 * SOT: qr-manager, qr-generation, token-rotation-ui, qr-scan-analytics
 * WHAT   Making the codes a restaurant puts on its tables, and seeing what they did.
 * WHY    Rotating a token is the one destructive thing on this screen - every card already
 *        printed with the old one stops working - so it asks first and says exactly that,
 *        rather than being a quiet icon next to the others.
 * HOW    The token shown is the server's. Nothing here generates one, because a code the
 *        server will not recognise is a code that opens an error page on a table tent.
 * WHERE  services/qr/src/qr.handlers.ts, services/qr/src/token.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BranchPicker } from "@/features/manage/branch-picker";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type Restaurant = OutputOf<"restaurant", "read">["items"][number];
type Branch = OutputOf<"branch", "read">["items"][number];
type Table = OutputOf<"place", "read">["items"][number];
type Code = OutputOf<"qrCode", "read">["items"][number];

export function QrManager({
  restaurants,
  branches,
  tables,
}: {
  restaurants: Restaurant[];
  branches: Branch[];
  tables: Table[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rendered, setRendered] = useState<string | null>(null);

  const codes = useQuery(
    trpc.qrCode.list.queryOptions({
      limit: 100,
      cursor: null,
      ...(branchId === "" ? {} : { branchId }),
    }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.qrCode.list.queryKey() });
  };

  const act = useMutation(
    trpc.qrCode.codeAction.mutationOptions({
      onSuccess: (result) => {
        setRendered(result.render);
        setConfirming(null);
        refresh();
      },
    }),
  );

  const covered = new Set(
    (codes.data?.items ?? []).flatMap((code) => (code.placeId === null ? [] : [code.placeId])),
  );
  const uncovered = tables.filter((table) => table.branchId === branchId && !covered.has(table.id));

  return (
    <PageShell
      title="QR codes"
      description="One code per table. Print them, stick them down, and orders start arriving."
      action={<BranchPicker branches={branches} value={branchId} onChange={setBranchId} />}
    >
      {act.error === null ? null : <Denial error={act.error} />}

      {uncovered.length === 0 ? null : (
        <Card className="border-primary">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-foreground">
              {uncovered.length} table{uncovered.length === 1 ? "" : "s"} on this floor have no code
              yet.
            </p>
            <Gate resource="qrCode" operation="manage">
              <Button
                disabled={act.isPending}
                onClick={() => {
                  act.mutate({
                    action: "bulk_places",
                    branchId,
                    placeIds: uncovered.map((table) => table.id),
                  });
                }}
              >
                Make them all
              </Button>
            </Gate>
          </CardContent>
        </Card>
      )}

      {rendered === null ? null : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-medium text-foreground text-sm">Ready to print</p>
            {/* The server rendered this SVG; nothing here draws a code. */}
            <div
              className="mx-auto w-48 [&>svg]:h-auto [&>svg]:w-full"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered SVG from our own qr service
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setRendered(null);
              }}
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}

      {codes.error !== null ? (
        // A failed read is not a loading one; saying "Loading…" forever hid the real error.
        <Denial error={codes.error} />
      ) : codes.data === undefined ? (
        <SkeletonRows />
      ) : codes.data.items.length === 0 ? (
        <Empty
          icon="🔳"
          title="No codes yet"
          detail={
            restaurants.length === 0
              ? "Create a restaurant and a branch first, then add tables."
              : "Add tables, then make a code for each one."
          }
        />
      ) : (
        <ul className="space-y-2">
          {codes.data.items.map((code) => (
            <li key={code.id}>
              <CodeRow
                code={code}
                confirming={confirming === code.id}
                pending={act.isPending}
                onConfirm={() => {
                  setConfirming(code.id);
                }}
                onCancel={() => {
                  setConfirming(null);
                }}
                onRotate={() => {
                  act.mutate({ action: "rotate", id: code.id });
                }}
                onRender={() => {
                  act.mutate({ action: "render", id: code.id, format: "svg", sizeMm: 40 });
                }}
                onDisable={() => {
                  act.mutate({
                    action: code.status === "active" ? "disable" : "enable",
                    id: code.id,
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function CodeRow({
  code,
  confirming,
  pending,
  onConfirm,
  onCancel,
  onRotate,
  onRender,
  onDisable,
}: {
  code: Code;
  confirming: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRotate: () => void;
  onRender: () => void;
  onDisable: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{code.label ?? code.type}</p>
          <p className="font-mono text-muted-foreground text-xs">{code.token}</p>
        </div>

        <div className="text-right text-xs">
          <p className="text-foreground">
            {code.scanCount} scans · {code.orderCount} orders
          </p>
          <p className="text-muted-foreground">
            {code.scanCount === 0
              ? "not scanned yet"
              : `${String(Math.round((code.orderCount / code.scanCount) * 100))}% ordered · ${money(code.revenuePaise)}`}
          </p>
        </div>

        <Badge variant={code.status === "active" ? "secondary" : "outline"}>{code.status}</Badge>

        <Gate resource="qrCode" operation="manage">
          {confirming ? (
            <div className="flex items-center gap-2">
              <p className="text-destructive text-xs">
                Every card already printed with this code stops working.
              </p>
              <Button size="sm" variant="destructive" disabled={pending} onClick={onRotate}>
                Rotate anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Keep it
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={onRender}>
                Print
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={onDisable}>
                {code.status === "active" ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={onConfirm}>
                Rotate
              </Button>
            </div>
          )}
        </Gate>
      </CardContent>
    </Card>
  );
}
