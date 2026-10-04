import { parseConfig } from "@/lib/config";
import type { BattleEvent } from "@/lib/types";
import { backendMode, WORKER_URL, workerHeaders } from "@/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" };

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = parseConfig(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const mode = backendMode();
  if (mode === "offline") return Response.json({ error: "arena offline: no benchmark worker configured" }, { status: 503 });

  if (mode === "remote") {
    const upstream = await fetch(`${WORKER_URL}/battle`, { method: "POST", headers: workerHeaders(), body: JSON.stringify(parsed.config), signal: req.signal });
    if (!upstream.ok || !upstream.body) return Response.json({ error: `worker responded ${upstream.status}` }, { status: 502 });
    return new Response(upstream.body, { headers: SSE_HEADERS });
  }

  const { runBattle, ArenaBusyError } = await import("@/engine/battle");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: BattleEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
        }
      };
      try {
        await runBattle(parsed.config, send, req.signal);
      } catch (err) {
        if (err instanceof ArenaBusyError) send({ type: "battle:error", t: 0, message: err.message });
      } finally {
        try {
          controller.close();
        } catch {
        }
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
