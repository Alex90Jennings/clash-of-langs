"use client";

import { useEffect, useState } from "react";
import type { Capabilities } from "@/lib/types";

let inflight: Promise<Capabilities> | null = null;

function load(force = false): Promise<Capabilities> {
  if (!inflight || force) {
    inflight = fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => r.json() as Promise<Capabilities>)
      .catch(() => ({ online: false, mode: "offline", environment: null, message: "capabilities endpoint unreachable" }) as Capabilities);
  }
  return inflight;
}

export function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((c) => alive && setCaps(c));
    return () => {
      alive = false;
    };
  }, []);
  return caps;
}
