import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const IN = 64, H = 64, OUT = 10;
const SAMPLES = 8;
const SHOWN = 16;

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const draw = (count: number, k: number, offset: number) => Array.from({ length: count }, () => rng.int(k) - offset);
  const w1 = draw(H * IN, 255, 127), b1 = draw(H, 2001, 1000);
  const w2 = draw(H * H, 255, 127), b2 = draw(H, 2001, 1000);
  const w3 = draw(OUT * H, 255, 127), b3 = draw(OUT, 2001, 1000);
  const dense = (w: number[], b: number[], x: number[], outLen: number, act: boolean) =>
    Array.from({ length: outLen }, (_, j) => {
      let a = b[j];
      for (let k = 0; k < x.length; k++) a += w[j * x.length + k] * x[k];
      return act ? Math.min(127, Math.max(0, a) >> 10) : a;
    });
  const samples = Array.from({ length: SAMPLES }, () => {
    const x = draw(IN, 256, 128);
    const h1 = dense(w1, b1, x, H, true);
    const h2 = dense(w2, b2, h1, H, true);
    const logits = dense(w3, b3, h2, OUT, false);
    let pred = 0;
    for (let o = 1; o < OUT; o++) if (logits[o] > logits[pred]) pred = o;
    return { x, h1, h2, logits, pred };
  });
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = f.mode === "idle" ? 0.999 : cycle(f, 1.8);
      const sIdx = f.mode === "idle" ? 0 : Math.floor(f.t / 1.8) % SAMPLES;
      const s = samples[sIdx];
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      const layers = [
        { name: "INPUT 64", vals: s.x.slice(0, SHOWN).map((v) => Math.abs(v) / 128) },
        { name: "DENSE+RELU 64", vals: s.h1.slice(0, SHOWN).map((v) => v / 127) },
        { name: "DENSE+RELU 64", vals: s.h2.slice(0, SHOWN).map((v) => v / 127) },
        { name: "LOGITS 10", vals: (() => { const m = Math.max(...s.logits.map(Math.abs)) || 1; return s.logits.map((v) => Math.max(0, v) / m); })() },
      ];
      const active = Math.min(3, Math.floor(p * 4));
      const colX = (i: number) => 40 + (i * (w - 120)) / 3;
      const nodeY = (j: number, n: number) => 30 + ((j + 0.5) * (h - 44)) / n;

      for (let l = 0; l < 3; l++) {
        const a = layers[l], b = layers[l + 1];
        const lit = l < active;
        for (let i = 0; i < a.vals.length; i++) {
          for (let j = 0; j < b.vals.length; j += 2) {
            ctx.strokeStyle = withAlpha(f.color, lit ? 0.05 + 0.35 * a.vals[i] * b.vals[j] : 0.03);
            ctx.beginPath();
            ctx.moveTo(colX(l), nodeY(i, a.vals.length));
            ctx.lineTo(colX(l + 1), nodeY(j, b.vals.length));
            ctx.stroke();
          }
        }
      }
      layers.forEach((layer, l) => {
        ctx.fillStyle = withAlpha(f.color, l <= active ? 0.9 : 0.35);
        ctx.fillText(layer.name, colX(l) - 24, 16);
        layer.vals.forEach((v, j) => {
          const y = nodeY(j, layer.vals.length);
          const on = l <= active;
          const isPred = l === 3 && j === s.pred && active === 3;
          ctx.fillStyle = isPred ? "#ffffff" : withAlpha(f.color, on ? 0.25 + 0.75 * v : 0.12);
          ctx.beginPath();
          ctx.arc(colX(l), y, isPred ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
          if (l === 3) {
            ctx.fillStyle = isPred ? "#ffffff" : withAlpha(f.color, 0.5);
            ctx.fillText(String(j), colX(l) + 10, y + 3);
          }
        });
      });
      if (active === 3) {
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`sample ${sIdx} → class ${s.pred}`, w - 150, h - 6);
      }
    },
  };
};

export default create;
