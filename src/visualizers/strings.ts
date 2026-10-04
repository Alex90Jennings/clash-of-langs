import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const LINES = 60;

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"];
  const RES = ["users", "orders", "items", "auth", "search"];
  const STATUS = [200, 200, 200, 201, 404, 500];
  const lines = Array.from({ length: LINES }, (_, i) => {
    const level = LEVELS[rng.int(4)];
    const user = rng.int(1000);
    const res = RES[rng.int(5)];
    const id = rng.int(10000);
    const status = STATUS[rng.int(6)];
    const latency = rng.int(2000);
    return { head: `ts=${1700000000 + i} level=${level} user=u${user} path=/api/${res}/${id} `, match: `status=${status} latency=${latency}ms`, bad: status >= 500, error: level === "ERROR" };
  });
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 2.4);
      const lh = 15;
      const scanY = h * 0.55;
      const offset = p * LINES * lh;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `11px ${MONO}`;
      const first = Math.floor((offset - scanY) / lh) - 1;
      for (let k = first; k < first + Math.ceil(h / lh) + 2; k++) {
        const idx = ((k % LINES) + LINES) % LINES;
        const y = scanY + k * lh - offset;
        if (y < -lh || y > h + lh) continue;
        const line = lines[idx];
        const scanned = y < scanY;
        ctx.fillStyle = withAlpha(f.color, scanned ? 0.3 : 0.55);
        ctx.fillText(line.head, 8, y);
        const hx = 8 + ctx.measureText(line.head).width;
        if (scanned && f.mode !== "idle") {
          ctx.fillStyle = line.bad ? "#ff4d6d" : "#ffffff";
          ctx.fillRect(hx - 2, y - 10, ctx.measureText(line.match).width + 4, 13);
          ctx.fillStyle = "#000";
        } else ctx.fillStyle = withAlpha(f.color, 0.55);
        ctx.fillText(line.match, hx, y);
      }
      if (f.mode !== "idle") {
        const g = ctx.createLinearGradient(0, scanY - 18, 0, scanY + 4);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, withAlpha(f.color, 0.35));
        ctx.fillStyle = g;
        ctx.fillRect(0, scanY - 18, w, 22);
        ctx.fillStyle = f.color;
        ctx.fillRect(0, scanY + 3, w, 1);
      }
      ctx.fillStyle = withAlpha(f.color, 0.9);
      ctx.fillText("/status=(\\d{3}) latency=(\\d+)ms/", w - 230, 14);
    },
  };
};

export default create;
