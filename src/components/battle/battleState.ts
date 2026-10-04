import { getChallenge } from "@/lib/challenges";
import { getLanguage } from "@/lib/languages";
import { median } from "@/lib/stats";
import type { BattleConfig, BattleEvent, BattleResult, LanguageId } from "@/lib/types";

export type FighterStatus = "queued" | "probing" | "booting" | "generating" | "warmup" | "running" | "done" | "error";

export interface LiveFighter {
  lang: LanguageId;
  status: FighterStatus;
  active: boolean;
  startupMs: number[];
  warmups: number[];
  runs: number[];
  peakRss: number | null;
  inputHash: string | null;
  procsDone: number;
}

export interface LogLine {
  id: number;
  t: number | null;
  who: LanguageId | "sys" | "client";
  text: string;
  kind: "sys" | "fighter" | "err" | "cmd";
}

export interface BattleState {
  stage: "staging" | "countdown" | "live" | "replay" | "complete" | "results" | "error";
  config: BattleConfig;
  order: [LanguageId, LanguageId] | null;
  fighters: Record<string, LiveFighter>;
  log: LogLine[];
  result: BattleResult | null;
  error: string | null;
}

export type Action =
  | { type: "event"; event: BattleEvent }
  | { type: "stage"; stage: BattleState["stage"] }
  | { type: "client-log"; text: string; kind?: LogLine["kind"] }
  | { type: "reset"; config: BattleConfig };

let lineId = 0;

const fresh = (lang: LanguageId): LiveFighter => ({ lang, status: "queued", active: false, startupMs: [], warmups: [], runs: [], peakRss: null, inputHash: null, procsDone: 0 });

export function initialState(config: BattleConfig): BattleState {
  return {
    stage: "staging",
    config,
    order: null,
    fighters: Object.fromEntries(config.fighters.map((l) => [l, fresh(l)])),
    log: [],
    result: null,
    error: null,
  };
}

