import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { compare, describe, score, verify } from "../lib/analysis";
import { getChallenge } from "../lib/challenges";
import { median } from "../lib/stats";
import type { BattleConfig, BattleEvent, BattleResult, FighterResult, LanguageId, PhaseStat, RuntimeInfo } from "../lib/types";
import { getEnvironment } from "./environment";
import { runProcess } from "./process";
import { ADAPTERS, BENCH_DIR } from "./runtimes";

const STARTUP_PROBES = 3;
const PROCESS_TIMEOUT_MS = 300_000;
const COOLDOWN_MS = 300;
const MAX_QUEUE = 3;

export class ArenaBusyError extends Error {}

let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;

export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_QUEUE) return Promise.reject(new ArenaBusyError("arena busy — too many battles queued"));
  waiting++;
  const next = tail.then(
    () => {
      waiting--;
      return fn();
    },
    () => {
      waiting--;
      return fn();
    },
  );
  tail = next.catch(() => undefined);
  return next;
}

interface Collected {
  startup: number[];
  baselineRss: number[];
  samples: number[];
  warmups: number[];
  checks: Set<string>;
  inputHashes: Set<string>;
  ops: number;
  genMs: number[];
  peakRss: number[];
  cpu: number[];
  wall: number[];
  phases: number[][];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runBattle(config: BattleConfig, emit: (e: BattleEvent) => void, signal?: AbortSignal): Promise<BattleResult> {
  return exclusive(() => execute(config, emit, signal));
}

async function execute(config: BattleConfig, emit: (e: BattleEvent) => void, signal?: AbortSignal): Promise<BattleResult> {
  const challenge = getChallenge(config.challenge);
  if (!challenge) throw new Error("unknown challenge");
  const environment = await getEnvironment();
  for (const lang of config.fighters) {
    const rt = environment.runtimes[lang];
    if (!rt?.available) throw new Error(`${lang} is offline on this worker: ${rt?.reason ?? "no runtime"}`);
  }

  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const now = () => Math.round((performance.now() - t0) * 1000) / 1000;
  const order: [LanguageId, LanguageId] = Math.random() < 0.5 ? [config.fighters[0], config.fighters[1]] : [config.fighters[1], config.fighters[0]];
  emit({ type: "battle:start", t: now(), id, config, order, environment });

  const collected: Record<string, Collected> = {};

  const spawnHarness = async (lang: LanguageId, proc: number, size: number, warmup: number, runs: number, sink: Collected | null, probe: Collected) => {
    const adapter = ADAPTERS[lang];
    let helloMs: number | null = null;
    let firstRunMs: number | null = null;
    let harnessError: string | null = null;
    emit({ type: "fighter:spawn", t: now(), lang, proc });
    const outcome = await runProcess({
      cmd: adapter.cmd,
      args: [...adapter.args, config.challenge, String(size), String(config.seed), String(warmup), String(runs)],
      cwd: BENCH_DIR,
      timeoutMs: PROCESS_TIMEOUT_MS,
      signal,
      env: adapter.env,
      onLine(line, sinceSpawn) {
        switch (line.e) {
          case "hello":
            helloMs = sinceSpawn;
            emit({ type: "fighter:hello", t: now(), lang, proc, startupMs: sinceSpawn });
            break;
          case "ready": {
            const genMs = Number(line.genNs) / 1e6;
            emit({ type: "fighter:ready", t: now(), lang, proc, genMs, inputHash: String(line.input), ops: Number(line.ops) });
            if (sink) {
              sink.genMs.push(genMs);
              sink.inputHashes.add(String(line.input));
              sink.ops = Number(line.ops);
            }
            break;
          }
          case "warmup": {
            const ms = Number(line.ns) / 1e6;
            emit({ type: "fighter:warmup", t: now(), lang, proc, i: Number(line.i), ms });
            sink?.warmups.push(ms);
            break;
          }
          case "run": {
            const ms = Number(line.ns) / 1e6;
            const phases = Array.isArray(line.phases) ? (line.phases as number[]).map((p) => p / 1e6) : undefined;
            emit({ type: "fighter:run", t: now(), lang, proc, i: Number(line.i), ms, check: String(line.check), phases });
            if (firstRunMs === null) firstRunMs = ms;
            if (sink) {
              sink.checks.add(String(line.check));
              if (config.mode === "warm") sink.samples.push(ms);
              if (phases) sink.phases.push(phases);
            }
            break;
          }
          case "error":
            harnessError = String(line.msg);
            break;
        }
      },
    });
    emit({ type: "fighter:exit", t: now(), lang, proc, code: outcome.code, peakRssBytes: outcome.peakRssBytes, cpuMs: outcome.cpuMs, wallMs: outcome.wallMs });
    if (signal?.aborted) throw new Error("battle aborted");
    if (outcome.timedOut) throw new Error(`${lang} exceeded the ${PROCESS_TIMEOUT_MS / 1000}s process limit`);
    if (harnessError || outcome.code !== 0) throw new Error(`${lang} failed: ${harnessError ?? (outcome.stderr.slice(0, 300) || `exit code ${outcome.code}`)}`);
    if (helloMs !== null) probe.startup.push(helloMs);
    if (sink) {
      if (outcome.peakRssBytes !== null) sink.peakRss.push(outcome.peakRssBytes);
      if (outcome.cpuMs !== null) sink.cpu.push(outcome.cpuMs);
      sink.wall.push(outcome.wallMs);
      if (config.mode === "cold" && helloMs !== null && firstRunMs !== null) sink.samples.push(helloMs + firstRunMs);
    } else if (outcome.peakRssBytes !== null) {
      probe.baselineRss.push(outcome.peakRssBytes);
    }
  };

  try {
    for (const [index, lang] of order.entries()) {
      const c: Collected = { startup: [], baselineRss: [], samples: [], warmups: [], checks: new Set(), inputHashes: new Set(), ops: 0, genMs: [], peakRss: [], cpu: [], wall: [], phases: [] };
      collected[lang] = c;

      emit({ type: "phase", t: now(), lang, phase: "startup-probe", note: `${STARTUP_PROBES} startup probes (minimum-size input)` });
      for (let p = 0; p < STARTUP_PROBES; p++) await spawnHarness(lang, -(p + 1), challenge.minSize, 0, 0, null, c);

      if (config.mode === "warm") {
        emit({ type: "phase", t: now(), lang, phase: "measure", note: `1 process · ${config.warmup} warm-up · ${config.runs} measured runs` });
        await spawnHarness(lang, 0, config.size, config.warmup, config.runs, c, c);
      } else {
        emit({ type: "phase", t: now(), lang, phase: "measure", note: `${config.runs} fresh processes · startup + first run each` });
        for (let p = 0; p < config.runs; p++) await spawnHarness(lang, p, config.size, 0, 1, c, c);
      }
      if (index === 0) await sleep(COOLDOWN_MS);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "battle:error", t: now(), message });
    throw err;
  }

