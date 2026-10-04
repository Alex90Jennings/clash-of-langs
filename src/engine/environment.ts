import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { EXECUTABLE_LANGUAGES } from "../lib/languages";
import type { LanguageId, RuntimeInfo, WorkerEnvironment } from "../lib/types";
import { detectMemoryProbe } from "./process";
import { probeRuntime } from "./runtimes";

let cached: Promise<WorkerEnvironment> | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

function isContainer(): boolean {
  if (existsSync("/.dockerenv")) return true;
  try {
    return /docker|containerd|kubepods/.test(readFileSync("/proc/1/cgroup", "utf8"));
  } catch {
    return false;
  }
}

async function probe(): Promise<WorkerEnvironment> {
  const entries = await Promise.all(EXECUTABLE_LANGUAGES.map(async (l) => [l, await probeRuntime(l)] as const));
  const cpus = os.cpus();
  return {
    workerId: process.env.CLASHOFLANGS_WORKER_ID ?? os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    containerised: isContainer(),
    memoryProbe: detectMemoryProbe(),
    runtimes: Object.fromEntries(entries) as Partial<Record<LanguageId, RuntimeInfo>>,
  };
}

export function getEnvironment(): Promise<WorkerEnvironment> {
  if (!cached || Date.now() - cachedAt > TTL_MS) {
    cachedAt = Date.now();
    cached = probe();
  }
  return cached;
}
