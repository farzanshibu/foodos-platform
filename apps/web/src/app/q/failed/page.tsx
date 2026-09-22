/**
 * SOT: scan-failed-page, invalid-qr-landing
 * WHAT   Where a scan that did not resolve lands.
 * WHY    The scan route has to be a route handler in order to mint the guest cookie, and a
 *        route handler cannot render a component - so the failure needs somewhere to be. A
 *        static segment beats the dynamic `[token]` one in Next's router, and no real token
 *        is the word "failed", so this cannot shadow a working code.
 * HOW    One notice, shared with the hosted card page, saying the only useful thing: ask a
 *        member of staff. It never says which of revoked, expired, mistyped or throttled it
 *        was, because telling the person who mistyped also tells the person probing.
 * WHERE  apps/web/src/app/q/[token]/route.ts, apps/web/src/features/qr/scan-failed.tsx
 */
import { ScanFailed } from "@/features/qr/scan-failed";

export default function ScanFailedPage() {
  return <ScanFailed />;
}
