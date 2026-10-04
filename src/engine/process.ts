import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

export type MemoryProbe = "bsd-time" | "gnu-time" | "none";

let probeCache: MemoryProbe | null = null;

export function detectMemoryProbe(): MemoryProbe {
  if (probeCache) return probeCache;
  probeCache = "none";
  if (existsSync("/usr/bin/time")) {
    if (process.platform === "darwin") probeCache = "bsd-time";
    else if (spawnSync("/usr/bin/time", ["-f", "%M", "true"]).status === 0) probeCache = "gnu-time";
  }
  return probeCache;
}

export interface HarnessLine {
  e: "hello" | "ready" | "warmup" | "run" | "done" | "error";
  [k: string]: unknown;
}

export interface ProcessOutcome {
  code: number | null;
  wallMs: number;
  peakRssBytes: number | null;
  cpuMs: number | null;
  stderr: string;
  timedOut: boolean;
}

export interface SpawnSpec {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  onLine: (line: HarnessLine, sinceSpawnMs: number) => void;
}

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const GNU_MARK = "__CLASHOFLANGS_TIME__";

function parseTime(stderr: string, probe: MemoryProbe): { rss: number | null; cpu: number | null; rest: string } {
  if (probe === "gnu-time") {
    const m = stderr.match(new RegExp(`${GNU_MARK} (\\d+) ([\\d.]+) ([\\d.]+)`));
    if (!m) return { rss: null, cpu: null, rest: stderr };
    return { rss: Number(m[1]) * 1024, cpu: (Number(m[2]) + Number(m[3])) * 1000, rest: stderr.replace(m[0], "").trim() };
  }
  if (probe === "bsd-time") {
    const rss = stderr.match(/(\d+)\s+maximum resident set size/);
    const cpu = stderr.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
    const restStart = stderr.search(/\s+[\d.]+\s+real\s+/);
    return {
      rss: rss ? Number(rss[1]) : null,
      cpu: cpu ? (Number(cpu[2]) + Number(cpu[3])) * 1000 : null,
      rest: (restStart >= 0 ? stderr.slice(0, restStart) : stderr).trim(),
    };
  }
  return { rss: null, cpu: null, rest: stderr.trim() };
}

export function runProcess(spec: SpawnSpec): Promise<ProcessOutcome> {
  const probe = detectMemoryProbe();
  const [cmd, args]: [string, string[]] =
    probe === "bsd-time"
      ? ["/usr/bin/time", ["-l", spec.cmd, ...spec.args]]
      : probe === "gnu-time"
        ? ["/usr/bin/time", ["-f", `${GNU_MARK} %M %U %S`, spec.cmd, ...spec.args]]
        : [spec.cmd, spec.args];

  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: tmpdir(),
        TMPDIR: tmpdir(),
        LANG: "C.UTF-8",
        NODE_ENV: "production",
        ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
        ...spec.env,
      },
    });

    let buffer = "";
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, spec.timeoutMs);
    const onAbort = () => kill();
    spec.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const at = performance.now() - t0;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) return kill();
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!raw) continue;
        try {
          spec.onLine(JSON.parse(raw) as HarnessLine, at);
        } catch {
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      const { rss, cpu, rest } = parseTime(stderr, probe);
      resolve({ code, wallMs: performance.now() - t0, peakRssBytes: rss, cpuMs: cpu, stderr: rest, timedOut });
    });
  });
}
