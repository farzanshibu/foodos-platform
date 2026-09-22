/**
 * SOT: card-designer, printable-card, request-card-design, card-preview
 * WHAT   Designing the cards that go on tables and counters: the words, the colours, and the
 *        code that makes them work.
 * WHY    Attaching a request type mints the authoritative QR on the server when the design is
 *        saved. Nothing here invents a token, because a code the server will not recognise is
 *        a code that opens an error page on something already printed.
 * HOW    The preview is drawn at the template's true millimetre proportions, so what is on
 *        screen is the shape that comes out of the printer - and the minimum QR size for each
 *        template is enforced by the qr service, not suggested here.
 * WHERE  services/qr/src/card.handlers.ts
 */
"use client";

import type { OutputOf } from "@foodos/contracts";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial } from "@foodos/ui/denial";
import { Gate } from "@foodos/ui/gate";
import { cn } from "@foodos/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { controlClass, Field, ListCard, ListRow } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
/**
 * The physical facts, shared with the hosted card page so a design cannot preview at one
 * shape and print at another. The qr service still enforces the minimums on save.
 */
import {
  CARD_TEMPLATE_SPECS,
  type CardTemplate,
  DEFAULT_CARD_TEMPLATE,
} from "@/features/qr/card-templates";
import { useTRPC } from "@/trpc/react";

type RequestType = OutputOf<"requestType", "read">["items"][number];

export function CardDesigner({ requestTypes }: { requestTypes: RequestType[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [template, setTemplate] = useState<CardTemplate>(DEFAULT_CARD_TEMPLATE);
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("NEED A CHARGER?");
  const [subheadline, setSubheadline] = useState("Scan and we'll bring one over");
  const [footer, setFooter] = useState("");
  const [requestTypeId, setRequestTypeId] = useState("");
  const [qrMm, setQrMm] = useState(String(DEFAULT_CARD_TEMPLATE.minQrMm));

  const designs = useQuery(trpc.cardDesign.list.queryOptions({ limit: 50, cursor: null }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.cardDesign.list.queryKey() });
  };
  const create = useMutation(
    trpc.cardDesign.create.mutationOptions({
      onSuccess: () => {
        setName("");
        refresh();
      },
    }),
  );
  const render = useMutation(trpc.cardDesign.render.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.cardDesign.remove.mutationOptions({ onSuccess: refresh }));

  const size = Math.max(template.minQrMm, Number(qrMm) || template.minQrMm);

  return (
    <PageShell
      title="Card designer"
      description="Printable cards with a working code on them. Table tents, stickers, posters."
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Gate resource="cardDesign" operation="create">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap gap-2">
                {CARD_TEMPLATE_SPECS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                      setTemplate(entry);
                      setQrMm(String(entry.minQrMm));
                    }}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm transition-colors",
                      template.key === entry.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Field label="Design name" width="w-52">
                  <input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    placeholder="Charger tent"
                    className={controlClass}
                  />
                </Field>
                <Field label="Opens which request" width="w-52">
                  <select
                    value={requestTypeId}
                    onChange={(event) => {
                      setRequestTypeId(event.target.value);
                    }}
                    className={controlClass}
                  >
                    <option value="">Just the menu</option>
                    {requestTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`QR size (min ${String(template.minQrMm)}mm)`} width="w-40">
                  <input
                    value={qrMm}
                    inputMode="numeric"
                    onChange={(event) => {
                      setQrMm(event.target.value);
                    }}
                    className={controlClass}
                  />
                </Field>
              </div>

              <Field label="Headline">
                <input
                  value={headline}
                  maxLength={40}
                  onChange={(event) => {
                    setHeadline(event.target.value);
                  }}
                  className={controlClass}
                />
              </Field>
              <Field label="Underneath">
                <input
                  value={subheadline}
                  maxLength={80}
                  onChange={(event) => {
                    setSubheadline(event.target.value);
                  }}
                  className={controlClass}
                />
              </Field>
              <Field label="Small print">
                <input
                  value={footer}
                  maxLength={60}
                  placeholder="Powered by FoodOS"
                  onChange={(event) => {
                    setFooter(event.target.value);
                  }}
                  className={controlClass}
                />
              </Field>

              {create.error === null ? null : <Denial error={create.error} />}

              <Button
                disabled={name.trim() === "" || headline.trim().length < 2}
                loading={create.isPending}
                onClick={() => {
                  create.mutate({
                    name: name.trim(),
                    template: template.key,
                    theme: {
                      bg: "#ffffff",
                      accent: "#111111",
                      text: "#111111",
                      headline: headline.trim(),
                      showPlaceLabel: true,
                      qr: { sizeMm: size, position: "center" },
                      ...(subheadline.trim() === "" ? {} : { subheadline: subheadline.trim() }),
                      ...(footer.trim() === "" ? {} : { footer: footer.trim() }),
                    },
                    ...(requestTypeId === "" ? {} : { requestTypeId }),
                  });
                }}
              >
                Save design
              </Button>
            </CardContent>
          </Card>
        </Gate>

        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="font-medium text-foreground text-sm">Preview</p>
            <p className="text-muted-foreground text-xs">
              {template.widthMm} × {template.heightMm} mm
            </p>
            <div
              className="mx-auto flex flex-col items-center justify-center gap-2 border border-border bg-card p-4 text-center"
              style={{ aspectRatio: `${template.widthMm} / ${template.heightMm}` }}
            >
              <p className="font-bold text-foreground text-sm leading-tight">{headline}</p>
              {subheadline === "" ? null : (
                <p className="text-[10px] text-muted-foreground leading-tight">{subheadline}</p>
              )}
              <div
                className="flex items-center justify-center border border-foreground border-dashed text-[8px] text-muted-foreground"
                style={{
                  width: `${String((size / template.widthMm) * 100)}%`,
                  aspectRatio: "1 / 1",
                }}
              >
                QR {size}mm
              </div>
              {footer === "" ? null : <p className="text-[8px] text-muted-foreground">{footer}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {render.error === null ? null : <Denial error={render.error} />}

      {designs.data === undefined ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : designs.data.items.length === 0 ? (
        <Empty
          icon="🖨️"
          title="No designs yet"
          detail="Design one, render it, and print as many as you have tables."
        />
      ) : (
        <ListCard>
          <ul>
            {designs.data.items.map((design) => (
              <li key={design.id}>
                <ListRow
                  title={design.name}
                  subtitle={`${design.template.replace(/_/g, " ")} · ${design.theme.headline}${
                    design.qrToken === null ? "" : ` · ${design.qrToken}`
                  } · ${design.hostedPath}`}
                  meta={
                    design.requestTypeId === null ? (
                      <Badge variant="outline">menu</Badge>
                    ) : (
                      <Badge variant="secondary">request card</Badge>
                    )
                  }
                  actions={
                    <div className="flex gap-2">
                      <Gate resource="cardDesign" operation="manage">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={render.isPending}
                          onClick={() => {
                            render.mutate({ id: design.id, format: "svg" });
                          }}
                        >
                          Render
                        </Button>
                      </Gate>
                      <Gate resource="cardDesign" operation="delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            remove.mutate({ id: design.id });
                          }}
                        >
                          Delete
                        </Button>
                      </Gate>
                    </div>
                  }
                />
              </li>
            ))}
          </ul>
        </ListCard>
      )}
    </PageShell>
  );
}
