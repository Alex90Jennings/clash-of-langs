import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClashOfLangsApp } from "@/components/ClashOfLangsApp";
import { getChallenge } from "@/lib/challenges";
import { parseConfig, parseMatchup } from "@/lib/config";
import { getLanguage, isExecutable } from "@/lib/languages";

type Params = Promise<{ matchup: string; challenge: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { matchup, challenge } = await params;
  const pair = parseMatchup(matchup);
  const c = getChallenge(challenge);
  if (!pair || !c) return {};
  const [a, b] = pair.map((l) => getLanguage(l)?.name ?? l);
  return { title: `${a} vs ${b} — ${c.name}`, description: `${a} and ${b} battle on identical seeded inputs: ${c.tagline}` };
}

export default async function BattlePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { matchup, challenge } = await params;
  const q = await searchParams;
  const pair = parseMatchup(matchup);
  if (!pair || !getChallenge(challenge) || !pair.every((l) => getLanguage(l) && isExecutable(l))) notFound();
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : q[k]);
  const parsed = parseConfig({ challenge, fighters: pair, mode: one("mode"), size: one("size"), seed: one("seed"), warmup: one("warmup"), runs: one("runs") });
  if (!parsed.ok) notFound();
  return <ClashOfLangsApp initial={parsed.config} autostart={one("go") === "1"} />;
}
