"use client";

import { getLanguage } from "@/lib/languages";
import { median } from "@/lib/stats";
import type { BattleConfig } from "@/lib/types";
import { fmtMB, fmtMs, liveMedian, type BattleState, type LiveFighter } from "./battleState";
import { VizCanvas, type FrameInput } from "./VizCanvas";

const STATUS: Record<LiveFighter["status"], string> = {
  queued: "QUEUED — waiting for exclusive CPU",
  probing: "STARTUP PROBES",
  booting: "BOOTING RUNTIME",
  generating: "GENERATING DATASET (UNTIMED)",
  warmup: "WARM-UP",
  running: "EXECUTING",
  done: "COMPLETE",
  error: "FAULT",
};

export interface ReplayView {
  started: boolean;
  runsDone: number;
  finished: boolean;
  place: 1 | 2 | null;
}

export function FighterPanel({
  fighter,
  slot,
  config,
  stage,
  frame,
  replay,
  clockRef,
  outliers,
  leading,
  finishMs,
}: {
  fighter: LiveFighter;
  slot: 0 | 1;
  config: BattleConfig;
  stage: BattleState["stage"];
  frame: React.RefObject<FrameInput>;
  replay: ReplayView | null;
  clockRef: React.RefObject<HTMLSpanElement | null>;
  outliers: number[];
  leading: boolean;
  finishMs: number | null;
}) {
  const meta = getLanguage(fighter.lang)!;
  const inReplay = stage === "replay" || stage === "complete";
  const samples = config.mode === "warm" ? config.runs : config.runs;
  const warm = config.mode === "warm" ? config.warmup : 0;
  const runsShown = inReplay && replay ? replay.runsDone : fighter.runs.length;

  let status = STATUS[fighter.status];
  if (fighter.status === "warmup") status = `WARM-UP ${Math.min(fighter.warmups.length + 1, warm)}/${warm}`;
  if (fighter.status === "running") status = config.mode === "cold" ? `COLD PROCESS ${Math.min(fighter.runs.length + 1, samples)}/${samples}` : `EXECUTING RUN ${Math.min(fighter.runs.length + 1, samples)}/${samples}`;
  if (inReplay && replay) status = !replay.started ? "READY" : replay.finished ? (replay.place === 1 ? "FINISHED ◆ FIRST" : "FINISHED") : `FIGHTING · RUN ${Math.min(replay.runsDone + 1, samples)}/${samples}`;

  const med = liveMedian(fighter);
  const startup = fighter.startupMs.length ? median(fighter.startupMs) : null;

  return (
    <article className={`panel fighter corners ${leading ? "leading" : ""}`} style={{ ["--c" as string]: meta.color } as React.CSSProperties} aria-label={`${meta.name} fighter`}>
      <div className="fighter-head">
        <div className="fighter-name">{meta.name}</div>
        <div className="fighter-node">NODE_0{slot + 1}</div>
      </div>
      <div className={`fighter-status ${fighter.status === "queued" && !inReplay ? "queued" : ""}`} aria-live="polite">
        {fighter.status !== "queued" && fighter.status !== "done" && !inReplay ? <span className="caret">{status}</span> : status}
      </div>
      <VizCanvas challenge={config.challenge} seed={config.seed} size={config.size} color={meta.color} frame={frame} />
      {inReplay && replay?.finished && (
        <div className="finish-stamp" aria-live="assertive">
          <div className="finish-word">FINISHED</div>
          <div className="finish-place">{replay.place === 1 ? "1ST" : "2ND"}</div>
          {finishMs !== null && <div className="finish-time">{fmtMs(finishMs)} total · {config.mode === "cold" ? "processes" : "runs"} ×{samples}</div>}
        </div>
      )}
      <div className="runs-strip" aria-label="runs">
        {Array.from({ length: warm }, (_, i) => (
          <span key={`w${i}`} className={`run-cell warm ${fighter.warmups.length > i ? "done" : ""}`} title={fighter.warmups[i] ? `warm-up ${i + 1}: ${fmtMs(fighter.warmups[i])}` : `warm-up ${i + 1}`} />
        ))}
        {Array.from({ length: samples }, (_, i) => (
          <span
            key={`r${i}`}
            className={`run-cell ${runsShown > i ? "done" : ""} ${inReplay && runsShown > i && outliers.includes(i) ? "outlier" : ""} ${!inReplay && fighter.active && fighter.runs.length === i && fighter.status === "running" ? "active" : ""}`}
            title={fighter.runs[i] ? `run ${i + 1}: ${fmtMs(fighter.runs[i])}` : `run ${i + 1}`}
          />
        ))}
      </div>
      <div className="fighter-metrics">
        {inReplay ? (
          <>
            <div>
              <div className="metric-label">clock (real time)</div>
              <div className="metric-value">
                <span ref={clockRef}>0.00ms</span>
              </div>
            </div>
            <div>
              <div className="metric-label">{config.mode === "cold" ? "processes" : "runs"}</div>
              <div className="metric-value">
                {replay?.runsDone ?? 0}
                <small>/{samples}</small>
              </div>
            </div>
            <div>
              <div className="metric-label">median</div>
              <div className="metric-value">{med !== null ? fmtMs(med) : "—"}</div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="metric-label">startup</div>
              <div className="metric-value">{startup !== null ? fmtMs(startup) : "—"}</div>
            </div>
            <div>
              <div className="metric-label">{fighter.status === "done" ? "median" : fighter.runs.length ? "median so far" : "median"}</div>
              <div className="metric-value">{med !== null ? fmtMs(med) : "—"}</div>
            </div>
            <div>
              <div className="metric-label">peak rss</div>
              <div className="metric-value">{fighter.peakRss ? fmtMB(fighter.peakRss) : "—"}</div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
