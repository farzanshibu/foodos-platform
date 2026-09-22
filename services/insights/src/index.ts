/**
 * SOT: insights-service-entry, service-bootstrap
 * WHAT   Boots the insights service: subscribe to the subjects the registry says it owns.
 * WHY    The subject list is derived, so a new operation in the registry is automatically
 *        served once its handler exists - and screams at boot if the handler is missing.
 * HOW    pnpm --filter @foodos/service-insights dev
 * WHERE  packages/core/src/service.ts
 */
import "server-only";

import { defineConsumer, defineService } from "@foodos/core";
import { env } from "@foodos/env";
import { queueGroup } from "@foodos/registry";
import { closeConnection, consume, serveRpc } from "@foodos/transport";

import { handlers } from "./handlers";
import { project } from "./projector";

const secret = env.envelopeSecret();

const runtime = defineService("insights", handlers, { secret });

async function main() {
  for (const route of runtime.routes) {
    if (route.transport === "rpc") {
      await serveRpc({
        subject: route.subject,
        queue: queueGroup("insights"),
        handler: (raw, subject) => runtime.handle(raw, subject),
        unreadable: runtime.unreadable,
      });
    } else {
      void consume({
        stream: "CMD",
        durable: `insights-${route.resource}-${route.operation}`,
        filterSubject: route.subject,
        handler: async (raw, subject) => {
          const reply = await runtime.handle(raw, subject);
          if (!reply.ok) throw new Error(reply.error.message);
        },
      });
    }
    console.info(`[insights] serving ${route.subject} (${route.transport})`);
  }

  /**
   * The read models. One durable consumer over every audited fact in the platform, built with
   * defineConsumer so the envelope signature is verified before anything is written - an
   * unsigned event could otherwise put a restaurant nobody owns into the marketplace index.
   */
  void consume({
    stream: "EVT",
    durable: "insights-projector",
    filterSubject: "evt.>",
    handler: defineConsumer({ secret }, async ({ meta, payload }) => {
      await project(meta, payload);
    }),
  });
  console.info("[insights] projecting evt into the search index and report facts");
}

main().catch((error) => {
  console.error("[insights] failed to start", error);
  process.exit(1);
});

process.on("SIGINT", () => void closeConnection().then(() => process.exit(0)));
process.on("SIGTERM", () => void closeConnection().then(() => process.exit(0)));
