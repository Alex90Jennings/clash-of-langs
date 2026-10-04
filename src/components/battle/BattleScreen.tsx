"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getChallenge } from "@/lib/challenges";
import { getLanguage } from "@/lib/languages";
import { play } from "@/lib/sound";
import type { BattleConfig, BattleEvent, BattleResult } from "@/lib/types";
import { availability } from "../arena/FighterSelect";
import { useSettings } from "../Settings";
import { GlitchText } from "../TypeText";
import { useCapabilities } from "../useCapabilities";
import { BattleLog } from "./BattleLog";
import { fmtMs, initialState, reducer, tag } from "./battleState";
import { FighterPanel, type ReplayView } from "./FighterPanel";
import { PrepView } from "./PrepView";
import { ResultsView } from "./ResultsView";
import { StreamDivider, type FrameInput } from "./VizCanvas";

const REPLAY_SECONDS = 7;
const COUNTDOWN = ["3", "2", "1", "FIGHT!"];

const idleFrame = (runCount: number): FrameInput => ({ mode: "idle", activity: 0, runIndex: 0, runCount, runProgress: 0 });

async function streamBattle(config: BattleConfig, signal: AbortSignal, onEvent: (e: BattleEvent) => void) {
  const res = await fetch("/api/battle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config), signal });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `arena responded ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of chunk.split("\n")) if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as BattleEvent);
    }
  }
}

function track(result: BattleResult, lang: string) {
  const samples = result.fighters[lang].samplesMs;
  const cum: number[] = [];
  samples.reduce((acc, v) => {
    cum.push(acc + v);
    return acc + v;
  }, 0);
  return { samples, cum, total: cum[cum.length - 1] ?? 0 };
}

