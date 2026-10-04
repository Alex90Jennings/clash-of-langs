"use client";

import { useEffect, useRef } from "react";
import { useSettings } from "./Settings";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789ABCDEF{}[]<>=+*/;:$#&|";
const WORDS = ["const", "fn", "def", "func", "impl", "=>", "async", "await", "return", "let", "mut", "nil", "0xFF", "sort()", "while", "match", "go", "&&", "yield", "new"];

interface Column {
  y: number;
  speed: number;
  word: string | null;
  wordIdx: number;
  active: boolean;
}

export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reducedMotion, rainLevel, redPill, rainBurst } = useSettings();
  const levelRef = useRef(rainLevel);
  const burstRef = useRef(0);

  useEffect(() => {
    levelRef.current = rainLevel;
  }, [rainLevel]);
  useEffect(() => {
    if (rainBurst) burstRef.current = performance.now() + 1600;
  }, [rainBurst]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const color = redPill ? "#ff3355" : "#00ff66";
    const headColor = redPill ? "#ffd6dd" : "#d8ffe6";
    let w = 0;
    let h = 0;
    let fs = 16;
    let cols: Column[] = [];
    let raf = 0;
    let last = 0;
    const mouse = { x: -9999, y: -9999 };

    const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
    const newColumn = (rows: number, scatter: boolean): Column => ({
      y: scatter ? Math.random() * rows : -Math.random() * 20,
      speed: 0.25 + Math.random() * 0.6,
      word: Math.random() < 0.07 ? WORDS[(Math.random() * WORDS.length) | 0] : null,
      wordIdx: 0,
      active: Math.random() < 0.72,
    });

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      fs = w < 720 ? 14 : 16;
      canvas.width = w;
      canvas.height = h;
      const rows = h / fs;
      cols = Array.from({ length: Math.ceil(w / fs) }, () => newColumn(rows, true));
      ctx.fillStyle = "#010302";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fs}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
    };

    const drawStatic = () => {
      ctx.fillStyle = "#010302";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (let i = 0; i < cols.length; i++) {
        if (!cols[i].active) continue;
        const len = 4 + ((Math.random() * 14) | 0);
        const start = (Math.random() * (h / fs)) | 0;
        for (let k = 0; k < len; k++) {
          ctx.globalAlpha = 0.08 + (k / len) * 0.25;
          ctx.fillText(pick(), i * fs, (start + k) * fs);
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const minDelta = w < 720 ? 42 : 33;
      if (now - last < minDelta) return;
      last = now;
      const level = levelRef.current;
      const burst = now < burstRef.current ? 3 : 1;

      ctx.fillStyle = `rgba(1, 3, 2, ${0.11 + (1 - level) * 0.08})`;
      ctx.fillRect(0, 0, w, h);
      const rows = h / fs;

      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.active && burst === 1) continue;
        if (Math.random() > level && burst === 1) continue;
        const x = i * fs;
        const yPx = c.y * fs;
        const dx = x - mouse.x;
        const dy = yPx - mouse.y;
        const near = dx * dx + dy * dy < 140 * 140;

        let ch: string;
        if (c.word) {
          ch = c.word[c.wordIdx % c.word.length];
          c.wordIdx++;
        } else ch = pick();

        ctx.fillStyle = color;
        ctx.globalAlpha = near ? 1 : 0.85;
        ctx.fillText(pick(), x, yPx - fs);
        ctx.fillStyle = near ? "#ffffff" : headColor;
        ctx.globalAlpha = 1;
        ctx.fillText(ch, x, yPx);

        c.y += c.speed * burst * (near ? 1.8 : 1);
        if (c.y > rows + Math.random() * 30) Object.assign(c, newColumn(rows, false));
      }
      ctx.globalAlpha = 1;
    };

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reducedMotion) drawStatic();
      else raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        start();
      }, 150);
    };

    resize();
    start();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion, redPill]);

  return <canvas ref={ref} className="rain-canvas" aria-hidden="true" style={{ ["--rain-opacity" as string]: String(0.18 + rainLevel * 0.4) }} />;
}
