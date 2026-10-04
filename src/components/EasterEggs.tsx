"use client";

import { useEffect } from "react";
import { play } from "@/lib/sound";
import { useSettings } from "./Settings";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function EasterEggs() {
  const { toast, setRedPill, redPill, burstRain } = useSettings();

  useEffect(() => {
    let typed = "";
    let konami = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;

      konami = e.key === KONAMI[konami] || e.key.toLowerCase() === KONAMI[konami] ? konami + 1 : e.key === KONAMI[0] ? 1 : 0;
      if (konami === KONAMI.length) {
        konami = 0;
        setRedPill(!redPill);
        burstRain();
        play("glitch");
        toast(redPill ? "> blue pill taken. the story ends, you wake up in your bed." : "> red pill taken. welcome to the desert of the real.");
        return;
      }

      if (e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-16);
      play("key");
      if (typed.endsWith("sudo")) {
        typed = "";
        play("glitch");
        toast(
          <>
            <span className="red">[sudo]</span> neo is not in the sudoers file. This incident will be reported.
          </>,
        );
      } else if (typed.endsWith("matrix") || typed.endsWith("neo")) {
        typed = "";
        burstRain();
        toast("> wake up, neo… the benchmarks have you.");
      } else if (typed.endsWith("rm -rf")) {
        typed = "";
        document.body.classList.add("glitch-burst");
        setTimeout(() => document.body.classList.remove("glitch-burst"), 600);
        toast("> nice try. the arena is read-only — only predefined benchmarks execute here.");
      } else if (typed.endsWith("spoon")) {
        typed = "";
        toast("> there is no spoon. there is only the median.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, setRedPill, redPill, burstRain]);

  return null;
}
