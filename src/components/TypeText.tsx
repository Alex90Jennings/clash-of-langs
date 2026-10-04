"use client";

import { useEffect, useState } from "react";
import { useSettings } from "./Settings";

export function TypeText({ text, speed = 38, delay = 0, caret = false, className }: { text: string; speed?: number; delay?: number; caret?: boolean; className?: string }) {
  const { reducedMotion } = useSettings();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i++;
      setN(i);
      if (i < text.length) timer = setTimeout(step, speed * (0.6 + Math.random() * 0.8));
    };
    timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [text, speed, delay, reducedMotion]);

  return (
    <span className={`${className ?? ""} ${caret ? "caret" : ""}`} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, n)}</span>
    </span>
  );
}

export function GlitchText({ text, className, as: Tag = "span" }: { text: string; className?: string; as?: "span" | "h1" | "h2" | "div" }) {
  return (
    <Tag className={`glitch ${className ?? ""}`} data-text={text}>
      {text}
    </Tag>
  );
}
