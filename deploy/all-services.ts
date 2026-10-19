/**
 * All eleven services in one process, plus a health endpoint.
 *
 * For a free-tier host that gives one small web service rather than eleven. Each service
 * entry boots itself on import (subscribes, registers consumers), and they already carry
 * distinct queue groups and durable names, so sharing one NATS connection is safe.
 *
 *   tsx --conditions=react-server deploy/all-services.ts
 */
import { createServer } from "node:http";

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

const booted: string[] = [];

for (const name of SERVICES) {
  await import(`../services/${name}/src/index.ts`);
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
