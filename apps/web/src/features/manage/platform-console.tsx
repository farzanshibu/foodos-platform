/**
 * SOT: platform-console, platform-admin-ui, cross-tenant-console, operator-console,
 *      platform-pagination-ui, platform-action-boundary
 * WHAT   The screen behind /manage/platform: which organisations are actually running on this
 *        deployment, and what the platform took in over a window.
 * WHY    This is the only surface in the product that reads across tenants, so every number on
 *        it has to say where it came from. The organisation list is derived from ORDER
 *        ACTIVITY, not from a directory: insights owns no restaurants, so "live" here means
 *        "placed an order in the window the picker names". The names beside those ids are
 *        denormalised into the insights service as events arrive - a restaurant whose orders
 *        predate that is shown as its id, because echoing an id back as a name is the one
 *        thing an operator console must never do.
 * HOW    The date range drives BOTH arms. `totals` and `restaurants` each take from/to now, so
 *        moving the picker moves everything on the screen rather than half of it.
 * HOW    Search, plan, ordering and paging are the SERVER's. The list is a keyset page: Next
 *        carries the cursor the service handed back and Back pops the stack, so what is on
 *        screen is a page of the whole platform rather than a slice sorted in the browser.
 * HOW    NOTHING ON THIS SCREEN ACTS. `platformAdmin.manage` exists and the insights service
 *        refuses every call to it, because a downstream call carries the CALLING
 *        organisation - the platform's own - so this console can read across tenants but not
 *        write across them. A Suspend button here would be a button that returns success and
 *        changes nothing, so there is not one; the section says so instead, and
 *        services/insights/src/insights.handlers.ts says exactly what it would take.
 * WHERE  apps/web/src/app/(dashboard)/manage/platform/page.tsx,
 *        services/insights/src/insights.handlers.ts
 */
"use client";

import { SkeletonRows } from "@foodos/ui/skeleton";
import type { InputOf, OutputOf } from "@foodos/contracts";
import { PLAN_KEYS, PLANS } from "@foodos/registry";
import { Badge } from "@foodos/ui/badge";
import { Button } from "@foodos/ui/button";
import { Card, CardContent } from "@foodos/ui/card";
import { Denial, type DenialError } from "@foodos/ui/denial";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { controlClass } from "@/features/manage/inline-create";
import { Empty, PageShell } from "@/features/manage/page-shell";
import { money } from "@/features/table/money";
import { useTRPC } from "@/trpc/react";

type PlatformView = OutputOf<"platformAdmin", "read">;
type PlatformAsk = InputOf<"platformAdmin", "read">;
type Totals = Extract<PlatformView, { view: "totals" }>;
type Organisation = Extract<PlatformView, { view: "restaurants" }>["items"][number];
type SortKey = Extract<PlatformAsk, { view: "restaurants" }>["sort"];

/** One screen of organisations. The service pages beyond it; it is not a ceiling any more. */
const PAGE_SIZE = 25;

const RANGES = [
  { key: "week", label: "7 days", days: 7 },
  { key: "month", label: "30 days", days: 30 },
  { key: "quarter", label: "90 days", days: 90 },
] as const;

type Range = (typeof RANGES)[number];
type Span = { readonly from: Date; readonly to: Date };

const DEFAULT_RANGE = RANGES[1];

/**
 * Computed when the range CHANGES, never in the render body. `to: new Date()` inline would
 * mint a fresh timestamp on every render, which is a fresh query key, which is a refetch that
 * causes the next render.
 */
function spanOf(days: number): Span {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
}

/**
 * `satisfies` rather than an annotation, so a key that is not one of the orderings the
 * contract offers is a compile error here rather than an INVALID_INPUT at the service.
 */
const SORTS = [
  { key: "orders", label: "Most orders" },
  { key: "revenue", label: "Most revenue" },
  { key: "recent", label: "Most recent order" },
  { key: "name", label: "Name" },
] as const satisfies readonly { key: SortKey; label: string }[];

