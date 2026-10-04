import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const PHASES = ["GRAYSCALE", "BLUR", "SOBEL", "HISTOGRAM"];

const create: CreateVisualizer = (seed, size) => {
  const n = Math.max(1, size);
  const s = Math.min(64, n);
  const rng = new Rng(seed);
  const rgb = new Uint8ClampedArray(s * s * 3);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < n; x++) {
      const r = (x + y + rng.int(64)) % 256;
      const g = (2 * x + rng.int(64)) % 256;
      const b = (2 * y + rng.int(64)) % 256;
      if (x < s) rgb.set([r, g, b], (y * s + x) * 3);
    }
  }
  const cl = (v: number) => (v < 0 ? 0 : v >= s ? s - 1 : v);
  const at = (a: Uint8ClampedArray, x: number, y: number) => a[cl(y) * s + cl(x)];
  const gray = new Uint8ClampedArray(s * s);
  for (let i = 0; i < s * s; i++) gray[i] = (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) >> 8;
  const blur = new Uint8ClampedArray(s * s);
  const mag = new Uint8ClampedArray(s * s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++)
      blur[y * s + x] = (at(gray, x - 1, y - 1) + 2 * at(gray, x, y - 1) + at(gray, x + 1, y - 1) + 2 * at(gray, x - 1, y) + 4 * at(gray, x, y) + 2 * at(gray, x + 1, y) + at(gray, x - 1, y + 1) + 2 * at(gray, x, y + 1) + at(gray, x + 1, y + 1)) >> 4;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const gx = at(blur, x + 1, y - 1) + 2 * at(blur, x + 1, y) + at(blur, x + 1, y + 1) - (at(blur, x - 1, y - 1) + 2 * at(blur, x - 1, y) + at(blur, x - 1, y + 1));
      const gy = at(blur, x - 1, y + 1) + 2 * at(blur, x, y + 1) + at(blur, x + 1, y + 1) - (at(blur, x - 1, y - 1) + 2 * at(blur, x, y - 1) + at(blur, x + 1, y - 1));
      mag[y * s + x] = Math.min(255, Math.abs(gx) + Math.abs(gy));
    }
  const hist = new Array(32).fill(0);
  for (let i = 0; i < s * s; i++) hist[mag[i] >> 3]++;
  const maxBin = Math.max(...hist);

  const toCanvas = (fill: (img: Uint8ClampedArray, i: number) => void) => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const cx = c.getContext("2d")!;
    const img = cx.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      fill(img.data, i);
      img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return c;
  };
  const grayFill = (a: Uint8ClampedArray) => (d: Uint8ClampedArray, i: number) => d.set([a[i], a[i], a[i]], i * 4);
  const panels = [
    toCanvas((d, i) => d.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], i * 4)),
    toCanvas(grayFill(gray)),
    toCanvas(grayFill(blur)),
    toCanvas(grayFill(mag)),
  ];
  const labels = ["RGB", "GRAY", "BLUR", "SOBEL"];
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
      const idle = f.mode === "idle";
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      let x0 = 8;
      PHASES.forEach((name, i) => {
        const pw = ((w - 16) * weights[i]) / total;
        ctx.fillStyle = withAlpha(f.color, idle ? 0.15 : i < phase ? 0.6 : i === phase ? 0.9 : 0.15);
        ctx.fillRect(x0, 6, Math.max(1, pw - 2), 6);
        if (pw > 70) {
          ctx.fillStyle = i === phase && !idle ? "#ffffff" : withAlpha(f.color, 0.6);
          ctx.fillText(name, x0, 24);
        }
        x0 += pw;
      });

      const histW = Math.min(160, w * 0.22);
      const rowSide = Math.min((w - histW - 40) / 4 - 8, h - 50);
      const gridSide = Math.min((w - histW - 40) / 2 - 8, (h - 74) / 2);
      const grid = gridSide > rowSide * 1.3;
      const side = Math.max(16, grid ? gridSide : rowSide);
      ctx.imageSmoothingEnabled = false;
      panels.forEach((panel, i) => {
        const x = 8 + (grid ? i % 2 : i) * (side + 8);
        const y = 34 + (grid ? Math.floor(i / 2) * (side + 22) : 0);
        const ready = idle || i <= phase;
        ctx.globalAlpha = ready ? 1 : 0.15;
        if (panel) ctx.drawImage(panel, x, y, side, side);
        ctx.globalAlpha = 1;
        if (!idle && i === phase + 1 && phase < 3) {
          ctx.fillStyle = withAlpha(f.color, 0.25);
          ctx.fillRect(x, y, side, side * local);
        }
        ctx.strokeStyle = withAlpha(f.color, i === phase + 1 && !idle ? 0.9 : 0.3);
        ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
        ctx.fillStyle = withAlpha(f.color, 0.8);
        ctx.fillText(labels[i], x, y + side + 12);
      });

      const hx = w - histW - 8;
      const hy = 34;
      const hh = grid ? side * 2 + 22 : side;
      const showHist = idle || phase === 3;
      const bw = histW / hist.length;
      hist.forEach((v, i) => {
        const bh = (v / maxBin) * hh * (showHist ? (idle ? 1 : local) : 0);
        ctx.fillStyle = i >= 16 ? "#ffffff" : withAlpha(f.color, 0.75);
        ctx.fillRect(hx + i * bw, hy + hh - bh, Math.max(1, bw - 1), bh);
      });
      ctx.strokeStyle = withAlpha(f.color, 0.3);
      ctx.strokeRect(hx + 0.5, hy + 0.5, histW - 1, hh - 1);
      ctx.fillStyle = withAlpha(f.color, 0.8);
      ctx.fillText("EDGE HISTOGRAM", hx, hy + hh + 12);
    },
  };
};

export default create;
