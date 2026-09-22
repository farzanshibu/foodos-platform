/**
 * SOT: nav-href, billing-href-client, route-cast, registry-route
 * WHAT   The one place a registry href becomes a route Next's typed router accepts.
 * WHY    `typedRoutes` narrows <Link href> to the literal union of routes it found on disk,
 *        and every href in this app comes from the registry as a plain string. That is a
 *        real parse boundary, not a convenience cast: the registry is the source of truth
 *        for where a resource lives, and `resourceForPath` in the dashboard layout is what
 *        proves the two agree - a registry href with no page behind it redirects rather than
 *        rendering. So the cast lives here, once, named, instead of at every call site.
 * HOW    <Link href={route(item.href)} />. Nothing else in the app may cast an href.
 * WHERE  packages/registry/src/derive.ts (NAV_ITEMS, BILLING_HREF)
 */
import { BILLING_HREF } from "@foodos/registry";
import type { Route } from "next";

/** The boundary. A registry-declared path, admitted to the typed router. */
export function route(href: string): Route {
  return href as Route;
}

export const billingHref: string | undefined = BILLING_HREF;

/** Longest-prefix match against the current URL, so /manage/orders/42 still marks Orders. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
