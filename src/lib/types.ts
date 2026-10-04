export type LanguageId =
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "kotlin"
  | "swift"
  | "php"
  | "ruby"
  | "dart"
  | "scala"
  | "lua"
  | "perl"
  | "r"
  | "elixir"
  | "erlang"
  | "haskell"
  | "ocaml"
  | "zig"
  | "julia";

export type ChallengeId = "sort" | "json" | "strings" | "sieve" | "records" | "search" | "csv" | "metrics" | "infer" | "embed" | "pixel";

export type BattleMode = "warm" | "cold";

export interface BattleConfig {
  challenge: ChallengeId;
  fighters: [LanguageId, LanguageId];
  mode: BattleMode;
  size: number;
  seed: number;
  warmup: number;
  runs: number;
}

export interface WorkerEnvironment {
  workerId: string;
  os: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  containerised: boolean;
  memoryProbe: "bsd-time" | "gnu-time" | "none";
  runtimes: Partial<Record<LanguageId, RuntimeInfo>>;
}

export interface RuntimeInfo {
  available: boolean;
  version: string | null;
  engine: string;
  command: string;
  build: string | null;
  reason?: string;
}

export interface Capabilities {
  online: boolean;
  mode: "local" | "remote" | "offline";
  environment: WorkerEnvironment | null;
  message?: string;
}

export interface PhaseStat {
  name: string;
  medianMs: number;
}

export interface Stats {
  n: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  stddev: number;
  cv: number;
  mad: number;
  outliers: number[];
}

export interface FighterResult {
  lang: LanguageId;
  runtime: RuntimeInfo;
  inputHash: string | null;
  checks: string[];
  ops: number;
  samplesMs: number[];
  warmupMs: number[];
  stats: Stats;
  startup: Stats;
  peakRssBytes: number | null;
  baselineRssBytes: number | null;
  cpuMs: number | null;
  wallMs: number | null;
  genMs: number;
  opsPerSec: number;
  phases: PhaseStat[] | null;
}

export interface MetricScore {
  metric: "performance" | "memory" | "startup" | "consistency";
  label: string;
  values: Record<string, number | null>;
  unit: string;
  scores: Record<string, number | null>;
  leader: LanguageId | null;
  formula: string;
}

export interface Comparison {
  faster: LanguageId | null;
  slower: LanguageId | null;
  ratio: number;
  pValue: number | null;
  significant: boolean;
  winner: LanguageId | null;
  verdict: "victory" | "draw" | "invalid";
}

export interface Verification {
  inputsMatch: boolean;
  outputsMatch: boolean;
  stable: boolean;
  inputHash: string | null;
  outputHash: string | null;
}

export interface BattleResult {
  id: string;
  config: BattleConfig;
  environment: WorkerEnvironment;
  order: [LanguageId, LanguageId];
  startedAt: string;
  durationMs: number;
  fighters: Record<string, FighterResult>;
  verification: Verification;
  comparison: Comparison;
  scores: MetricScore[];
}

export type BattleEvent =
  | { type: "battle:start"; t: number; id: string; config: BattleConfig; order: [LanguageId, LanguageId]; environment: WorkerEnvironment }
  | { type: "phase"; t: number; lang: LanguageId; phase: "startup-probe" | "measure"; note: string }
  | { type: "fighter:spawn"; t: number; lang: LanguageId; proc: number }
  | { type: "fighter:hello"; t: number; lang: LanguageId; proc: number; startupMs: number }
  | { type: "fighter:ready"; t: number; lang: LanguageId; proc: number; genMs: number; inputHash: string; ops: number }
  | { type: "fighter:warmup"; t: number; lang: LanguageId; proc: number; i: number; ms: number }
  | { type: "fighter:run"; t: number; lang: LanguageId; proc: number; i: number; ms: number; check: string; phases?: number[] }
  | { type: "fighter:exit"; t: number; lang: LanguageId; proc: number; code: number | null; peakRssBytes: number | null; cpuMs: number | null; wallMs: number }
  | { type: "fighter:error"; t: number; lang: LanguageId; message: string }
  | { type: "battle:result"; t: number; result: BattleResult }
  | { type: "battle:error"; t: number; message: string };
