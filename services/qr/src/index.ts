/**
 * SOT: qr-service-entry, service-bootstrap
 * WHAT   Boots the qr service: subscribe to the subjects the registry says it owns.
 * WHY    The subject list is derived, so a new operation in the registry is automatically
 *        served once its handler exists - and screams at boot if the handler is missing.
 * HOW    pnpm --filter @foodos/service-qr dev
 * WHERE  packages/core/src/service.ts
 */
import "server-only";

import { defineService } from "@foodos/core";
import { env } from "@foodos/env";
import { queueGroup } from "@foodos/registry";
import { closeConnection, consume, serveRpc } from "@foodos/transport";

import { handlers } from "./handlers";

const secret = env.envelopeSecret();

const runtime = defineService("qr", handlers, { secret });

async function main() {
  for (const route of runtime.routes) {
    if (route.transport === "rpc") {
      await serveRpc({
        subject: route.subject,
        queue: queueGroup("qr"),
        handler: (raw, subject) => runtime.handle(raw, subject),
        unreadable: runtime.unreadable,
      });
    } else {
      void consume({
        stream: "CMD",
        durable: `qr-${route.resource}-${route.operation}`,
        filterSubject: route.subject,
        handler: async (raw, subject) => {
          const reply = await runtime.handle(raw, subject);
          if (!reply.ok) throw new Error(reply.error.message);
        },
      });
    }
    console.info(`[qr] serving ${route.subject} (${route.transport})`);
  }
}

main().catch((error) => {
  console.error("[qr] failed to start", error);
  process.exit(1);
});

process.on("SIGINT", () => void closeConnection().then(() => process.exit(0)));
process.on("SIGTERM", () => void closeConnection().then(() => process.exit(0)));
