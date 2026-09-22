/**
 * SOT: platform-closed, platform-refusal, not-the-operator
 * WHAT   What somebody sees at /manage/platform when they are not the organisation that runs
 *        this deployment.
 * WHY    The refusal is structural, not a fault: `platformAdmin` passes the registry's role
 *        gate for the owner of ANY organisation and is then refused in the insights service,
 *        which compares the caller's organisation against the one the deployment named as its
 *        own. Somebody who lands here by pasting the URL has done nothing wrong and nothing
 *        was written, so this says so in plain words rather than showing a stack trace, a 500
 *        or an empty console that looks broken.
 * WHY    Deliberately says less than it knows. It does not name the platform organisation, or
 *        say whether one is configured at all - that is a fact about the deployment, and a
 *        page reachable by anybody is not where it gets disclosed.
 * HOW    Rendered by the page, not thrown: a throw would reach (dashboard)/error.tsx, which
 *        exists for a service that did not answer and says so. This did answer, and the
 *        answer was no.
 * WHERE  apps/web/src/app/(dashboard)/manage/platform/page.tsx
 */
import { Card, CardContent } from "@foodos/ui/card";

export function PlatformClosed() {
  return (
    <div className="flex justify-center py-12" role="status">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-4xl" aria-hidden="true">
            🛠️
          </p>
          <h1 className="font-semibold text-foreground text-lg">This console isn&apos;t yours</h1>
          <p className="text-muted-foreground text-sm">
            It reads across every organisation on this deployment, so it answers to the one
            organisation that runs the deployment rather than to any role. Yours is not that
            organisation.
          </p>
          <p className="text-muted-foreground text-sm">
            Nothing is wrong with your account and nothing was changed. Everything your organisation
            can do is in the navigation around this panel.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
