"use client";

import { getLanguage } from "@/lib/languages";
import { median } from "@/lib/stats";
import type { BattleConfig } from "@/lib/types";
import { fmtMB, fmtMs, type LiveFighter } from "./battleState";

const STATUS: Record<LiveFighter["status"], string> = {
  queued: "waiting for exclusive cpu",
  probing: "probing startup",
  booting: "booting runtime",
  generating: "generating dataset (untimed)",
  warmup: "warming up",
  running: "measuring",
  done: "ready to fight",
  error: "fault",
};

export function PrepView({ config, fighters, order }: { config: BattleConfig; fighters: Record<string, LiveFighter>; order: string[] | null }) {
  const total = (config.mode === "warm" ? config.warmup : 0) + config.runs;
  return (
    <div className="prep">
      {config.fighters.map((l) => {
        const f = fighters[l];
        const meta = getLanguage(l)!;
        const done = f.warmups.length + f.runs.length;
        const pct = f.status === "done" ? 100 : Math.round((done / total) * 100);
        const pos = order ? order.indexOf(l) + 1 : null;
        return (
          <div key={l} className={`panel prep-card corners ${f.active ? "active" : ""}`} style={{ ["--c" as string]: meta.color } as React.CSSProperties}>
            <div className="prep-glyph" aria-hidden="true">
              {meta.glyph}
            </div>
            <div className="fighter-name">{meta.name}</div>
            <div className="prep-status">
              {f.status === "done" ? "✓ " : f.status === "queued" ? "" : <span className="caret" />} {STATUS[f.status]}
              {pos ? <span className="muted"> · slot {pos}/2</span> : null}
            </div>
            <div className="prep-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${meta.name} progress`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="prep-stats">
              <span>
                {done}/{total} {config.mode === "warm" ? "runs" : "processes"}
              </span>
              <span>startup {f.startupMs.length ? fmtMs(median(f.startupMs)) : "—"}</span>
              <span>rss {f.peakRss ? fmtMB(f.peakRss) : "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
