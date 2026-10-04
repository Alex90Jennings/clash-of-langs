"use client";

import { useMemo, useState } from "react";
import { getChallenge } from "@/lib/challenges";
import { battlePath, configQuery } from "@/lib/config";
import { explain } from "@/lib/insights";
import { getLanguage } from "@/lib/languages";
import type { BattleConfig, BattleResult, FighterResult, LanguageId } from "@/lib/types";
import { ResultCard, toCardData } from "../ResultCard";
import { useSettings } from "../Settings";
import { GlitchText } from "../TypeText";
import { fmtMB, fmtMs, fmtNum } from "./battleState";

const color = (l: LanguageId) => getLanguage(l)?.color ?? "#00ff66";
const nameOf = (l: LanguageId) => getLanguage(l)?.name ?? l;

function fmtRate(opsPerSec: number) {
  if (opsPerSec >= 1e9) return `${(opsPerSec / 1e9).toFixed(2)}G`;
  if (opsPerSec >= 1e6) return `${(opsPerSec / 1e6).toFixed(2)}M`;
  if (opsPerSec >= 1e3) return `${(opsPerSec / 1e3).toFixed(1)}k`;
  return opsPerSec.toFixed(0);
}

interface Row {
  label: string;
  get: (f: FighterResult) => number | null;
  show: (v: number) => string;
  better: "lower" | "higher" | "none";
}

