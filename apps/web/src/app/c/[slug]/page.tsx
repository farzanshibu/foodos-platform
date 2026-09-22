/**
 * SOT: hosted-card-page, c-route, card-slug-route
 * WHAT   A card design at its own short URL: the artwork the render command produced, at
 *        the shape it prints at, with nothing else on the page.
 * WHY    `cardDesign.manage` renders off the request path and answers with an acceptance,
 *        so the file has to be collected somewhere. This is that somewhere - a link a
 *        manager can send to whoever is doing the printing, outside the dashboard chrome so
 *        Print puts the card on paper rather than a sidebar.
 *
 * WHY    It is NOT public, and that is a decision rather than an oversight. The artwork
 *        contains the card's live QR, and the QR's whole security model is that its token is
 *        ten characters of CSPRNG output - about 2^49. A slug is a design name plus six hex
 *        characters (`slugify`, services/qr/src/card.handlers.ts), so roughly 2^24 with a
 *        guessable half in front of it. Serving artwork to anonymous callers would therefore
 *        hand out live tokens behind a guess four hundred million times cheaper than the
 *        token itself, which is not a card page any more, it is a token oracle. `slug` is
 *        also unique per (organization_id, slug) only - see the index in the qr schema - so
 *        there is no such thing as an unambiguous global lookup by slug in the first place.
 *        Nothing was added to PUBLIC_OPERATIONS: that set is one operation long because
 *        resolving a scanned token is the only call that legitimately runs before a tenant
 *        exists, and a public read here would have had to make `cardDesign:read` ignore
 *        `ctx.orgId` - a second door in the endpoint staff already use.
 *
 * WHY    It mints no guest ticket either. A ticket says which table somebody is sitting at,
 *        and a card design is per design, not per table - one table tent is printed for the
 *        whole room. Nobody here has scanned anything. A ticket would be a credential handed
 *        to a person who never presented one.
 *
 * HOW    Identity, org scoping, role, permission, plan and the registry's rate limit all
 *        come from the one `api.cardDesign.list` call, which runs the ordinary gateway
 *        block - so `cardDesign`'s declared rateLimit protects this route with nothing
 *        written by hand. The guard repeated below is the one `server-boundaries` asks for
 *        on a page outside `(dashboard)`: it redirects an anonymous or unentitled visitor
 *        instead of showing them a failure, and it is what supplies the viewer the client
 *        mirror reads.
 * HOW    Every failure renders the same screen. A slug that does not exist, one belonging to
 *        another organisation and a qr service that is down are indistinguishable from out
 *        here, so the page cannot be used to find out which.
 * WHERE  apps/web/src/features/qr/hosted-card.tsx, services/qr/src/card.handlers.ts
 */
import { identify } from "@foodos/auth";
import { grantOf, navAccess, permissionsFor } from "@foodos/registry";
import { ViewerProvider } from "@foodos/ui/viewer";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { HostedCard } from "@/features/qr/hosted-card";
import { CardUnavailable } from "@/features/qr/scan-failed";
import { gatewayDeps } from "@/gateway/deps";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function HostedCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const identity = await identify(await headers());
  if (identity === null) redirect("/sign-in");

  const entitlements = await gatewayDeps.entitlements(identity.orgId);
  /** Rank and roster together, because a call site that took only the role forgot the stations. */
  const grant = grantOf(identity.role, identity.stations);
  const access = navAccess("cardDesign", grant, entitlements);
  if (!access.visible) redirect("/projects");
  if (access.locked) redirect("/billing?locked=cardDesign");

  let page: Awaited<ReturnType<typeof api.cardDesign.list>>;
  try {
    page = await api.cardDesign.list({ slug, limit: 1, cursor: null });
  } catch {
    return <CardUnavailable />;
  }

  /** `noUncheckedIndexedAccess`: an empty page and a refused one arrive at the same screen. */
  const design = page.items[0];
  if (design === undefined) return <CardUnavailable />;

  return (
    <ViewerProvider
      value={{ entitlements, permissions: permissionsFor(grant), role: identity.role }}
    >
      <HostedCard design={design} />
    </ViewerProvider>
  );
}
