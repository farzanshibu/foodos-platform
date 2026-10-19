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

import { timingSafeEqual } from "node:crypto";

import { connectionScope } from "../packages/transport/src/connection";
import {
  publishCommandDirect,
  rpcRawDirect,
} from "../packages/transport/src/request";

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
const bridgeToken = process.env["BUS_BRIDGE_TOKEN"] ?? "";
const MAX_BODY = 600 * 1024;

function authorised(header: string | undefined): boolean {
  if (bridgeToken.length === 0 || header === undefined) return false;
  const given = Buffer.from(header.replace(/^Bearer /, ""));
  const wanted = Buffer.from(bridgeToken);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, services: booted }));
    return;
  }
  if (req.method === "POST" && (req.url === "/bridge/rpc" || req.url === "/bridge/command")) {
    if (!authorised(req.headers.authorization)) {
      res.writeHead(401).end();
      return;
    }
    void (async () => {
      try {
        const body = await readJson(req);
        const subject = String(body["subject"] ?? "");
        const envelope = body["envelope"] as never;
        // Whatever the bus call touches rides one of the group connections.
        await connectionScope.run("g1", async () => {
          if (req.url === "/bridge/rpc") {
            const timeoutMs = Math.min(Number(body["timeoutMs"] ?? 5_000), 30_000);
            const reply = await rpcRawDirect(subject, envelope, timeoutMs);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(reply));
          } else {
            await publishCommandDirect({ subject, envelope });
            res.writeHead(200, { "content-type": "application/json" });
            res.end("{}");
          }
        });
      } catch (error) {
        console.error("[bridge]", error instanceof Error ? error.message : String(error));
        res.writeHead(502).end();
      }
    })();
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.info(`[all] health + bridge on :${String(port)}`));
