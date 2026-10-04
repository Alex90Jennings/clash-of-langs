import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"];
const SAMPLE = 400;
const STAGES = ["FILTER", "GROUP", "SORT", "AGGREGATE"];

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const cutoff = 1700000000 + 15768000;
  const recs = Array.from({ length: SAMPLE }, () => {
    const c = rng.int(20);
    const age = 10 + rng.int(80);
    const score = rng.int(1000);
    const createdAt = 1700000000 + rng.int(31536000);
    return { c, score, keep: age >= 18 && score >= 100 && createdAt >= cutoff, lane: Math.random() };
  });
  const finalSums = new Array(20).fill(0);
  recs.forEach((r) => r.keep && (finalSums[r.c] += r.score));
  const maxSum = Math.max(...finalSums);
  const order = [...finalSums.keys()].sort((a, b) => finalSums[b] - finalSums[a] || (COUNTRIES[a] < COUNTRIES[b] ? -1 : 1));
  const rankOf = new Array(20);
  order.forEach((c, i) => (rankOf[c] = i));
  const pos = Array.from({ length: 20 }, (_, i) => i);
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 2);
      const flowEnd = 0.7;
      const flowP = Math.min(1, p / flowEnd);
      const sortP = Math.max(0, Math.min(1, (p - flowEnd) / 0.2));
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      const stage = f.mode === "idle" ? -1 : p < 0.35 ? 0 : p < flowEnd ? 1 : p < 0.9 ? 2 : 3;
      STAGES.forEach((s, i) => {
        ctx.fillStyle = i === stage ? "#ffffff" : withAlpha(f.color, i < stage ? 0.8 : 0.35);
        ctx.fillText((i ? "→ " : "") + s, 8 + i * ((w - 16) / 4), 14);
      });

      const leftW = w * 0.42;
      const filterX = leftW * 0.55;
      const sums = new Array(20).fill(0);
      const arrived = Math.floor(flowP * SAMPLE);
      for (let i = Math.max(0, arrived - 40); i < Math.min(SAMPLE, arrived + 1) && f.mode !== "idle"; i++) {
        const r = recs[i];
        const life = (arrived - i) / 40;
        const x = 8 + life * leftW;
        const y = 26 + r.lane * (h - 40);
        if (!r.keep && x > filterX) continue;
        ctx.fillStyle = !r.keep && x > filterX - 12 ? "#ff4d6d" : withAlpha(f.color, 0.9);
        ctx.fillRect(x, y, 3, 3);
      }
      for (let i = 0; i < arrived; i++) if (recs[i].keep) sums[recs[i].c] += recs[i].score;
      ctx.strokeStyle = withAlpha(f.color, 0.4);
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(filterX, 22);
      ctx.lineTo(filterX, h - 6);
      ctx.stroke();
      ctx.setLineDash([]);

      const bx = leftW + 16;
      const bw = (w - bx - 8) / 20;
      for (let c = 0; c < 20; c++) {
        pos[c] += ((sortP > 0 ? rankOf[c] : c) - pos[c]) * Math.min(1, f.dt * 6);
        const x = bx + pos[c] * bw;
        const bh = (sums[c] / maxSum) * (h - 52);
        ctx.fillStyle = stage === 3 && rankOf[c] === 0 ? "#ffffff" : withAlpha(f.color, 0.35 + 0.6 * (sums[c] / maxSum));
        ctx.fillRect(x + 1, h - 18 - bh, bw - 2, bh);
        ctx.save();
        ctx.translate(x + bw / 2 + 3, h - 4);
        ctx.fillStyle = withAlpha(f.color, 0.7);
        ctx.font = `${Math.min(9, bw * 0.75)}px ${MONO}`;
        ctx.textAlign = "center";
        ctx.fillText(COUNTRIES[c], 0, 0);
        ctx.restore();
      }
    },
  };
};

export default create;
