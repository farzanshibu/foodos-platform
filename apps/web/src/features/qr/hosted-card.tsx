/**
 * SOT: hosted-card, card-artwork, card-print-sheet
 * WHAT   A card design shown at the shape it prints at, with whatever artwork the render
 *        command has produced for it.
 * WHY    The render command answers with an acceptance and leaves the file on the design.
 *        This is where the file is collected: one page, one card, nothing else on it, so
 *        Print puts the card on paper and not a dashboard around it.
 * HOW    The stored SVG is NEVER inlined into this document. It is handed to an <Image> as
 *        a data: URI, which browsers load in image mode - no script, no external fetch, no
 *        access to this origin - so markup produced by a service cannot become script
 *        running next to a staff session. See `svgDataUri` below.
 * HOW    Only the geometry is reproduced here, never the design's own colours: the card is
 *        drawn in shadcn tokens so it stays readable in light, dim and dark, and the ink
 *        that actually gets printed lives inside the artwork.
 * WHERE  apps/web/src/app/c/[slug]/page.tsx, services/qr/src/card.handlers.ts
 */
import type { OutputOf } from "@foodos/contracts";
import { cn } from "@foodos/ui/lib/utils";
import Image from "next/image";

import { CardActions } from "@/features/qr/card-actions";
import { type CardTemplate, templateOf } from "@/features/qr/card-templates";
import { ThemeToggle } from "@/features/table/theme";

type CardDesign = OutputOf<"cardDesign", "read">["items"][number];
type QrPosition = CardDesign["theme"]["qr"]["position"];

/**
 * The one place server-produced markup meets this document, and it is deliberately a dead
 * end. `renderedSvg` is written by the qr service from a design a customer typed, so it is
 * markup this page did not author; inlining it - `dangerouslySetInnerHTML`, or an <object>,
 * or an <svg> built from it - would let a headline containing a script tag run with a staff
 * session in the cookie jar. An SVG referenced as an image is inert in every browser:
 * scripts do not run, external resources do not load, and nothing in it can reach this
 * origin. The prefix test is not the control - it only avoids a broken image when the
 * column holds something that is not a document at all.
 */
function svgDataUri(svg: string | null): string | null {
  if (svg === null) return null;
  const trimmed = svg.trim();
  if (!trimmed.startsWith("<svg") && !trimmed.startsWith("<?xml")) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
}

/** Where the design asked for the code to sit. Exhaustive, so a fourth position breaks the build. */
function orderClass(position: QrPosition): string {
  switch (position) {
    case "top":
      return "order-first";
    case "bottom":
      return "order-last";
    case "center":
      return "";
  }
}

/** A design that has never been rendered, or one edited since it was. Both are ordinary. */
function ArtworkPending() {
  return (
    <div className="flex size-full items-center justify-center rounded-sm border border-border border-dashed">
      <span className="px-1 text-[0.6rem] text-muted-foreground leading-tight">No artwork yet</span>
    </div>
  );
}

function CardSheet({
  design,
  template,
  artwork,
}: {
  design: CardDesign;
  template: CardTemplate;
  artwork: string | null;
}) {
  const { theme } = design;
  const qrWidth = Math.min(80, Math.round((theme.qr.sizeMm / template.widthMm) * 100));

  return (
    <div className="flex justify-center">
      <div
        className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-border bg-card px-[6%] py-[5%] text-center shadow-sm"
        style={{
          maxWidth: `${String(template.widthMm)}mm`,
          aspectRatio: `${String(template.widthMm)} / ${String(template.heightMm)}`,
        }}
      >
        <p className="font-bold text-card-foreground text-sm leading-tight sm:text-base">
          {theme.headline}
        </p>
        {theme.subheadline === null ? null : (
          <p className="text-[0.7rem] text-muted-foreground leading-tight sm:text-xs">
            {theme.subheadline}
          </p>
        )}

        <div
          className={cn("relative shrink-0", orderClass(theme.qr.position))}
          style={{ width: `${String(qrWidth)}%`, aspectRatio: "1 / 1" }}
        >
          {artwork === null ? (
            <ArtworkPending />
          ) : (
            <Image
              src={artwork}
              alt={`Printable code for ${design.name}`}
              fill
              unoptimized
              sizes="240px"
              style={{ objectFit: "contain" }}
            />
          )}
        </div>

        {theme.showPlaceLabel ? (
          <p className="rounded-sm border border-border border-dashed px-2 py-0.5 text-[0.6rem] text-muted-foreground uppercase tracking-wide">
            Table label
          </p>
        ) : null}
        {theme.footer === null ? null : (
          <p className="text-[0.6rem] text-muted-foreground">{theme.footer}</p>
        )}
      </div>
    </div>
  );
}

function Facts({ design, template }: { design: CardDesign; template: CardTemplate }) {
  const rows: readonly (readonly [string, string])[] = [
    ["Template", template.label],
    ["Prints at", `${String(template.widthMm)} × ${String(template.heightMm)} mm`],
    ["Code size", `${String(design.theme.qr.sizeMm)} mm`],
    ["Opens", design.requestTypeId === null ? "The menu" : "A request"],
  ];

  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 print:hidden">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-border border-b py-1">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HostedCard({ design }: { design: CardDesign }) {
  const template = templateOf(design.template);
  const artwork = svgDataUri(design.renderedSvg);

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div className="min-w-0 space-y-1">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Printable card</p>
            <h1 className="truncate font-semibold text-foreground text-xl">{design.name}</h1>
          </div>
          {/* The same three themes as the guest surface: a pass is bright, an office is not. */}
          <ThemeToggle className="shrink-0" />
        </header>

        <CardSheet design={design} template={template} artwork={artwork} />

        {artwork === null ? (
          <p className="text-muted-foreground text-sm print:hidden">
            No artwork has been produced for this design yet. Rendering runs as a command off the
            request path, and editing a design clears whatever was rendered from the old one, so a
            card that has just been changed waits here too.
          </p>
        ) : null}

        <Facts design={design} template={template} />

        <CardActions designId={design.id} hasArtwork={artwork !== null} />
      </div>
    </main>
  );
}
