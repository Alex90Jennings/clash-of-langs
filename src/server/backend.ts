import "server-only";

export const WORKER_URL = process.env.BENCH_WORKER_URL?.replace(/\/$/, "") ?? "";
export const WORKER_TOKEN = process.env.CLASHOFLANGS_WORKER_TOKEN ?? "";

export function backendMode(): "remote" | "local" | "offline" {
  if (WORKER_URL) return "remote";
  if (process.env.VERCEL || process.env.CLASHOFLANGS_LOCAL_EXECUTION === "0") return "offline";
  return "local";
}

export const workerHeaders = (): HeadersInit => ({
  "content-type": "application/json",
  ...(WORKER_TOKEN ? { "x-clashoflangs-token": WORKER_TOKEN } : {}),
});