export function BattleScreen({ initial, onExit, onLaunch }: { initial: BattleConfig; onExit: () => void; onLaunch: (c: BattleConfig) => void }) {
  const caps = useCapabilities();
  const { reducedMotion, setRainLevel } = useSettings();
  const [state, dispatch] = useReducer(reducer, initial, initialState);
  const [count, setCount] = useState<string | null>(null);
  const [replay, setReplay] = useState<[ReplayView, ReplayView] | null>(null);
  const [scale, setScale] = useState(1);
  const abortRef = useRef<AbortController | null>(null);
  const frames = [useRef<FrameInput>(idleFrame(initial.runs)), useRef<FrameInput>(idleFrame(initial.runs))];
  const clocks = [useRef<HTMLSpanElement | null>(null), useRef<HTMLSpanElement | null>(null)];
  const bias = useRef(0);
  const skipRef = useRef(false);
  const started = useRef(false);

  const config = state.config;
  const [la, lb] = config.fighters;
  const ma = getLanguage(la)!;
  const mb = getLanguage(lb)!;
  const challenge = getChallenge(config.challenge)!;
  const bothOnline = availability(la, caps).state === "online" && availability(lb, caps).state === "online";

  useEffect(() => {
    setRainLevel(state.stage === "results" ? 0.5 : 0.35);
    return () => setRainLevel(1);
  }, [state.stage, setRainLevel]);

  const begin = useCallback(
    async (cfg: BattleConfig) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      skipRef.current = false;
      setReplay(null);
      frames.forEach((f) => (f.current = idleFrame(cfg.runs)));
      dispatch({ type: "reset", config: cfg });
      dispatch({ type: "client-log", text: `./arena --challenge=${cfg.challenge} --fighters=${cfg.fighters.join(",")} --mode=${cfg.mode} --size=${cfg.size} --seed=${cfg.seed} --warmup=${cfg.warmup} --runs=${cfg.runs}` });
      play("start");
      dispatch({ type: "client-log", text: "loading the arena — measuring both fighters for real before the fight is shown" });
      try {
        await streamBattle(cfg, abort.signal, (event) => {
          if (event.type === "fighter:run") play("run");
          dispatch({ type: "event", event });
        });
      } catch (err) {
        if (abort.signal.aborted) return;
        dispatch({ type: "event", event: { type: "battle:error", t: 0, message: err instanceof Error ? err.message : String(err) } });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reducedMotion],
  );

  useEffect(() => {
    if (started.current || !caps) return;
    started.current = true;
    if (bothOnline) void begin(initial);
    else {
      const reason = caps.message ?? availability(la, caps).reason ?? availability(lb, caps).reason ?? "runtime offline";
      dispatch({ type: "event", event: { type: "battle:error", t: 0, message: `${tag(la)} ${availability(la, caps).state} · ${tag(lb)} ${availability(lb, caps).state} — ${reason}. Nothing is shown for fighters that did not run.` } });
    }
  }, [caps, bothOnline, begin, initial, la, lb]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (state.stage !== "replay" || !state.result) return;
    const result = state.result;
    if (reducedMotion || result.comparison.verdict === "invalid") {
      dispatch({ type: "stage", stage: "results" });
      return;
    }
    const tracks = config.fighters.map((l) => track(result, l));
    const maxTotal = Math.max(...tracks.map((t) => t.total), 0.001);
    const k = (REPLAY_SECONDS * 1000) / maxTotal;
    setScale(k);
    const weights = config.fighters.map((l) => result.fighters[l].phases?.map((p) => p.medianMs));
    let t0 = 0;
    let raf = 0;
    let cancelled = false;
    let finishedAt: number | null = null;
    let lastRuns = [-1, -1];
    let firstDone: number | null = null;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = skipRef.current ? Infinity : (now - t0) / k;
      const views = tracks.map((tr, i) => {
        let idx = tr.cum.findIndex((c) => c > real);
        if (idx === -1) idx = tr.samples.length;
        const prev = idx > 0 ? tr.cum[idx - 1] : 0;
        const finished = idx >= tr.samples.length;
        frames[i].current = {
          mode: finished ? "done" : "replay",
          activity: finished ? 0 : 1,
          runIndex: idx,
          runCount: tr.samples.length,
          runProgress: finished ? 1 : (real - prev) / tr.samples[idx],
          phaseWeights: weights[i],
        };
        const el = clocks[i].current;
        if (el) el.textContent = fmtMs(Math.min(real, tr.total));
        if (finished && firstDone === null) firstDone = i;
        return { runsDone: idx, finished };
      });
      bias.current = views[0].runsDone / tracks[0].samples.length - views[1].runsDone / tracks[1].samples.length > 0 ? -1 : 1;
      if (views[0].runsDone !== lastRuns[0] || views[1].runsDone !== lastRuns[1]) {
        lastRuns = [views[0].runsDone, views[1].runsDone];
        const places: (1 | 2 | null)[] = views.map((v, i) => (v.finished ? (firstDone === i ? 1 : 2) : null));
        setReplay([
          { started: true, ...views[0], place: places[0] },
          { started: true, ...views[1], place: places[1] },
        ]);
        if (views.some((v) => v.finished)) play("glitch");
      }
      if (views.every((v) => v.finished)) {
        finishedAt ??= now;
        if (now - finishedAt > (skipRef.current ? 0 : 900)) {
          cancelAnimationFrame(raf);
          play("complete");
          dispatch({ type: "stage", stage: "complete" });
          setTimeout(() => dispatch({ type: "stage", stage: "results" }), skipRef.current ? 0 : 1500);
        }
      }
    };
    setReplay([
      { started: false, runsDone: 0, finished: false, place: null },
      { started: false, runsDone: 0, finished: false, place: null },
    ]);
    void (async () => {
      for (const c of COUNTDOWN) {
        if (cancelled || skipRef.current) break;
        setCount(c);
        play("tick");
        await new Promise((r) => setTimeout(r, c === "FIGHT!" ? 600 : 650));
      }
      setCount(null);
      if (cancelled) return;
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      setCount(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, state.result, reducedMotion]);

  const rerun = (cfg: BattleConfig) => onLaunch(cfg);

  const result = state.result;
  const leader = replay && replay[0].place === 1 ? 0 : replay && replay[1].place === 1 ? 1 : null;

  const showResults = state.stage === "results" && result;

  return (
    <div className="screen">
      <div className="arena-head">
        <h1 className="display arena-title">
          <span style={{ color: ma.color }}>{ma.name.toUpperCase()}</span> <span className="glow">VS</span> <span style={{ color: mb.color }}>{mb.name.toUpperCase()}</span>
        </h1>
        <div className="arena-meta">
          <span>
            {challenge.codename} · {challenge.sizeLabel(config.size)} · {config.mode === "warm" ? "WARM" : "COLD"} · SEED {config.seed}
          </span>
          <button className="btn ghost" onClick={onExit}>
            ◂ arena
          </button>
        </div>
      </div>

      {showResults ? (
        <ResultsView result={result} onRerun={rerun} onExit={onExit} />
      ) : (
        <>
          {state.stage === "replay" || state.stage === "complete" ? (
          <div className="split">
            {config.fighters.map((l, i) => (
              <FighterPanel
                key={l}
                fighter={state.fighters[l]}
                slot={i as 0 | 1}
                config={config}
                stage={state.stage}
                frame={frames[i]}
                replay={replay ? replay[i] : null}
                clockRef={clocks[i]}
                outliers={result?.fighters[l].stats.outliers ?? []}
                leading={leader === i}
                finishMs={result ? result.fighters[l].samplesMs.reduce((a, b) => a + b, 0) : null}
              />
            )).flatMap((el, i) => (i === 0 ? [el, <StreamDivider key="div" bias={bias} />] : [el]))}
          </div>
          ) : (
            <PrepView config={config} fighters={state.fighters} order={state.order} />
          )}

          {state.stage === "replay" ? (
            <div className="replay-bar">
              <span>
                ◉ {count ? "fighters entering the ring" : "the fight"} · {scale >= 1 ? `×${scale.toFixed(scale >= 10 ? 0 : 1)} slower` : `×${(1 / scale).toFixed(1)} faster`} than real time · every block's duration is exactly proportional to a measured run
              </span>
              <button className="btn ghost" onClick={() => (skipRef.current = true)}>
                skip ▸▸
              </button>
            </div>
          ) : state.stage === "error" ? (
            <div className="replay-bar offline-banner error-banner">
              <span>BATTLE ABORTED — {state.error}</span>
              <span className="btn-row">
                {bothOnline && (
                  <button className="btn ghost" onClick={() => void begin(config)}>
                    retry
                  </button>
                )}
                <button className="btn ghost" onClick={onExit}>
                  back to arena
                </button>
              </span>
            </div>
          ) : (
            <div className="replay-bar calm">
              <span>loading the arena · fighters are measured one at a time so they never share a cpu · the fight plays once every duration is known</span>
            </div>
          )}

          {state.stage !== "replay" && state.stage !== "complete" && <BattleLog lines={state.log} grow />}
        </>
      )}

      {count && (
        <div className="overlay-banner" aria-live="assertive">
          <div key={count} className="countdown">
            {count}
          </div>
        </div>
      )}
      {state.stage === "complete" && (
        <div className="overlay-banner">
          <GlitchText as="div" className="display glow countdown" text={result?.comparison.verdict === "victory" ? "K.O." : "DRAW"} />
        </div>
      )}
    </div>
  );
}
