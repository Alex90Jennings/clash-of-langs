"use client";

import { useEffect, useRef } from "react";
import type { ChallengeId } from "@/lib/types";
import { loadVisualizer, VIZ_CAPTION } from "@/visualizers";
import type { VizFrame, Visualizer } from "@/visualizers/types";
import { useSettings } from "../Settings";

export type FrameInput = Omit<VizFrame, "t" | "dt" | "color" | "reduced">;

export function VizCanvas({ challenge, seed, size, color, frame, label }: { challenge: ChallengeId; seed: number; size: number; color: string; frame: React.RefObject<FrameInput>; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reducedMotion } = useSettings();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let viz: Visualizer | null = null;
    let raf = 0;
    let alive = true;
    let start = performance.now();
    let last = start;
    let cssW = 0;
    let cssH = 0;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 720 ? 1.5 : 2);
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      viz?.resize(cssW, cssH);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (reducedMotion && now - last < 120) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!viz) return;
      viz.draw(ctx, { ...frame.current, t: (now - start) / 1000, dt, color, reduced: reducedMotion });
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    void loadVisualizer[challenge]().then((m) => {
      if (!alive) return;
      viz = m.default(seed, size);
      fit();
      start = performance.now();
      last = start;
      raf = requestAnimationFrame(loop);
    });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [challenge, seed, size, color, frame, reducedMotion]);

  return (
    <div className="viz">
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viz-caption">{label ?? VIZ_CAPTION[challenge]}</span>
    </div>
  );
}

export function StreamDivider({ bias }: { bias: React.RefObject<number> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reducedMotion } = useSettings();
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const bits = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), v: 0.2 + Math.random() * 0.8, c: Math.random() < 0.5 ? "0" : "1" }));
    const color = getComputedStyle(document.documentElement).getPropertyValue("--green").trim() || "#00ff66";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.font = "11px ui-monospace, monospace";
      const b = bias.current ?? 0;
      for (const bit of bits) {
        bit.y = (bit.y + bit.v * 0.006) % 1;
        bit.x = Math.min(1, Math.max(0, bit.x + b * 0.004 * bit.v));
        if (bit.x <= 0 || bit.x >= 1) bit.x = 0.5;
        ctx.globalAlpha = 0.25 + bit.v * 0.6;
        ctx.fillStyle = color;
        ctx.fillText(bit.c, bit.x * (w - 8), bit.y * h);
      }
      ctx.globalAlpha = 1;
    };
    if (!reducedMotion) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bias, reducedMotion]);
  return (
    <div className="stream-divider" aria-hidden="true">
      <canvas ref={ref} />
      <span>&gt;&gt;&gt; DATA STREAM &lt;&lt;&lt;</span>
    </div>
  );
}
