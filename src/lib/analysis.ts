import { describe, mannWhitneyU } from "./stats";
import type { Comparison, FighterResult, LanguageId, MetricScore, Verification } from "./types";

export const SIGNIFICANCE_LEVEL = 0.05;
export const CV_FLOOR = 0.01;

export function verify(a: FighterResult, b: FighterResult): Verification {
  const stable = a.checks.length === 1 && b.checks.length === 1;
  const inputsMatch = a.inputHash !== null && a.inputHash === b.inputHash;
  const outputsMatch = stable && a.checks[0] === b.checks[0];
  return { inputsMatch, outputsMatch, stable, inputHash: inputsMatch ? a.inputHash : null, outputHash: outputsMatch ? a.checks[0] : null };
}

export function compare(a: FighterResult, b: FighterResult, v: Verification): Comparison {
  if (!v.inputsMatch || !v.outputsMatch || a.samplesMs.length === 0 || b.samplesMs.length === 0) {
    return { faster: null, slower: null, ratio: 1, pValue: null, significant: false, winner: null, verdict: "invalid" };
  }
  const [fast, slow] = a.stats.median <= b.stats.median ? [a, b] : [b, a];
  const pValue = mannWhitneyU(a.samplesMs, b.samplesMs);
  const significant = pValue !== null && pValue < SIGNIFICANCE_LEVEL && fast.stats.median !== slow.stats.median;
  return {
    faster: fast.lang,
    slower: slow.lang,
    ratio: slow.stats.median / fast.stats.median,
    pValue,
    significant,
    winner: significant ? fast.lang : null,
    verdict: significant ? "victory" : "draw",
  };
}

function relative(values: Record<string, number | null>): Record<string, number | null> {
  const present = Object.values(values).filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  const best = present.length ? Math.min(...present) : null;
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = best === null || v === null || !(v > 0) ? null : Math.round((100 * best) / v) / 10;
  }
  return out;
}

function leaderOf(scores: Record<string, number | null>): LanguageId | null {
  const entries = Object.entries(scores).filter((e): e is [string, number] => e[1] !== null);
  if (entries.length < 2) return null;
  entries.sort((x, y) => y[1] - x[1]);
  return entries[0][1] > entries[1][1] ? (entries[0][0] as LanguageId) : null;
}

const mb = (bytes: number | null) => (bytes === null ? null : bytes / (1024 * 1024));

export function score(fighters: FighterResult[], mode: "warm" | "cold"): MetricScore[] {
  const metric = (
    key: MetricScore["metric"],
    label: string,
    unit: string,
    pick: (f: FighterResult) => number | null,
    formula: string,
    scoreInput?: (f: FighterResult) => number | null,
  ): MetricScore => {
    const values = Object.fromEntries(fighters.map((f) => [f.lang, pick(f)]));
    const scores = relative(Object.fromEntries(fighters.map((f) => [f.lang, (scoreInput ?? pick)(f)])));
    return { metric: key, label, values, unit, scores, leader: leaderOf(scores), formula };
  };

  return [
    metric(
      "performance",
      "PERFORMANCE",
      "ms",
      (f) => f.stats.median,
      mode === "warm"
        ? "10 × (fastest median run time ÷ this fighter's median run time), measured in-process after warm-up."
        : "10 × (fastest median ÷ this median), where each sample is a fresh process: startup + first, unwarmed run.",
    ),
    metric("memory", "MEMORY", "MB", (f) => mb(f.peakRssBytes), "10 × (lowest peak RSS ÷ this fighter's peak RSS). Peak RSS includes the runtime itself, not just the data."),
    metric("startup", "STARTUP", "ms", (f) => f.startup.median, "10 × (fastest ÷ this), using the median time from process spawn to the first line of output, over every process launched in the battle (including dedicated probes)."),
    metric(
      "consistency",
      "CONSISTENCY",
      "% cv",
      (f) => f.stats.cv * 100,
      `10 × (lowest coefficient of variation ÷ this one), with variation below ${CV_FLOOR * 100}% treated as equal noise.`,
      (f) => Math.max(f.stats.cv, CV_FLOOR),
    ),
  ];
}

export { describe };
