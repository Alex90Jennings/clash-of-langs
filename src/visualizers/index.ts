import type { ChallengeId } from "@/lib/types";
import type { CreateVisualizer } from "./types";

export const loadVisualizer: Record<ChallengeId, () => Promise<{ default: CreateVisualizer }>> = {
  sort: () => import("./sort"),
  json: () => import("./json"),
  strings: () => import("./strings"),
  sieve: () => import("./sieve"),
  records: () => import("./records"),
  search: () => import("./search"),
  csv: () => import("./csv"),
  metrics: () => import("./metrics"),
  infer: () => import("./infer"),
  embed: () => import("./embed"),
  pixel: () => import("./pixel"),
};

export const VIZ_CAPTION: Record<ChallengeId, string> = {
  sort: "first 96 values of the real dataset · merge-sort visual",
  json: "first 28 real records · red = dropped by filter",
  strings: "first 60 real log lines · regex extraction",
  sieve: "exact sieve over 2..201",
  records: "first 400 real records · filter → group → sort",
  search: "first 72 real keys · phase widths = measured medians",
  csv: "first 600 real orders · revenue by region × month",
  metrics: "first 720 real latency samples · rolling mean, buckets, percentiles",
  infer: "the real model on the battle's first samples · 16 of 64 units shown",
  embed: "first 240 real documents vs the first real query",
  pixel: "top-left 64×64 of the real image · each pipeline stage",
};
