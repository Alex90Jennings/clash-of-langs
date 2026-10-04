import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"];
const SORTED_REGIONS = REGIONS.slice().sort();
const SAMPLE = 600;
const STAGES = ["SPLIT", "PARSE", "AGGREGATE", "WRITE REPORT"];
const pad2 = (v: number) => (v < 10 ? "0" + v : String(v));

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const rows = Array.from({ length: SAMPLE }, (_, i) => {
    const month = 1 + rng.int(12);
    const day = 1 + rng.int(28);
    const region = rng.int(8);
    const sku = rng.int(1000);
    const qty = 1 + rng.int(20);
    const price = 99 + rng.int(99901);
    const discount = 5 * rng.int(5);
    const revenue = Math.floor((qty * price * (100 - discount)) / 100);
    return { month, region, revenue, line: `${i},2026-${pad2(month)}-${pad2(day)},${REGIONS[region]},SKU-${sku},${qty},${price},${discount}` };
  });
  const finalCells = new Array(96).fill(0);
  rows.forEach((r) => (finalCells[SORTED_REGIONS.indexOf(REGIONS[r.region]) * 12 + r.month - 1] += r.revenue));
  const maxCell = Math.max(...finalCells);
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 2.2);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `10px ${MONO}`;
      const stage = f.mode === "idle" ? -1 : p < 0.15 ? 0 : p < 0.45 ? 1 : p < 0.85 ? 2 : 3;
      STAGES.forEach((s, i) => {
        ctx.fillStyle = i === stage ? "#ffffff" : withAlpha(f.color, i < stage ? 0.8 : 0.35);
        ctx.fillText((i ? "→ " : "") + s, 8 + i * ((w - 16) / 4), 14);
      });

      const leftW = Math.max(120, w * 0.46);
      const parsed = f.mode === "idle" ? 0 : Math.floor(Math.min(1, p / 0.85) * SAMPLE);
      const lineH = 12;
      const visible = Math.max(1, Math.floor((h - 34) / lineH));
      const first = Math.max(0, Math.min(SAMPLE - visible, parsed - Math.floor(visible / 2)));
      ctx.save();
      ctx.beginPath();
      ctx.rect(4, 22, leftW - 8, h - 26);
      ctx.clip();
      ctx.font = `${Math.min(10, leftW / 34)}px ${MONO}`;
      for (let k = 0; k < visible && first + k < SAMPLE; k++) {
        const i = first + k;
        const done = i < parsed;
        const hot = i === parsed;
        ctx.fillStyle = hot ? "#ffffff" : withAlpha(f.color, done ? 0.75 : 0.25);
        const text = stage >= 1 && done ? rows[i].line.replaceAll(",", " │ ") : rows[i].line;
        ctx.fillText(text, 8, 34 + k * lineH);
      }
      ctx.restore();

      const cells = new Array(96).fill(0);
      for (let i = 0; i < parsed; i++) cells[SORTED_REGIONS.indexOf(REGIONS[rows[i].region]) * 12 + rows[i].month - 1] += rows[i].revenue;
      const gx = leftW + 46;
      const cw = (w - gx - 8) / 12;
      const ch = (h - 40) / 8;
      ctx.font = `${Math.min(9, ch * 0.7)}px ${MONO}`;
      for (let r = 0; r < 8; r++) {
        ctx.fillStyle = withAlpha(f.color, 0.7);
        ctx.fillText(SORTED_REGIONS[r], leftW + 2, 30 + r * ch + ch * 0.65);
        for (let m = 0; m < 12; m++) {
          const v = cells[r * 12 + m] / maxCell;
          ctx.fillStyle = stage === 3 ? withAlpha(f.color, 0.15 + 0.85 * v) : withAlpha(f.color, 0.06 + 0.8 * v);
          ctx.fillRect(gx + m * cw + 1, 30 + r * ch + 1, cw - 2, ch - 2);
        }
      }
      ctx.fillStyle = withAlpha(f.color, 0.6);
      for (let m = 0; m < 12; m += 3) ctx.fillText(pad2(m + 1), gx + m * cw + 2, h - 4);
    },
  };
};

export default create;
