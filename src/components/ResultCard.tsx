import { BRAND } from "@/lib/brand";
import { getChallenge } from "@/lib/challenges";
import { getLanguage } from "@/lib/languages";
import type { BattleResult } from "@/lib/types";

export interface ResultCardData {
  a: { name: string; glyph: string; color: string; value: string };
  b: { name: string; glyph: string; color: string; value: string };
  label: string;
  winner: 0 | 1 | null;
  footnote: string;
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : ms >= 10 ? `${ms.toFixed(0)}ms` : `${ms.toFixed(1)}ms`);

export function toCardData(r: BattleResult): ResultCardData {
  const [la, lb] = r.config.fighters;
  const fa = r.fighters[la];
  const fb = r.fighters[lb];
  const ma = getLanguage(la)!;
  const mb = getLanguage(lb)!;
  const w = r.comparison.winner;
  return {
    a: { name: ma.name, glyph: ma.glyph, color: ma.color, value: fmt(fa.stats.median) },
    b: { name: mb.name, glyph: mb.glyph, color: mb.color, value: fmt(fb.stats.median) },
    label: getChallenge(r.config.challenge)!.sizeLabel(r.config.size),
    winner: w === la ? 0 : w === lb ? 1 : null,
    footnote: r.comparison.verdict === "invalid" ? "verification failed · no winner" : r.comparison.verdict === "draw" ? `draw · within noise · seed ${r.config.seed}` : `${r.config.mode} · median of ${r.config.runs} · seed ${r.config.seed}`,
  };
}

export function ResultCard({ data }: { data: ResultCardData }) {
  const side = (s: ResultCardData["a"], won: boolean) => (
    <div>
      <div className="sc-crown" style={{ visibility: won ? "visible" : "hidden" }}>
        ◆ WINNER ◆
      </div>
      <div className="sc-name" style={{ color: s.color, textShadow: `0 0 2cqw ${s.color}80` }}>
        {s.name}
      </div>
      <div className="sc-time">{s.value}</div>
    </div>
  );
  return (
    <figure className="share-card" aria-label={`${data.a.name} versus ${data.b.name}: ${data.label}`} style={{ margin: "0 auto" }}>
      <div className="sc-brand">{BRAND.wordmark}</div>
      <div className="sc-main">
        {side(data.a, data.winner === 0)}
        <div className="sc-vs">VS</div>
        {side(data.b, data.winner === 1)}
      </div>
      <div className="sc-foot">
        <span>{data.label}</span>
        <span>{data.footnote}</span>
        <span>{BRAND.domain}</span>
      </div>
    </figure>
  );
}
