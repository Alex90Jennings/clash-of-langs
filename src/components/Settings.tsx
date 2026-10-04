"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { play, setSoundEnabled } from "@/lib/sound";

type MotionPref = "system" | "full" | "reduced";

interface SettingsValue {
  sound: boolean;
  setSound(on: boolean): void;
  motionPref: MotionPref;
  setMotionPref(p: MotionPref): void;
  reducedMotion: boolean;
  redPill: boolean;
  setRedPill(on: boolean): void;
  rainLevel: number;
  setRainLevel(level: number): void;
  rainBurst: number;
  burstRain(): void;
  toast(message: ReactNode): void;
  toasts: { id: number; message: ReactNode }[];
}

const SettingsContext = createContext<SettingsValue | null>(null);

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [sound, setSoundState] = useState(false);
  const [motionPref, setMotionPrefState] = useState<MotionPref>("system");
  const [systemReduced, setSystemReduced] = useState(false);
  const [redPill, setRedPill] = useState(false);
  const [rainLevel, setRainLevel] = useState(1);
  const [rainBurst, setRainBurst] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; message: ReactNode }[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemReduced(e.matches);
    mq.addEventListener("change", on);
    const stored = read("clash:motion") as MotionPref | null;
    if (stored === "full" || stored === "reduced") setMotionPrefState(stored);
    return () => mq.removeEventListener("change", on);
  }, []);

  const reducedMotion = motionPref === "reduced" || (motionPref === "system" && systemReduced);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [reducedMotion]);
  useEffect(() => {
    if (redPill) document.documentElement.dataset.pill = "red";
    else delete document.documentElement.dataset.pill;
  }, [redPill]);

  const setSound = useCallback((on: boolean) => {
    setSoundEnabled(on);
    setSoundState(on);
    if (on) play("select");
  }, []);
  const setMotionPref = useCallback((p: MotionPref) => {
    setMotionPrefState(p);
    write("clash:motion", p);
  }, []);
  const toast = useCallback((message: ReactNode) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const burstRain = useCallback(() => setRainBurst((b) => b + 1), []);

  const value = useMemo(
    () => ({ sound, setSound, motionPref, setMotionPref, reducedMotion, redPill, setRedPill, rainLevel, setRainLevel, rainBurst, burstRain, toast, toasts }),
    [sound, setSound, motionPref, setMotionPref, reducedMotion, redPill, rainLevel, rainBurst, burstRain, toast, toasts],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error("useSettings outside SettingsProvider");
  return v;
}

export function Toasts() {
  const { toasts } = useSettings();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast flicker-in">
          {t.message}
        </div>
      ))}
    </div>
  );
}
