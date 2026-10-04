import { cycle, MONO, withAlpha, type CreateVisualizer } from "./types";

const COLS = 20;
const ROWS = 10;
const LIMIT = COLS * ROWS + 1;

const create: CreateVisualizer = () => {
  const marks: { n: number; p: number }[] = [];
  const composite = new Uint8Array(LIMIT + 1);
  for (let p = 2; p * p <= LIMIT; p++) {
    if (composite[p]) continue;
    for (let j = p * p; j <= LIMIT; j += p) {
      if (!composite[j]) marks.push({ n: j, p });
      composite[j] = 1;
    }
  }
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 1.6);
      const k = f.mode === "idle" ? 0 : Math.floor(p * marks.length);
      const crossed = new Uint8Array(LIMIT + 1);
      for (let i = 0; i < k; i++) crossed[marks[i].n] = 1;
      const current = k > 0 && k < marks.length ? marks[k - 1] : null;

      ctx.clearRect(0, 0, w, h);
      const top = 26;
      const cw = (w - 16) / COLS;
      const ch = (h - top - 8) / ROWS;
      ctx.font = `${Math.min(11, cw * 0.38)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < COLS * ROWS; i++) {
        const n = i + 2;
        const x = 8 + (i % COLS) * cw;
        const y = top + Math.floor(i / COLS) * ch;
        const isCurrent = current?.n === n;
        const isPrimeSoFar = !crossed[n];
        const confirmed = isPrimeSoFar && (k >= marks.length || (current !== null && n <= current.p));
        if (isCurrent) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        } else if (confirmed) {
          ctx.fillStyle = withAlpha(f.color, 0.85);
          ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        } else if (current && n % current.p === 0 && !crossed[n]) {
          ctx.strokeStyle = withAlpha(f.color, 0.6);
          ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
        }
        ctx.fillStyle = isCurrent || confirmed ? "#000" : withAlpha(f.color, crossed[n] ? 0.18 : 0.6);
        ctx.fillText(String(n), x + cw / 2, y + ch / 2 + 1);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const load = f.mode === "idle" ? 0 : f.mode === "done" ? 0.15 : 0.82 + 0.18 * Math.sin(f.t * 23) * Math.sin(f.t * 7);
      ctx.fillStyle = withAlpha(f.color, 0.2);
      ctx.fillRect(8, 8, w - 16, 8);
      ctx.fillStyle = f.color;
      ctx.fillRect(8, 8, (w - 16) * load, 8);
      ctx.font = `9px ${MONO}`;
      ctx.fillStyle = "#000";
      ctx.fillText(current ? `CORE · marking multiples of ${current.p}` : "CORE", 12, 15);
    },
  };
};

export default create;
