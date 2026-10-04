import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ArenaBusyError, runBattle } from "../src/engine/battle";
import { getEnvironment } from "../src/engine/environment";
import { BATTLE_LIMITS, RateLimiter } from "../src/engine/rateLimit";
import { parseConfig } from "../src/lib/config";
import type { Capabilities } from "../src/lib/types";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.CLASHOFLANGS_WORKER_TOKEN ?? "";
const MAX_BODY = 4096;
const limiter = new RateLimiter(BATTLE_LIMITS);

function clientKey(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-clashoflangs-client"] ?? "").trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function authorised(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const given = Buffer.from(String(req.headers["x-clashoflangs-token"] ?? ""));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error("body too large");
  }
  return JSON.parse(raw || "{}");
}

const server = createServer(async (req, res) => {
  try {
    if (!authorised(req)) return json(res, 401, { error: "unauthorised" });

    if (req.method === "GET" && req.url === "/capabilities") {
      const caps: Capabilities = { online: true, mode: "remote", environment: await getEnvironment() };
      return json(res, 200, caps);
    }

    if (req.method === "POST" && req.url === "/battle") {
      const parsed = parseConfig((await readBody(req)) as Record<string, unknown>);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const allowed = limiter.take(clientKey(req));
      if (!allowed.ok) {
        res.setHeader("retry-after", String(allowed.retryAfterSec));
        return json(res, 429, { error: `too many battles from your network, try again in ${allowed.retryAfterSec}s` });
      }

      const abort = new AbortController();
      res.on("close", () => abort.abort());
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      try {
        await runBattle(parsed.config, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`), abort.signal);
      } catch (err) {
        if (err instanceof ArenaBusyError) res.write(`data: ${JSON.stringify({ type: "battle:error", t: 0, message: err.message })}\n\n`);
      }
      return res.end();
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : "error" });
    else res.end();
  }
});

server.listen(PORT, () => {
  void getEnvironment().then((env) => {
    const online = Object.entries(env.runtimes).map(([l, r]) => `${l}:${r?.available ? "online" : "offline"}`);
    console.log(`clash-of-langs worker listening on :${PORT} — ${online.join(" ")}`);
  });
});
