import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const SAMPLE = 720;
const W = 60;

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const values = Array.from({ length: SAMPLE }, () => {
    let v = 20 + rng.int(80);
    if (rng.int(100) < 3) v += 200 + rng.int(800);
    return v;
  });
  const rolling = values.map((_, i) => {
    if (i < W - 1) return null;
    let s = 0;
    for (let k = i - W + 1; k <= i; k++) s += values[k];
    return s / W;
  });
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.floor((p * SAMPLE + 99) / 100) - 1];
  const pct = [
    { label: "p50", v: rank(50) },
    { label: "p95", v: rank(95) },
    { label: "p99", v: rank(99) },
  ];
  const maxV = Math.max(...values);
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
      const top = 22, bottom = h - 14, left = 34, right = w - 8;
      const scaleY = (v: number) => bottom - (Math.sqrt(v) / Math.sqrt(maxV)) * (bottom - top);
      const xAt = (i: number) => left + (i / (SAMPLE - 1)) * (right - left);
      const shown = f.mode === "idle" ? SAMPLE : Math.max(2, Math.floor(Math.min(1, p / 0.75) * SAMPLE));
      const showPct = f.mode === "idle" || p > 0.75;

      for (let b = 0; b < SAMPLE; b += W) {
        if (b >= shown) break;
        let max = 0;
        for (let i = b; i < Math.min(b + W, shown); i++) max = Math.max(max, values[i]);
        ctx.fillStyle = withAlpha(f.color, 0.08);
        ctx.fillRect(xAt(b), scaleY(max), xAt(Math.min(b + W, SAMPLE - 1)) - xAt(b) - 2, bottom - scaleY(max));
      }

      for (let i = 0; i < shown; i++) {
        const spike = values[i] >= 220;
        ctx.fillStyle = spike ? "#ff4d6d" : withAlpha(f.color, 0.55);
        ctx.fillRect(xAt(i), scaleY(values[i]), Math.max(1, (right - left) / SAMPLE), spike ? 3 : 1.5);
      }

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = W - 1; i < shown; i++) {
        const y = scaleY(rolling[i]!);
        if (!started) ctx.moveTo(xAt(i), y);
        else ctx.lineTo(xAt(i), y);
        started = true;
      }
      ctx.stroke();

      if (showPct) {
        ctx.setLineDash([3, 4]);
        pct.forEach((q, i) => {
          const y = scaleY(q.v);
          ctx.strokeStyle = withAlpha(f.color, 0.4 + i * 0.25);
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillStyle = i === 2 ? "#ffffff" : withAlpha(f.color, 0.9);
          ctx.fillText(`${q.label} ${q.v}ms`, left - 30, y - 2);
        });
        ctx.setLineDash([]);
      }

      ctx.fillStyle = withAlpha(f.color, 0.8);
      ctx.fillText(showPct ? "PERCENTILES" : `ROLLING ${W}-SAMPLE MEAN`, left, 12);
      ctx.fillStyle = withAlpha(f.color, 0.5);
      ctx.fillText("latency (ms, sqrt scale) · white = rolling mean · red = spike", Math.max(left + 150, right - 380), 12);
    },
  };
};

export default create;
