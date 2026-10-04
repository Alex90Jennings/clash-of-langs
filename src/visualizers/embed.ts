import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const D = 64, K = 10;
const COLS = 24, ROWS = 10;
const SHOWN = COLS * ROWS;

const create: CreateVisualizer = (seed, size) => {
  const n = Math.max(SHOWN, size);
  const rng = new Rng(seed);
  const docs: number[][] = [];
  for (let d = 0; d < n; d++) {
    if (d < SHOWN) docs.push(Array.from({ length: D }, () => rng.int(256) - 128));
    else for (let k = 0; k < D; k++) rng.next();
  }
  const query = Array.from({ length: D }, () => rng.int(256) - 128);
  const scores = docs.map((doc) => doc.reduce((s, v, k) => s + v * query[k], 0));
  const ranked = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const top = ranked.slice(0, K);
  const topSet = new Set(top.map((t) => t.i));
  const maxAbs = Math.max(...scores.map(Math.abs)) || 1;
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 2.4);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      const scanned = f.mode === "idle" ? 0 : Math.floor(Math.min(1, p / 0.7) * SHOWN);
      const ranking = f.mode === "idle" || p >= 0.7;

      ctx.fillStyle = withAlpha(f.color, 0.8);
      ctx.fillText("QUERY", 8, 14);
      const qw = (w * 0.62 - 54) / D;
      query.forEach((v, k) => {
        ctx.fillStyle = withAlpha(f.color, 0.1 + 0.9 * (Math.abs(v) / 128));
        ctx.fillRect(50 + k * qw, 6, Math.max(1, qw - 1), 10);
      });

      const gridW = w * 0.62;
      const cw = (gridW - 8) / COLS;
      const ch = (h - 32) / ROWS;
      for (let i = 0; i < SHOWN; i++) {
        const x = 8 + (i % COLS) * cw;
        const y = 26 + Math.floor(i / COLS) * ch;
        const done = i < scanned || ranking;
        const v = Math.max(0, scores[i]) / maxAbs;
        const winner = ranking && topSet.has(i);
        ctx.fillStyle = winner ? "#ffffff" : done ? withAlpha(f.color, 0.08 + 0.85 * v) : withAlpha(f.color, 0.05);
        ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        if (i === scanned && !ranking) {
          ctx.strokeStyle = "#ffffff";
          ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        }
      }

      const lx = gridW + 16;
      ctx.fillStyle = withAlpha(f.color, 0.8);
      ctx.fillText("TOP 10 · DOT PRODUCT", lx, 14);
      const live = ranking ? top : scores.slice(0, scanned).map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, K);
      const rowH = (h - 30) / K;
      live.forEach((t, r) => {
        const y = 28 + r * rowH;
        const bw = ((w - lx - 80) * Math.max(0, t.s)) / maxAbs;
        ctx.fillStyle = withAlpha(f.color, ranking ? 0.8 : 0.45);
        ctx.fillRect(lx + 62, y + 2, Math.max(1, bw), rowH - 5);
        ctx.fillStyle = ranking && r === 0 ? "#ffffff" : withAlpha(f.color, 0.9);
        ctx.fillText(`#${r + 1} d${t.i}`, lx, y + rowH * 0.6);
      });
    },
  };
};

export default create;
