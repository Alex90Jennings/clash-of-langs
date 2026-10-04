import { cycle, MONO, Rng, withAlpha, type CreateVisualizer } from "./types";

const STAGES = ["PARSE", "FILTER", "TRANSFORM", "SERIALISE"];
const PER_RUN = 28;

interface Packet {
  x: number;
  lane: number;
  keep: boolean;
  dead: number;
  label: string;
}

const create: CreateVisualizer = (seed) => {
  const rng = new Rng(seed);
  const COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"];
  const sample = Array.from({ length: PER_RUN }, (_, i) => {
    const country = COUNTRIES[rng.int(20)];
    rng.int(80);
    const score = rng.int(1000);
    const active = (rng.next() & 1) === 1;
    rng.int(10);
    rng.int(10);
    return { label: `{"id":${i},"${country}",${score}}`, keep: active && score >= 500 };
  });
  let packets: Packet[] = [];
  let spawned = 0;
  let lastRun = -1;
  let lastP = 0;
  let w = 0, h = 0;

  return {
    resize(nw, nh) {
      w = nw;
      h = nh;
    },
    draw(ctx, f) {
      const p = cycle(f, 1.8);
      if (f.runIndex !== lastRun || p < lastP) {
        spawned = 0;
        lastRun = f.runIndex;
      }
      lastP = p;
      const due = f.mode === "idle" ? 0 : Math.floor(p * PER_RUN);
      while (spawned < due) {
        const s = sample[spawned % PER_RUN];
        packets.push({ x: -10, lane: spawned % 5, keep: s.keep, dead: 0, label: s.label });
        spawned++;
      }

      ctx.clearRect(0, 0, w, h);
      const gate = (i: number) => (w * (i + 0.6)) / (STAGES.length + 0.4);
      ctx.font = `10px ${MONO}`;
      STAGES.forEach((s, i) => {
        const x = gate(i);
        ctx.strokeStyle = withAlpha(f.color, 0.35);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 22);
        ctx.lineTo(x, h - 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = withAlpha(f.color, 0.9);
        ctx.fillText(s, x - ctx.measureText(s).width / 2, 14);
      });

      const speed = (f.mode === "replay" ? 2.2 : 1.2) * w;
      const filterX = gate(1);
      packets = packets.filter((pk) => pk.x < w + 120 && pk.dead < 1);
      for (const pk of packets) {
        pk.x += speed * f.dt * (f.reduced ? 0.5 : 1);
        if (!pk.keep && pk.x > filterX) pk.dead += f.dt * 2.5;
        const y = 34 + pk.lane * ((h - 50) / 5);
        const fall = pk.dead * 30;
        ctx.globalAlpha = 1 - pk.dead;
        ctx.fillStyle = pk.dead > 0 ? "#ff4d6d" : pk.x > gate(2) ? "#ffffff" : f.color;
        ctx.fillText(pk.x > gate(2) && pk.keep ? pk.label.toUpperCase() : pk.label, pk.x - 60, y + fall);
      }
      ctx.globalAlpha = 1;
    },
  };
};

export default create;
