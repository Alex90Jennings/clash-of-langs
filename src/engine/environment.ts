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

// Version probes boot JVMs, BEAMs and Julia; launching all of them at once on a small
// worker starves them past their timeout and they get reported as missing.
async function probeAll(langs: readonly LanguageId[], limit: number): Promise<[LanguageId, RuntimeInfo][]> {
  const out: [LanguageId, RuntimeInfo][] = [];
  let next = 0;
  const lane = async () => {
    while (next < langs.length) {
      const i = next++;
      out[i] = [langs[i], await probeRuntime(langs[i])];
    }
  };
  await Promise.all(Array.from({ length: limit }, lane));
  return out;
}

async function probe(): Promise<WorkerEnvironment> {
  const cpus = os.cpus();
  const entries = await probeAll(EXECUTABLE_LANGUAGES, Math.max(2, cpus.length));
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
