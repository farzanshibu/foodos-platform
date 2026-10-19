/**
 * All eleven services in one process, plus a health endpoint.
 *
 * For a free-tier host that gives one small web service rather than eleven. Each service
 * entry boots itself on import (subscribes, registers consumers), and they already carry
 * distinct queue groups and durable names. Connections are shared by group (see GROUP and connectionScope).
 *
 *   tsx --conditions=react-server deploy/all-services.ts
 */
import { createServer } from "node:http";

import { connectionScope } from "../packages/transport/src/connection";

const SERVICES = [
  "audit",
  "billing",
  "catalog",
  "crm",
  "floor",
  "identity",
  "insights",
  "orders",
  "projects",
  "qr",
  "requests",
] as const;

/**
 * Services share a NATS connection by group. A hosted free-tier bus caps BOTH connections
 * (so not one per service) and subscriptions per connection (~50, so not all on one). Four
 * groups of roughly equal subject counts stay under both. Counts come from `pnpm subjects`.
 */
const GROUP: Record<(typeof SERVICES)[number], string> = {
  catalog: "g1",
  audit: "g1",
  billing: "g1",
  crm: "g2",
  orders: "g2",
  qr: "g3",
  floor: "g3",
  requests: "g3",
  identity: "g4",
  insights: "g4",
  projects: "g4",
};

const booted: string[] = [];

for (const name of SERVICES) {
  // One NATS connection per group, not per service; see GROUP.
  await connectionScope.run(GROUP[name], () => import(`../services/${name}/src/index.ts`));
  booted.push(name);
  console.info(`[all] started ${name}`);
}

const port = Number(process.env["PORT"] ?? 10000);
createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, services: booted }));
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.info(`[all] health on :${String(port)}`));
