import { backendMode, WORKER_URL, workerHeaders } from "@/server/backend";
import type { Capabilities } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode = backendMode();
  let caps: Capabilities;
  if (mode === "remote") {
    try {
      const res = await fetch(`${WORKER_URL}/capabilities`, { headers: workerHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000) });
      caps = res.ok ? ((await res.json()) as Capabilities) : { online: false, mode, environment: null, message: `worker responded ${res.status}` };
    } catch {
      caps = { online: false, mode, environment: null, message: "benchmark worker unreachable" };
    }
  } else if (mode === "local") {
    const { getEnvironment } = await import("@/engine/environment");
    caps = { online: true, mode, environment: await getEnvironment() };
  } else {
    caps = { online: false, mode, environment: null, message: "no benchmark worker configured (set BENCH_WORKER_URL)" };
  }
  return Response.json(caps, { headers: { "cache-control": "no-store" } });
}
