import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const N = 96;

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const initial = Array.from({ length: N }, () => rng.next() & 0x7fffffff);
  const max = Math.max(...initial);
  const writes: [number, number][] = [];
  {
    let a = initial.slice();
    for (let width = 1; width < N; width *= 2) {
      const b = a.slice();
      for (let lo = 0; lo < N; lo += 2 * width) {
        const mid = Math.min(lo + width, N);
        const hi = Math.min(lo + 2 * width, N);
        let i = lo, j = mid;
        for (let k = lo; k < hi; k++) {
          const v = i < mid && (j >= hi || a[i] <= a[j]) ? a[i++] : a[j++];
          b[k] = v;
          writes.push([k, v]);
        }
      }
      a = b;
    }
  }
  let state = initial.slice();
  let applied = 0;
  let lastRun = -1;
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f);
      const target = Math.floor(p * writes.length);
      if (f.runIndex !== lastRun || target < applied) {
        state = initial.slice();
        applied = 0;
        lastRun = f.runIndex;
      }
      while (applied < target) {
        const [k, v] = writes[applied++];
        state[k] = v;
      }
      const cursor = applied > 0 && applied < writes.length ? writes[applied - 1][0] : -1;

      ctx.clearRect(0, 0, w, h);
      const pad = 10;
      const bw = (w - pad * 2) / N;
      for (let i = 0; i < N; i++) {
        const v = state[i] / max;
        const bh = Math.max(2, v * (h - 34));
        const x = pad + i * bw;
        ctx.fillStyle = i === cursor ? "#ffffff" : withAlpha(f.color, 0.25 + v * 0.75);
        ctx.fillRect(x, h - 12 - bh, Math.max(1, bw - 1.5), bh);
      }
      if (f.mode === "done" || (f.mode === "replay" && p >= 1)) {
        ctx.fillStyle = withAlpha(f.color, 0.12 + 0.08 * Math.sin(f.t * 4));
        ctx.fillRect(0, 0, w, h);
      }
      ctx.fillStyle = withAlpha(f.color, 0.7);
      ctx.font = `10px ${MONO}`;
      ctx.fillText(`data[0..95]  min 0x${(state[0] >>> 0).toString(16).padStart(8, "0")}`, 10, 14);
    },
  };
};

export default create;
