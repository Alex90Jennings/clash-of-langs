export interface VizFrame {
  t: number;
  dt: number;
  mode: "idle" | "live" | "replay" | "done";
  activity: number;
  runIndex: number;
  runCount: number;
  runProgress: number;
  phaseWeights?: number[];
  color: string;
  reduced: boolean;
}

export interface Visualizer {
  resize(w: number, h: number): void;
  draw(ctx: CanvasRenderingContext2D, f: VizFrame): void;
}

export type CreateVisualizer = (seed: number, size: number) => Visualizer;

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }
  int(n: number): number {
    return this.next() % n;
  }
}

export const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function cycle(f: VizFrame, period = 1.4): number {
  if (f.mode === "replay") return f.runProgress;
  if (f.mode === "done") return 1;
  if (f.mode === "live") return (f.t / period) % 1;
  return 0;
}
