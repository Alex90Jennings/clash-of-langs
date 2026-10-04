import { getChallenge } from "./challenges";
import { getLanguage } from "./languages";
import type { BattleResult, FighterResult, LanguageId } from "./types";

const name = (l: LanguageId) => getLanguage(l)?.name ?? l;
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v >= 10 ? `${v.toFixed(1)} ms` : `${v.toFixed(2)} ms`);
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const x = (r: number) => (r >= 10 ? `${r.toFixed(0)}×` : `${r.toFixed(2)}×`);
const p = (v: number | null) => (v === null ? "= n/a" : v < 0.001 ? "< 0.001" : `= ${v.toFixed(3)}`);

export interface Insights {
  performance: string;
  memory: string;
  startup: string;
  cpu: string | null;
  why: string[];
  scope: string;
}

export function explain(r: BattleResult): Insights {
  const [a, b] = r.config.fighters.map((l) => r.fighters[l]) as [FighterResult, FighterResult];
  const c = getChallenge(r.config.challenge)!;
  const cmp = r.comparison;
  const n = Math.min(a.stats.n, b.stats.n);

  let performance: string;
  if (cmp.verdict === "invalid") {
    performance = "Verification failed — the fighters did not receive identical inputs or did not produce identical outputs, so no performance comparison is made. This is a bug in an implementation, and it is reported rather than hidden.";
  } else {
    const fast = r.fighters[cmp.faster!];
    const slow = r.fighters[cmp.slower!];
    const what = r.config.mode === "warm" ? "warm median" : "cold-start median (startup + first run)";
    if (cmp.verdict === "victory") {
      performance = `${name(fast.lang)} completed this workload ${x(cmp.ratio)} faster — ${what} ${ms(fast.stats.median)} vs ${ms(slow.stats.median)} over ${n} samples each (Mann–Whitney p ${p(cmp.pValue)}).`;
      if (cmp.ratio < 1.05) performance += " The margin is under 5%: real, but small enough that a different machine or runtime version could flip it.";
    } else {
      const pct = ((cmp.ratio - 1) * 100).toFixed(1);
      const outliers = fast.stats.outliers.length + slow.stats.outliers.length;
      const why =
        n < 5
          ? "Use at least 5 runs to give significance a chance."
          : cmp.ratio > 1.3 && outliers > 0
            ? `The medians are far apart, but ${outliers} outlier run${outliers > 1 ? "s" : ""} (likely a GC pause or OS scheduling) overlapped the other fighter's range, and with only ${n} samples one overlap is enough to block significance. Rerun with more runs before calling it.`
            : "Declaring a winner here would be reading noise.";
      performance = `Too close to call. Medians are ${ms(fast.stats.median)} vs ${ms(slow.stats.median)} (${pct}% apart), but with ${n} samples each the difference is not statistically significant (p ${p(cmp.pValue)}). ${why}`;
    }
  }

  let memory = "Peak memory could not be measured on this worker.";
  if (a.peakRssBytes && b.peakRssBytes) {
    const [lo, hi] = a.peakRssBytes <= b.peakRssBytes ? [a, b] : [b, a];
    const base = (f: FighterResult) => (f.baselineRssBytes ? `${name(f.lang)} ${mb(f.baselineRssBytes)}` : `${name(f.lang)} n/a`);
    memory = `${name(lo.lang)} used ${x(hi.peakRssBytes! / lo.peakRssBytes!)} less peak memory (${mb(lo.peakRssBytes!)} vs ${mb(hi.peakRssBytes!)}). Peak RSS includes the runtime itself — the minimal-input baselines were ${base(a)} and ${base(b)}. Garbage-collected runtimes also size their heaps ahead of need, so RSS is not the same thing as live data.`;
  }

  const [sf, ss] = a.startup.median <= b.startup.median ? [a, b] : [b, a];
  const startup = `${name(sf.lang)} reached its first line of output ${x(ss.startup.median / sf.startup.median)} sooner (${ms(sf.startup.median)} vs ${ms(ss.startup.median)}, median of ${Math.min(a.startup.n, b.startup.n)} launches). ${r.config.mode === "warm" ? "In WARM mode startup is reported separately and is not part of the performance result." : "In COLD mode it is part of every sample."}`;

  const busy = [a, b].filter((f) => f.cpuMs !== null && f.wallMs !== null && f.wallMs > 0 && f.cpuMs / f.wallMs > 1.15);
  const cpu = busy.length
    ? busy.map((f) => `${name(f.lang)} burned ${Math.round((100 * f.cpuMs!) / f.wallMs!)}% CPU relative to wall time`).join("; ") + " — background threads (JIT compilation, concurrent GC) were working alongside the benchmark. The workload itself is single-threaded in every fighter."
    : null;

  const why: string[] = [];
  for (const f of [a, b]) {
    const impl = c.implementations[f.lang];
    const meta = getLanguage(f.lang);
    if (impl) why.push(`${name(f.lang)} — ${impl.api}. ${impl.notes}`);
    else if (meta) why.push(`${name(f.lang)} runs on ${meta.runtime}: ${meta.execution.toLowerCase()}, ${meta.typing} typing, ${meta.memory}. Source: bench/ — same algorithm and move order as every other fighter.`);
  }
  for (const factor of c.factors ?? []) why.push(factor);
  const ids = new Set([a.lang, b.lang]);
  if (ids.has("javascript") && ids.has("typescript")) {
    why.push("TypeScript compiles to JavaScript and runs on the same V8 engine with the same flags. Any gap between these two reflects noise or tiny differences in emitted code — not the type system.");
  }
  const meta = [a, b].map((f) => getLanguage(f.lang)!);
  if (r.config.mode === "cold" && meta.some((m) => m.execution.includes("JIT"))) {
    why.push("Cold start: JIT-based runtimes begin in an interpreter or baseline tier and only optimise hot code after it has run for a while, so a single unwarmed run understates their steady-state speed. Switch to WARM RUNTIME to see the difference.");
  }
  if (r.config.mode === "warm" && meta.some((m) => m.execution === "Bytecode VM + JIT") && r.config.warmup < 3) {
    why.push(`Only ${r.config.warmup} warm-up run(s): the JVM's C2 compiler may not have finished optimising, which can understate Java's steady state.`);
  }
  for (const f of [a, b]) {
    if (f.stats.outliers.length) {
      why.push(`${name(f.lang)} had ${f.stats.outliers.length} outlier run(s) (modified z-score > 3.5) — typically a garbage-collection pause or OS scheduling. They are flagged, kept, and the median absorbs them.`);
    }
  }
  if (c.phases && a.phases && b.phases) {
    for (const f of [a, b]) {
      const ph = f.phases!;
      const hash = ph[1]?.medianMs ?? 0;
      const bin = ph[3]?.medianMs ?? 0;
      if (hash > 0 && bin > 0) {
        const winner = hash <= bin ? "hash probing" : "binary search";
        why.push(`${name(f.lang)}: ${winner} answered the queries faster (${ms(hash)} hash vs ${ms(bin)} binary), but building the index cost ${ms(ph[0].medianMs)} (hash) vs ${ms(ph[2].medianMs)} (sort).`);
      }
    }
  }

  const env = r.environment;
  const versions = [a, b].map((f) => `${name(f.lang)} ${f.runtime.version ?? "?"}`).join(", ");
  const scope = `Scoped to this workload (${c.sizeLabel(r.config.size).toLowerCase()}, seed ${r.config.seed}), these implementations, these runtimes (${versions}), this machine (${env.cpuModel}, ${env.os}${env.containerised ? ", containerised" : ""}) and this run (${new Date(r.startedAt).toUTCString()}). It says nothing about which language is better in general.`;

  return { performance, memory, startup, cpu, why, scope };
}
