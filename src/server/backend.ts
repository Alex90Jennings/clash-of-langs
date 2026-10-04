import "server-only";

export const WORKER_URL = process.env.BENCH_WORKER_URL?.replace(/\/$/, "") ?? "";
export const WORKER_TOKEN = process.env.CLASHOFLANGS_WORKER_TOKEN ?? "";

export function backendMode(): "remote" | "local" | "offline" {
  if (WORKER_URL) return "remote";
  if (process.env.VERCEL || process.env.CLASHOFLANGS_LOCAL_EXECUTION === "0") return "offline";
  return "local";
}

export const workerHeaders = (clientIp?: string): HeadersInit => ({
  "content-type": "application/json",
  ...(WORKER_TOKEN ? { "x-clashoflangs-token": WORKER_TOKEN } : {}),
  ...(clientIp ? { "x-clashoflangs-client": clientIp } : {}),
});

export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || undefined;
}