function day(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** What the console asks for, in one place, because the query key is this object. */
type Filters = {
  readonly search: string;
  readonly plan: string;
  readonly sort: SortKey;
};

const NO_FILTERS: Filters = { search: "", plan: "", sort: "orders" };

export function PlatformConsole() {
  const trpc = useTRPC();
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [span, setSpan] = useState<Span>(() => spanOf(DEFAULT_RANGE.days));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  /**
   * The cursors of the pages already visited, deepest last. A keyset cursor names where the
   * next page starts and nothing else, so walking back is remembering rather than arithmetic.
   */
  const [trail, setTrail] = useState<readonly string[]>([]);

  const cursor = trail.at(-1) ?? null;

  const totals = useQuery(
    trpc.platformAdmin.view.queryOptions({ view: "totals", from: span.from, to: span.to }),
  );
  const organisations = useQuery(
    trpc.platformAdmin.view.queryOptions({
      view: "restaurants",
      from: span.from,
      to: span.to,
      limit: PAGE_SIZE,
      cursor,
      sort: filters.sort,
      ...(filters.search === "" ? {} : { search: filters.search }),
      ...(filters.plan === "" ? {} : { plan: filters.plan }),
    }),
  );

  /**
   * Narrowed by testing the SAME reference twice rather than through optional chaining, which
   * does not narrow a discriminated union. Two arms, two shapes, one endpoint.
   */
  const totalsData =
    totals.data !== undefined && totals.data.view === "totals" ? totals.data : null;
  const orgData =
    organisations.data !== undefined && organisations.data.view === "restaurants"
      ? organisations.data
      : null;

  /** Any change to what is being asked for invalidates where we were in the answer. */
  const refilter = (next: Filters) => {
    setFilters(next);
    setTrail([]);
  };

  return (
    <PageShell
      title="Platform"
      description="Every organisation running on this deployment. Reachable only by the organisation that runs it, which is why it is not in the navigation."
      action={
        <RangePicker
          range={range}
          onChange={(next) => {
            setRange(next);
            setSpan(spanOf(next.days));
            setTrail([]);
          }}
        />
      }
    >
      {totals.error === null ? null : <Denial error={totals.error} resource="platformAdmin" />}

      <TotalsRow totals={totalsData} span={range.label} />

      <OrganisationsSection
        page={orgData}
        error={organisations.error}
        fetching={organisations.isFetching}
        filters={filters}
        depth={trail.length}
        span={range.label}
        onFilter={refilter}
        onNext={(next) => {
          setTrail((pages) => [...pages, next]);
        }}
        onBack={() => {
          setTrail((pages) => pages.slice(0, -1));
        }}
      />
    </PageShell>
  );
}

function RangePicker({ range, onChange }: { range: Range; onChange: (next: Range) => void }) {
  return (
    <div className="flex gap-2">
      {RANGES.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => {
            onChange(entry);
          }}
          className={
            range.key === entry.key
              ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-primary-foreground text-sm"
              : "rounded-full border border-border px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
          }
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

function TotalsRow({ totals, span }: { totals: Totals | null; span: string }) {
  return (
    <section className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Total
          label="Organisations"
          value={totals === null ? "—" : String(totals.organizations)}
          detail={`took an order in the last ${span}`}
        />
        <Total
          label="Restaurants"
          value={totals === null ? "—" : String(totals.restaurants)}
          detail={`served in the last ${span}`}
        />
        <Total
          label="Diners"
          value={totals === null ? "—" : String(totals.customers)}
          detail="distinct customers named on an order"
        />
        <Total
          label="Orders"
          value={totals === null ? "—" : String(totals.orders)}
          detail={`placed in the last ${span}`}
        />
        <Total
          label="Gross volume"
          value={totals === null ? "—" : money(totals.gmvPaise)}
          detail={`taken in the last ${span}`}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Counted from the order facts the insights service owns, over the window above. Recurring
        revenue is not here because it belongs to the billing service, and a service that reads
        across tenants cannot ask billing on a tenant's behalf.
      </p>
    </section>
  );
}

function OrganisationsSection({
  page,
  error,
  fetching,
  filters,
  depth,
  span,
  onFilter,
  onNext,
  onBack,
}: {
  page: Extract<PlatformView, { view: "restaurants" }> | null;
  error: DenialError | null;
  fetching: boolean;
  filters: Filters;
  depth: number;
  span: string;
  onFilter: (next: Filters) => void;
  onNext: (cursor: string) => void;
  onBack: () => void;
}) {
  /** Typed here, applied on submit: a query per keystroke is a query per keystroke. */
  const [draft, setDraft] = useState(filters.search);

  const rows = page?.items ?? null;
  const nextCursor = page?.nextCursor ?? null;

  return (
    <section className="space-y-3">
      <SectionHead
        title="Organisations"
        detail={`Every organisation that took an order in the last ${span}, busiest first — there is no directory of restaurants to read instead. Searching, filtering, ordering and paging all happen in the service, so what is below is a page of the whole platform.`}
      />

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({ ...filters, search: draft.trim() });
        }}
      >
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder="Search names and ids"
          className={`${controlClass} max-w-72`}
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        <select
          value={filters.plan}
          onChange={(event) => {
            onFilter({ ...filters, plan: event.target.value });
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-foreground text-sm"
        >
          <option value="">Every plan</option>
          {PLAN_KEYS.map((key) => (
            <option key={key} value={key}>
              {PLANS[key].label}
            </option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(event) => {
            const chosen = SORTS.find((entry) => entry.key === event.target.value);
            if (chosen !== undefined) onFilter({ ...filters, sort: chosen.key });
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-foreground text-sm"
        >
          {SORTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </form>

      {rows === null ? (
        <Waiting error={error} />
      ) : rows.length === 0 ? (
        <Empty
          icon="🏢"
          title={
            filters.search === "" && filters.plan === ""
              ? "Nobody has ordered in this window"
              : "Nothing matches that"
          }
          detail={
            filters.search === "" && filters.plan === ""
              ? "An organisation appears here the moment one of its restaurants takes an order. Widen the date range if you expected somebody."
              : "Clear the search box and the plan filter to see every organisation again."
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.organizationId}:${row.restaurantId}`}>
              <OrganisationRow row={row} />
            </li>
          ))}
        </ul>
      )}

      {rows === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={depth === 0 || fetching} onClick={onBack}>
            Back
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={nextCursor === null || fetching}
            onClick={() => {
              if (nextCursor !== null) onNext(nextCursor);
            }}
          >
            Next
          </Button>
          <p className="text-muted-foreground text-xs">
            {depth === 0 ? "First page" : `Page ${String(depth + 1)}`}
            {nextCursor === null ? " · nothing after this one" : ""}
          </p>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Suspending or restoring a restaurant is not available from here. The catalogue already
        models it, but a call from one service to another carries the calling organisation, so
        insights can read across tenants and cannot write across them — and a control that reported
        success without changing anything would be worse than its absence.
      </p>
    </section>
  );
}

function OrganisationRow({ row }: { row: Organisation }) {
  /** Either half can be missing on its own: the organisation's name is learned from any
   *  audited change, the restaurant's only from an order the projector has since caught up on. */
  const unnamed = row.organizationName === null || row.restaurantName === null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p
            className={
              row.organizationName === null
                ? "truncate font-mono text-foreground text-sm"
                : "truncate font-medium text-foreground"
            }
          >
            {row.organizationName ?? row.organizationId}
          </p>
          <p
            className={
              row.restaurantName === null
                ? "truncate font-mono text-muted-foreground text-xs"
                : "truncate text-muted-foreground text-xs"
            }
          >
            {row.restaurantName ?? row.restaurantId}
          </p>
        </div>

        <div className="text-right text-xs">
          <p className="text-foreground">
            {row.orders} orders · {money(row.gmvPaise)}
          </p>
          <p className="text-muted-foreground">last order {day(row.lastOrderAt)}</p>
        </div>

        <div className="flex flex-wrap justify-end gap-1">
          {row.isLive === null ? null : (
            <Badge variant={row.isLive ? "secondary" : "outline"}>
              {row.isLive ? "live" : "offline"}
            </Badge>
          )}
          {row.plan === null ? null : <Badge variant="outline">{PLANS[row.plan].label}</Badge>}
          {row.branchCount === null ? null : (
            <Badge variant="outline">
              {row.branchCount} {row.branchCount === 1 ? "branch" : "branches"}
            </Badge>
          )}
          {row.openedAt === null ? null : (
            <Badge variant="outline">since {day(row.openedAt)}</Badge>
          )}
        </div>

        {unnamed ? (
          <p className="basis-full text-muted-foreground text-xs">
            Shown as an id because no name has been recorded yet — the insights service learns one
            from this organisation's next audited change.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A section with no rows yet is either still asking or was refused, and those are different
 * answers. Without this the refusal of one arm reads as a list that never finishes loading.
 */
function Waiting({ error }: { error: DenialError | null }) {
  return error === null ? (
    <SkeletonRows />
  ) : (
    <Denial error={error} resource="platformAdmin" />
  );
}

function SectionHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-semibold text-foreground text-lg">{title}</h2>
      <p className="max-w-3xl text-muted-foreground text-sm">{detail}</p>
    </div>
  );
}

function Total({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p className="font-semibold text-2xl text-foreground">{value}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </CardContent>
    </Card>
  );
}