function HeadToHead({ result }: { result: BattleResult }) {
  const [a, b] = result.config.fighters.map((l) => result.fighters[l]);
  const unit = getChallenge(result.config.challenge)!.unit;
  const rows: Row[] = [
    { label: result.config.mode === "warm" ? "median time" : "cold median", get: (f) => f.stats.median, show: fmtMs, better: "lower" },
    { label: `${unit}/sec`, get: (f) => f.opsPerSec, show: fmtRate, better: "higher" },
    { label: "peak memory", get: (f) => f.peakRssBytes, show: fmtMB, better: "lower" },
    { label: "startup", get: (f) => f.startup.median, show: fmtMs, better: "lower" },
    { label: "spread (cv)", get: (f) => f.stats.cv * 100, show: (v) => `${v.toFixed(1)}%`, better: "lower" },
    { label: "process cpu (all phases)", get: (f) => f.cpuMs, show: fmtMs, better: "none" },
  ];
  const winnerOf = (row: Row) => {
    const va = row.get(a);
    const vb = row.get(b);
    if (row.better === "none" || va === null || vb === null || va === vb) return null;
    return (row.better === "lower" ? va < vb : va > vb) ? 0 : 1;
  };
  const cell = (f: FighterResult, row: Row, idx: 0 | 1) => {
    const v = row.get(f);
    return (
      <td className={`val ${winnerOf(row) === idx ? "win" : ""}`} style={{ ["--c" as string]: color(f.lang) } as React.CSSProperties}>
        {v === null ? "n/a" : row.show(v)}
      </td>
    );
  };
  return (
    <div className="panel">
      <table className="h2h">
        <thead>
          <tr>
            {[a, b].map((f, i) => (
              <th key={f.lang} style={{ ["--c" as string]: color(f.lang), order: i } as React.CSSProperties}>
                <div className="fighter-name">{nameOf(f.lang)}</div>
                <div className="muted" style={{ fontSize: 10 }}>
                  {f.runtime.version}
                </div>
              </th>
            )).flatMap((el, i) => (i === 0 ? [el, <th key="mid" />] : [el]))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              {cell(a, r, 0)}
              <td className="row-label">{r.label}</td>
              {cell(b, r, 1)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreBoard({ result }: { result: BattleResult }) {
  return (
    <section>
      <p className="section-label" style={{ marginBottom: 8 }}>battle score — derived, not invented</p>
      <div className="score-table">
        {result.config.fighters.map((l) => (
          <div key={l} className="panel corners" style={{ ["--c" as string]: color(l) } as React.CSSProperties}>
            <div className="panel-body">
              <div className="fighter-name" style={{ fontSize: 34, marginBottom: 8 }}>
                {nameOf(l)}
              </div>
              {result.scores.map((s) => {
                const v = s.scores[l];
                return (
                  <div key={s.metric} className="score-row">
                    <span>{s.label}</span>
                    <span className="score-bar" aria-hidden="true">
                      <i style={{ width: `${(v ?? 0) * 10}%` }} />
                    </span>
                    <span className="score-num">{v === null ? "—" : v.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="formula">
        {result.scores.map((s) => (
          <div key={s.metric}>
            <span className="glow">{s.label}</span> = {s.formula}
          </div>
        ))}
        <div>
          The battle <span className="glow">WINNER</span> is decided by performance alone, and only when a two-sided Mann–Whitney U test gives p &lt; 0.05. Otherwise it is a draw. Scores are context, not a verdict on the language.
        </div>
      </div>
    </section>
  );
}

function RawResults({ result }: { result: BattleResult }) {
  const json = useMemo(() => JSON.stringify(result, null, 2), [result]);
  const { toast } = useSettings();
  const env = result.environment;
  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clash-of-langs-${result.config.fighters.join("-vs-")}-${result.config.challenge}-${result.config.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div style={{ display: "grid", gap: 16 }}>
        {result.config.fighters.map((l) => {
          const f = result.fighters[l];
          return (
            <div key={l}>
              <div style={{ color: color(l), marginBottom: 6 }}>
                {nameOf(l)} · <span className="muted">{f.runtime.command}</span>
              </div>
              <div className="table-wrap">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>sample</th>
                      <th>ms</th>
                      <th>Δ median</th>
                      <th>flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.warmupMs.map((v, i) => (
                      <tr key={`w${i}`} className="muted">
                        <td>warm-up {i + 1}</td>
                        <td>{v.toFixed(3)}</td>
                        <td>—</td>
                        <td>discarded</td>
                      </tr>
                    ))}
                    {f.samplesMs.map((v, i) => (
                      <tr key={i}>
                        <td>{result.config.mode === "cold" ? `process ${i + 1}` : `run ${i + 1}`}</td>
                        <td>{v.toFixed(3)}</td>
                        <td>{(((v - f.stats.median) / f.stats.median) * 100).toFixed(1)}%</td>
                        <td className={f.stats.outliers.includes(i) ? "amber" : ""}>{f.stats.outliers.includes(i) ? "outlier" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {f.phases && (
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  phase medians: {f.phases.map((p) => `${p.name} ${p.medianMs.toFixed(3)}ms`).join(" · ")}
                </div>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                n={f.stats.n} · median {f.stats.median.toFixed(3)} · mean {f.stats.mean.toFixed(3)} · min {f.stats.min.toFixed(3)} · max {f.stats.max.toFixed(3)} · σ {f.stats.stddev.toFixed(3)} · MAD {f.stats.mad.toFixed(3)} ·
                startup median {f.startup.median.toFixed(2)} (n={f.startup.n}) · peak RSS {f.peakRssBytes ?? "n/a"} B · baseline RSS {f.baselineRssBytes ?? "n/a"} B · cpu {f.cpuMs ?? "n/a"} ms · gen {f.genMs.toFixed(2)} ms (untimed) · input {f.inputHash} · output {f.checks.join(",")}
              </div>
            </div>
          );
        })}
        <div className="table-wrap">
          <table className="raw-table">
            <tbody>
              <tr><td>worker</td><td>{env.workerId}</td></tr>
              <tr><td>cpu</td><td>{env.cpuModel} × {env.cpuCount}</td></tr>
              <tr><td>os / arch</td><td>{env.os} / {env.arch}{env.containerised ? " · container" : ""}</td></tr>
              <tr><td>memory</td><td>{fmtMB(env.totalMemoryBytes)} · probe {env.memoryProbe}</td></tr>
              <tr><td>execution order</td><td>{result.order.join(" → ")} (randomised)</td></tr>
              <tr><td>battle duration</td><td>{fmtMs(result.durationMs)}</td></tr>
              <tr><td>p-value</td><td>{result.comparison.pValue?.toFixed(5) ?? "n/a"} (Mann–Whitney U, two-sided)</td></tr>
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(json).then(() => toast("> raw results copied"))}>
            copy json
          </button>
          <button className="btn ghost" onClick={download}>
            download json
          </button>
        </div>
        <pre className="json">{json}</pre>
      </div>
    </div>
  );
}

type Tab = "summary" | "why" | "scores" | "share" | "raw";
const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "summary" },
  { id: "why", label: "why?" },
  { id: "scores", label: "battle score" },
  { id: "share", label: "share" },
  { id: "raw", label: "raw results" },
];

export function ResultsView({ result, onRerun, onExit }: { result: BattleResult; onRerun: (c: BattleConfig) => void; onExit: () => void }) {
  const { toast } = useSettings();
  const [tab, setTab] = useState<Tab>("summary");
  const insight = useMemo(() => explain(result), [result]);
  const { comparison: cmp, verification: v, config } = result;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${battlePath(config)}${configQuery(config)}` : "";
  const copyLink = () => void navigator.clipboard.writeText(shareUrl).then(() => toast("> battle link copied — same seed, same inputs"));

  return (
    <section className="results flicker-in" aria-label="Battle results">
      <div className="results-banner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
          <GlitchText as="h2" className="display glow" text="BATTLE COMPLETE" />
          <div className="winner-line">
            {cmp.verdict === "victory" && (
              <>
                <span className="muted">winner:</span> <span style={{ color: color(cmp.winner!) }}>{nameOf(cmp.winner!).toUpperCase()}</span> <span className="muted">by {cmp.ratio.toFixed(2)}×</span>
              </>
            )}
            {cmp.verdict === "draw" && <span className="amber">DRAW — TOO CLOSE TO CALL</span>}
            {cmp.verdict === "invalid" && <span className="red">NO CONTEST — VERIFICATION FAILED</span>}
          </div>
        </div>
        <div className="badges">
          <span className={`tag ${v.inputsMatch ? "ok" : "bad"}`}>{v.inputsMatch ? `✓ inputs ${v.inputHash}` : "✕ inputs differ"}</span>
          <span className={`tag ${v.outputsMatch ? "ok" : "bad"}`}>{v.outputsMatch ? `✓ outputs ${v.outputHash}` : "✕ outputs differ"}</span>
          <span className="tag">{config.mode === "warm" ? `warm · ${config.warmup}+${config.runs}` : `cold · ${config.runs} procs`}</span>
          <span className={`tag ${cmp.significant ? "ok" : "warn"}`}>p {cmp.pValue === null ? "n/a" : cmp.pValue < 0.001 ? "< 0.001" : `= ${cmp.pValue.toFixed(3)}`}</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-panel" role="tabpanel">
        {tab === "summary" && (
          <div className="summary-grid">
            <HeadToHead result={result} />
            <div className="verdict-stack">
              <div className="panel verdict">
                <div className="panel-body">
                  <h3>PERFORMANCE</h3>
                  <p>{insight.performance}</p>
                </div>
              </div>
              <div className="panel verdict">
                <div className="panel-body">
                  <h3>MEMORY</h3>
                  <p>{insight.memory}</p>
                </div>
              </div>
              <div className="panel verdict">
                <div className="panel-body">
                  <h3>STARTUP</h3>
                  <p>{insight.startup}</p>
                  {insight.cpu && <p style={{ marginTop: 6 }}>{insight.cpu}</p>}
                </div>
              </div>
            </div>
          </div>
        )}
        {tab === "why" && (
          <div className="panel why">
            <div className="panel-body">
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Factors that plausibly contribute to this result — informed by how each implementation and runtime works, not proven by this run alone.
              </p>
              <ul>
                {insight.why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {tab === "scores" && <ScoreBoard result={result} />}
        {tab === "share" && (
          <div className="share-wrap">
            <ResultCard data={toCardData(result)} />
            <div style={{ display: "grid", gap: 8, alignContent: "center" }}>
              <button className="btn" onClick={copyLink}>
                copy battle link
              </button>
              <p className="muted" style={{ fontSize: 11, maxWidth: 260 }}>
                The link reproduces this battle exactly: same fighters, seed, size and run counts.
              </p>
            </div>
          </div>
        )}
        {tab === "raw" && <RawResults result={result} />}
      </div>

      <div className="results-actions">
        <p className="scope-note" style={{ margin: 0, flex: "1 1 380px" }}>
          {insight.scope}
        </p>
        <div className="btn-row">
          <button className="btn" onClick={() => onRerun({ ...config, seed: 1 + Math.floor(Math.random() * 999_999) })}>
            rematch · new seed
          </button>
          <button className="btn ghost" onClick={() => onRerun(config)}>
            run again
          </button>
          <button className="btn ghost" onClick={() => onRerun({ ...config, mode: config.mode === "warm" ? "cold" : "warm", warmup: config.mode === "warm" ? 0 : 3, runs: config.mode === "warm" ? 5 : 10 })}>
            → {config.mode === "warm" ? "cold start" : "warm runtime"}
          </button>
          <button className="btn ghost" onClick={copyLink}>
            share
          </button>
          <button className="btn ghost" onClick={onExit}>
            new battle
          </button>
        </div>
      </div>
    </section>
  );
}
