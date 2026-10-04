"use client";

import { CHALLENGES, getChallenge, type ChallengeCategory } from "@/lib/challenges";
import { LIMITS } from "@/lib/config";
import { getLanguage } from "@/lib/languages";
import { play } from "@/lib/sound";
import type { BattleConfig, BattleMode, Capabilities, ChallengeId } from "@/lib/types";

export const MODE_COPY: Record<BattleMode, { label: string; explain: string }> = {
  warm: {
    label: "WARM RUNTIME",
    explain: "One long-lived process. Warm-up runs let JITs optimise; measured runs are timed in-process. Steady-state throughput, like a server. Startup reported separately.",
  },
  cold: {
    label: "COLD START",
    explain: "A fresh process per sample: runtime boot + the first, unwarmed run. Like a CLI or serverless cold start. Ahead-of-time compilation is excluded for everyone.",
  },
};

export function ModeToggle({ mode, onChange }: { mode: BattleMode; onChange: (m: BattleMode) => void }) {
  return (
    <>
      <div className="segmented" role="group" aria-label="Measurement mode">
        {(["cold", "warm"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              play("select");
              onChange(m);
            }}
          >
            [ {MODE_COPY[m].label} ]
          </button>
        ))}
      </div>
      <div className="mode-explain">{MODE_COPY[mode].explain}</div>
    </>
  );
}

export function ChallengeGrid({
  value,
  onChange,
  category,
}: {
  value: ChallengeId | null;
  onChange: (c: ChallengeId) => void;
  category: ChallengeCategory;
}) {
  return (
    <div className="battlegrounds" role="radiogroup" aria-label="Battleground">
      {CHALLENGES.filter((c) => c.category === category).map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-pressed={value === c.id}
          className="ground rise-in"
          style={{ animationDelay: `${i * 60}ms` }}
          onClick={() => {
            play("select");
            onChange(c.id);
          }}
        >
          <div className="ground-code">{c.codename}</div>
          <div className="ground-name">{c.name}</div>
          <div className="ground-tag" title={c.stages.join(" → ")}>
            {c.tagline}
          </div>
        </button>
      ))}
    </div>
  );
}

export function AdvancedConfig({ config, onChange, caps }: { config: BattleConfig; onChange: (c: BattleConfig) => void; caps: Capabilities | null }) {
  const challenge = getChallenge(config.challenge)!;
  const runLimits = config.mode === "warm" ? LIMITS.runs : LIMITS.coldRuns;
  const set = (patch: Partial<BattleConfig>) => onChange({ ...config, ...patch });
  const num = (v: string) => parseInt(v.replace(/[^\d]/g, ""), 10) || 0;

  return (
    <div className="terminal">
      <div>
        <div className="prompt" style={{ marginBottom: 10 }}>
          configure battle
        </div>
        <div className="row">
          <label htmlFor="cfg-challenge">challenge</label>
          <select id="cfg-challenge" value={config.challenge} onChange={(e) => set({ challenge: e.target.value as ChallengeId, size: getChallenge(e.target.value)!.defaultSize })}>
            {CHALLENGES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.name}
              </option>
            ))}
          </select>
          <span className="hint" />
        </div>
        <div className="row">
          <label htmlFor="cfg-size">dataset_size</label>
          <input
            id="cfg-size"
            inputMode="numeric"
            value={config.size.toLocaleString("en-US")}
            onChange={(e) => set({ size: num(e.target.value) })}
            onBlur={() => set({ size: Math.min(challenge.maxSize, Math.max(challenge.minSize, config.size)) })}
          />
          <span className="hint">
            {challenge.presets.map((p) => (
              <button key={p} type="button" className="toggle" aria-pressed={config.size === p} onClick={() => set({ size: p })} style={{ marginLeft: 4 }}>
                {p >= 1e6 ? `${p / 1e6}M` : p >= 1e3 ? `${p / 1e3}k` : p}
              </button>
            ))}
          </span>
        </div>
        <div className="row">
          <label htmlFor="cfg-warmup">warmup_runs</label>
          <input
            id="cfg-warmup"
            inputMode="numeric"
            disabled={config.mode === "cold"}
            value={config.mode === "cold" ? "0 (cold start)" : config.warmup}
            onChange={(e) => set({ warmup: Math.min(LIMITS.warmup.max, num(e.target.value)) })}
          />
          <span className="hint">
            {LIMITS.warmup.min}–{LIMITS.warmup.max}
          </span>
        </div>
        <div className="row">
          <label htmlFor="cfg-runs">{config.mode === "cold" ? "processes" : "runs"}</label>
          <input id="cfg-runs" inputMode="numeric" value={config.runs} onChange={(e) => set({ runs: Math.max(runLimits.min, Math.min(runLimits.max, num(e.target.value))) })} />
          <span className="hint">
            {runLimits.min}–{runLimits.max}
            {config.runs < 5 ? " · <5 can't reach significance" : ""}
          </span>
        </div>
        <div className="row">
          <label htmlFor="cfg-seed">seed</label>
          <input id="cfg-seed" inputMode="numeric" value={config.seed} onChange={(e) => set({ seed: Math.max(1, Math.min(LIMITS.seed.max, num(e.target.value))) })} />
          <span className="hint">
            <button type="button" className="toggle" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 999_999) })}>
              reroll
            </button>
          </span>
        </div>
        <div className="row">
          <label>runtime/version</label>
          <span style={{ fontSize: 12 }}>
            {config.fighters.map((f) => {
              const rt = caps?.environment?.runtimes[f];
              return (
                <div key={f}>
                  <span style={{ color: getLanguage(f)?.color }}>{f}</span> <span className="muted">=</span> {rt?.version ?? (caps ? "offline" : "…")}
                </div>
              );
            })}
          </span>
          <span className="hint">pinned per worker</span>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Same seed ⇒ byte-identical inputs for both fighters (verified by input hash). Runtime versions are pinned by the worker image and shown with every result.
        </p>
      </div>
    </div>
  );
}
