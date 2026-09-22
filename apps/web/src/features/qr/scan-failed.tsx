/**
 * SOT: scan-failed, invalid-qr-page, card-unavailable
 * WHAT   What a person sees when something they reached by URL does not resolve.
 * WHY    A revoked code, an expired one and a mistyped one all look identical here. That is
 *        deliberate: telling somebody which of the three it was tells whoever is probing.
 *        What it does say is the one useful thing - ask a member of staff.
 * HOW    One notice behind two callers, so the guest surface and the hosted card page
 *        cannot drift into saying different amounts about the same class of failure.
 * WHERE  apps/web/src/app/q/[token], apps/web/src/app/c/[slug]
 */
import { Card, CardContent } from "@foodos/ui/card";
import type { LucideIcon } from "lucide-react";
import { Printer, ScanLine } from "lucide-react";

function FailureNotice({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-3 p-8 text-center">
          <div
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </div>
          <h1 className="font-semibold text-foreground text-lg">{title}</h1>
          <p className="text-muted-foreground text-sm">{detail}</p>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * Four outcomes render this, not three: a revoked code, an expired one, a mistyped one, and
 * a scan refused by the rate limiter in gateway/public-call.ts. The last one is the reason
 * this component takes no props and must never take any. A "slow down" variant would tell
 * somebody working through tokens that their guess was merely too fast rather than wrong,
 * which is the one piece of feedback a search needs to tune itself under the limit. The
 * copy already says the useful thing to a real guest, and a real guest is not counting
 * screens.
 */
export function ScanFailed() {
  return (
    <FailureNotice
      icon={ScanLine}
      title="This code isn't active"
      detail="It may have been replaced. Please ask a member of staff and they will sort you out."
    />
  );
}

/**
 * The card equivalent, and deliberately just as vague. A design that never existed, one
 * that belongs to another organisation and one that was deleted all land here saying the
 * same thing, so the page cannot be used to find out which of the three is true.
 */
export function CardUnavailable() {
  return (
    <FailureNotice
      icon={Printer}
      title="This card isn't available"
      detail="It may have been renamed, replaced or removed. Open the card designer to find the one you want."
    />
  );
}
