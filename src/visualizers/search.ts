import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const COLS = 8;
const ROWS = 9;
const N = COLS * ROWS;
const PHASES = ["HASH BUILD", "HASH PROBE", "SORT INDEX", "BINARY SEARCH"];

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const keys = Array.from({ length: N }, () => rng.next() & 0x7fffffff);
  const sorted = keys.slice().sort((a, b) => a - b);
  const sortedPos = keys.map((k) => sorted.indexOf(k));
  const queries = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? keys[rng.int(N)] : rng.next() & 0x7fffffff));
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 2.4);
      const weights = f.phaseWeights && f.phaseWeights.length === 4 ? f.phaseWeights : [0.25, 0.25, 0.25, 0.25];
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = 0, phase = 0, local = 0;
      for (let i = 0; i < 4; i++) {
        const span = weights[i] / total;
        if (p <= acc + span || i === 3) {
          phase = i;
          local = span > 0 ? Math.min(1, (p - acc) / span) : 1;
          break;
        }
        acc += span;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      let x0 = 8;
      PHASES.forEach((name, i) => {
        const pw = ((w - 16) * weights[i]) / total;
        ctx.fillStyle = withAlpha(f.color, f.mode === "idle" ? 0.15 : i < phase ? 0.6 : i === phase ? 0.9 : 0.15);
        ctx.fillRect(x0, 6, Math.max(1, pw - 2), 6);
        if (pw > 70) {
          ctx.fillStyle = i === phase && f.mode !== "idle" ? "#ffffff" : withAlpha(f.color, 0.6);
          ctx.fillText(name, x0, 24);
        }
        x0 += pw;
      });

      const top = 34;
      const cw = (w - 16) / COLS;
      const ch = (h - top - 6) / ROWS;
      const sortedPhase = phase >= 3 || (phase === 2 && local > 0);
      const t = phase === 2 ? local : phase > 2 ? 1 : 0;
      const q = queries[Math.floor(local * queries.length) % queries.length];
      let lo = 0, hi = N;
      if (phase === 3) {
        const steps = Math.floor(((local * queries.length) % 1) * 7);
        for (let s = 0; s < steps && lo < hi; s++) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid] < q) lo = mid + 1;
          else hi = mid;
        }
      }
      ctx.font = `${Math.min(11, cw * 0.13)}px ${MONO}`;
      for (let i = 0; i < N; i++) {
        const from = i;
        const to = sortedPos[i];
        const slot = sortedPhase ? from + (to - from) * t : from;
        const x = 8 + (slot % COLS) * cw;
        const y = top + Math.floor(slot / COLS) * ch;
        const k = keys[i];
        let alpha = 0.45;
        let hot = false;
        if (f.mode !== "idle") {
          if (phase === 0) alpha = i / N < local ? 0.85 : 0.2;
          if (phase === 1 && k === q) hot = true;
          if (phase === 3) {
            const sp = to;
            alpha = sp >= lo && sp < hi ? 0.9 : 0.15;
            if (k === q && lo >= hi - 1) hot = true;
          }
        }
        ctx.fillStyle = hot ? "#ffffff" : withAlpha(f.color, alpha);
        ctx.fillText(k.toString(16).padStart(8, "0").toUpperCase(), x + 4, y + ch * 0.65);
      }
      if (f.mode !== "idle" && (phase === 1 || phase === 3)) {
        ctx.fillStyle = withAlpha(f.color, 0.9);
        ctx.fillText(`probe 0x${q.toString(16).toUpperCase()}`, w - 140, h - 6);
      }
    },
  };
};

export default create;