  const fighters = config.fighters.map((lang) => buildFighter(lang, collected[lang], environment.runtimes[lang]!, challenge.phases));
  const verification = verify(fighters[0], fighters[1]);
  const result: BattleResult = {
    id,
    config,
    environment,
    order,
    startedAt,
    durationMs: performance.now() - t0,
    fighters: Object.fromEntries(fighters.map((f) => [f.lang, f])),
    verification,
    comparison: compare(fighters[0], fighters[1], verification),
    scores: score(fighters, config.mode),
  };
  emit({ type: "battle:result", t: now(), result });
  return result;
}

function buildFighter(lang: LanguageId, c: Collected, runtime: RuntimeInfo, phaseNames?: string[]): FighterResult {
  const stats = describe(c.samples);
  const phases: PhaseStat[] | null =
    phaseNames && c.phases.length ? phaseNames.map((name, i) => ({ name, medianMs: median(c.phases.map((p) => p[i] ?? 0)) })) : null;
  return {
    lang,
    runtime,
    inputHash: c.inputHashes.size === 1 ? [...c.inputHashes][0] : null,
    checks: [...c.checks],
    ops: c.ops,
    samplesMs: c.samples,
    warmupMs: c.warmups,
    stats,
    startup: describe(c.startup),
    peakRssBytes: c.peakRss.length ? Math.max(...c.peakRss) : null,
    baselineRssBytes: c.baselineRss.length ? median(c.baselineRss) : null,
    cpuMs: c.cpu.length ? median(c.cpu) : null,
    wallMs: c.wall.length ? median(c.wall) : null,
    genMs: c.genMs.length ? median(c.genMs) : 0,
    opsPerSec: stats.median > 0 ? c.ops / (stats.median / 1000) : 0,
    phases,
  };
}
