import { CHALLENGES, getChallenge } from "./challenges";
import { isExecutable } from "./languages";
import type { BattleConfig, BattleMode, ChallengeId, LanguageId } from "./types";

export const LIMITS = {
  warmup: { min: 0, max: 20, default: 3 },
  runs: { min: 1, max: 30, default: 10 },
  coldRuns: { min: 1, max: 15, default: 5 },
  seed: { min: 1, max: 2 ** 31 - 1, default: 48291 },
} as const;

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function defaultConfig(challenge: ChallengeId, fighters: [LanguageId, LanguageId], mode: BattleMode = "warm"): BattleConfig {
  const c = getChallenge(challenge) ?? CHALLENGES[0];
  return {
    challenge: c.id,
    fighters,
    mode,
    size: c.defaultSize,
    seed: LIMITS.seed.default,
    warmup: mode === "warm" ? LIMITS.warmup.default : 0,
    runs: mode === "warm" ? LIMITS.runs.default : LIMITS.coldRuns.default,
  };
}

export type ParseResult = { ok: true; config: BattleConfig } | { ok: false; error: string };

export function parseConfig(input: Record<string, unknown>): ParseResult {
  const challenge = getChallenge(String(input.challenge ?? ""));
  if (!challenge) return { ok: false, error: "unknown challenge" };
  const fighters = input.fighters;
  if (!Array.isArray(fighters) || fighters.length !== 2) return { ok: false, error: "exactly two fighters required" };
  const [a, b] = fighters.map(String);
  if (!isExecutable(a) || !isExecutable(b)) return { ok: false, error: "fighter is not executable" };
  if (a === b) return { ok: false, error: "a language cannot fight itself (yet)" };
  const mode: BattleMode = input.mode === "cold" ? "cold" : "warm";
  const runLimits = mode === "warm" ? LIMITS.runs : LIMITS.coldRuns;
  return {
    ok: true,
    config: {
      challenge: challenge.id,
      fighters: [a, b],
      mode,
      size: clampInt(input.size, challenge.minSize, challenge.maxSize, challenge.defaultSize),
      seed: clampInt(input.seed, LIMITS.seed.min, LIMITS.seed.max, LIMITS.seed.default),
      warmup: mode === "warm" ? clampInt(input.warmup, LIMITS.warmup.min, LIMITS.warmup.max, LIMITS.warmup.default) : 0,
      runs: clampInt(input.runs, runLimits.min, runLimits.max, runLimits.default),
    },
  };
}

export function matchupSlug(a: string, b: string) {
  return `${a}-vs-${b}`;
}

export function parseMatchup(slug: string): [string, string] | null {
  const parts = slug.split("-vs-");
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

export function battlePath(config: Pick<BattleConfig, "fighters" | "challenge">) {
  return `/battle/${matchupSlug(config.fighters[0], config.fighters[1])}/${config.challenge}`;
}

export function configQuery(config: BattleConfig): string {
  const c = getChallenge(config.challenge);
  const q = new URLSearchParams();
  if (config.mode !== "warm") q.set("mode", config.mode);
  if (c && config.size !== c.defaultSize) q.set("size", String(config.size));
  if (config.seed !== LIMITS.seed.default) q.set("seed", String(config.seed));
  if (config.mode === "warm" && config.warmup !== LIMITS.warmup.default) q.set("warmup", String(config.warmup));
  const defRuns = config.mode === "warm" ? LIMITS.runs.default : LIMITS.coldRuns.default;
  if (config.runs !== defRuns) q.set("runs", String(config.runs));
  const s = q.toString();
  return s ? `?${s}` : "";
}