export const tag = (lang: LanguageId) => (getLanguage(lang)?.glyph ?? lang.slice(0, 2)).toUpperCase();
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : ms >= 100 ? `${ms.toFixed(0)}ms` : ms >= 10 ? `${ms.toFixed(1)}ms` : `${ms.toFixed(2)}ms`);
export const fmtMB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)}MB`;
export const fmtNum = (n: number) => n.toLocaleString("en-US");
const pad2 = (n: number) => String(n).padStart(2, "0");

function narrate(e: BattleEvent, s: BattleState): Omit<LogLine, "id"> | null {
  const c = getChallenge(s.config.challenge);
  switch (e.type) {
    case "battle:start":
      return { t: e.t, who: "sys", kind: "sys", text: `ARENA ONLINE · worker ${e.environment.workerId} · ${e.environment.cpuModel} · ${e.environment.cpuCount} cores · order ${e.order.map((l) => l.toUpperCase()).join(" → ")} (randomised)` };
    case "phase":
      return { t: e.t, who: e.lang, kind: "fighter", text: e.phase === "startup-probe" ? `startup probes: ${e.note}` : `measure: ${e.note}` };
    case "fighter:hello":
      return { t: e.t, who: e.lang, kind: "fighter", text: `${e.proc < 0 ? `probe ${-e.proc}` : `proc ${e.proc}`} · runtime up in ${fmtMs(e.startupMs)}` };
    case "fighter:ready":
      return e.proc < 0 ? null : { t: e.t, who: e.lang, kind: "fighter", text: `generated ${fmtNum(e.ops)} ${c?.unit ?? "ops"} in ${fmtMs(e.genMs)} (untimed) · input hash ${e.inputHash}` };
    case "fighter:warmup":
      return { t: e.t, who: e.lang, kind: "fighter", text: `warm-up ${pad2(e.i + 1)}/${pad2(s.config.warmup)} · ${fmtMs(e.ms)}` };
    case "fighter:run":
      return { t: e.t, who: e.lang, kind: "fighter", text: `${s.config.mode === "cold" ? `cold proc ${pad2(e.proc + 1)}` : `run ${pad2(e.i + 1)}/${pad2(s.config.runs)}`} · ${fmtMs(e.ms)} · check ${e.check}` };
    case "fighter:exit":
      return e.proc < 0 ? null : { t: e.t, who: e.lang, kind: "fighter", text: `process exited (${e.code}) · peak RSS ${e.peakRssBytes ? fmtMB(e.peakRssBytes) : "n/a"} · cpu ${e.cpuMs !== null ? fmtMs(e.cpuMs) : "n/a"}` };
    case "fighter:error":
      return { t: e.t, who: e.lang, kind: "err", text: e.message };
    case "battle:error":
      return { t: e.t, who: "sys", kind: "err", text: `BATTLE ABORTED: ${e.message}` };
    case "battle:result": {
      const v = e.result.verification;
      return {
        t: e.t,
        who: "sys",
        kind: v.inputsMatch && v.outputsMatch ? "sys" : "err",
        text: v.inputsMatch && v.outputsMatch ? `TASK COMPLETE · inputs identical (${v.inputHash}) · outputs identical (${v.outputHash})` : `VERIFICATION FAILED · inputs ${v.inputsMatch ? "match" : "DIFFER"} · outputs ${v.outputsMatch ? "match" : "DIFFER"} — no winner declared`,
      };
    }
    default:
      return null;
  }
}

function updateFighter(s: BattleState, e: BattleEvent): Record<string, LiveFighter> {
  if (!("lang" in e)) return s.fighters;
  const f = s.fighters[e.lang];
  if (!f) return s.fighters;
  const n: LiveFighter = { ...f };
  switch (e.type) {
    case "phase":
      n.status = e.phase === "startup-probe" ? "probing" : "booting";
      break;
    case "fighter:spawn":
      if (e.proc >= 0) {
        n.status = "booting";
        n.active = true;
      }
      break;
    case "fighter:hello":
      n.startupMs = [...f.startupMs, e.startupMs];
      if (e.proc >= 0) n.status = "generating";
      break;
    case "fighter:ready":
      if (e.proc >= 0) {
        n.inputHash = e.inputHash;
        n.status = s.config.warmup > 0 && s.config.mode === "warm" ? "warmup" : "running";
      }
      break;
    case "fighter:warmup":
      n.warmups = [...f.warmups, e.ms];
      if (e.i + 1 >= s.config.warmup) n.status = "running";
      break;
    case "fighter:run":
      n.runs = [...f.runs, e.ms];
      break;
    case "fighter:exit":
      if (e.proc >= 0) {
        n.procsDone = f.procsDone + 1;
        n.peakRss = Math.max(f.peakRss ?? 0, e.peakRssBytes ?? 0) || null;
        n.active = false;
        if (s.config.mode === "warm" || n.procsDone >= s.config.runs) n.status = "done";
      }
      break;
    case "fighter:error":
      n.status = "error";
      n.active = false;
      break;
  }
  return { ...s.fighters, [e.lang]: n };
}

export function reducer(s: BattleState, a: Action): BattleState {
  switch (a.type) {
    case "reset":
      return initialState(a.config);
    case "stage":
      return { ...s, stage: a.stage };
    case "client-log":
      return { ...s, log: [...s.log, { id: ++lineId, t: null, who: "client", kind: a.kind ?? "cmd", text: a.text }] };
    case "event": {
      const e = a.event;
      const line = narrate(e, s);
      const log = line ? [...s.log.slice(-400), { ...line, id: ++lineId }] : s.log;
      const base = { ...s, log, fighters: updateFighter(s, e) };
      if (e.type === "battle:start") return { ...base, order: e.order, stage: "live" };
      if (e.type === "battle:result") return { ...base, result: e.result, stage: "replay" };
      if (e.type === "battle:error") return { ...base, error: e.message, stage: "error" };
      return base;
    }
  }
}

export const liveMedian = (f: LiveFighter) => (f.runs.length ? median(f.runs) : null);

export function formatT(t: number | null): string {
  if (t === null) return "client  ";
  const m = Math.floor(t / 60000);
  const sec = (t % 60000) / 1000;
  return `${pad2(m)}:${sec.toFixed(3).padStart(6, "0")}`;
}
