"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { CATEGORIES, CHALLENGES, getChallenge, type ChallengeCategory } from "@/lib/challenges";
import { defaultConfig } from "@/lib/config";
import { play } from "@/lib/sound";
import type { BattleConfig, BattleMode, ChallengeId, LanguageId } from "@/lib/types";
import { Drawer } from "../Drawer";
import { GlitchText, TypeText } from "../TypeText";
import { useCapabilities } from "../useCapabilities";
import { AdvancedConfig, ChallengeGrid, ModeToggle } from "./BattleSetup";
import { availability, FighterSelect } from "./FighterSelect";

export function SelectScreen({
  initial,
  onLaunch,
}: {
  initial?: BattleConfig;
  onLaunch: (c: BattleConfig) => void;
}) {
  const caps = useCapabilities();
  const [fighters, setFighters] = useState<[LanguageId | null, LanguageId | null]>(initial?.fighters ?? ["javascript", "python"]);
  const [challenge, setChallenge] = useState<ChallengeId>(initial?.challenge ?? "csv");
  const [mode, setMode] = useState<BattleMode>(initial?.mode ?? "warm");
  const [overrides, setOverrides] = useState<BattleConfig | null>(initial ?? null);
  const [advanced, setAdvanced] = useState(false);

  const ready = fighters[0] !== null && fighters[1] !== null;
  const pair = ready ? ([fighters[0], fighters[1]] as [LanguageId, LanguageId]) : null;
  const base = overrides && overrides.challenge === challenge && overrides.mode === mode ? overrides : null;
  const config: BattleConfig | null = pair ? (base ? { ...base, fighters: pair } : defaultConfig(challenge, pair, mode)) : null;
  const bothOnline = pair !== null && pair.every((l) => availability(l, caps).state === "online");
  const c = getChallenge(challenge)!;
  const category = c.category;
  const switchCategory = (next: ChallengeCategory) => {
    if (next === category) return;
    play("select");
    setChallenge(CHALLENGES.find((x) => x.category === next)!.id);
  };

  const launch = () => {
    if (!config || !bothOnline || !pair) return;
    play("start");
    onLaunch(config);
  };

  return (
    <div className="screen select-screen">
      <section className="hero">
        <h1 className="display hero-title">
          <GlitchText text={BRAND.name} />
          <span className="caret" />
        </h1>
        <p className="hero-sub">
          <TypeText text="SELECT YOUR FIGHTERS." delay={300} speed={50} />
        </p>
      </section>

      <FighterSelect fighters={fighters} caps={caps} onChange={setFighters} />

      <section aria-label="Battleground" style={{ display: "grid", gap: 6 }}>
        <div className="ground-head">
          <p className="section-label" style={{ flex: 1 }}>
            <TypeText text="CHOOSE YOUR BATTLEGROUND" caret speed={28} />
          </p>
          <div className="category-tabs" role="tablist" aria-label="Battleground type">
            {CATEGORIES.map((k) => (
              <button key={k.id} type="button" role="tab" aria-selected={category === k.id} onClick={() => switchCategory(k.id)}>
                {k.label}<span className="tab-count"> · {CHALLENGES.filter((x) => x.category === k.id).length}</span>
              </button>
            ))}
          </div>
        </div>
        <ChallengeGrid value={challenge} onChange={setChallenge} category={category} />
      </section>

      <section className="launch-bar" aria-label="Launch">
        <div className="left">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
          <button type="button" className="btn big" onClick={launch} disabled={!bothOnline}>
            INITIATE BATTLE
          </button>
          {caps && !caps.online && <span className="amber" style={{ fontSize: 10 }}>arena offline — {caps.message}</span>}
        </div>
        <div className="right" style={{ display: "grid", justifyItems: "end", gap: 4 }}>
          <div className="config-line">
            {c.sizeLabel(config?.size ?? c.defaultSize)}
            <br />
            {config ? `${config.mode === "warm" ? `${config.warmup} warm-up + ${config.runs} runs` : `${config.runs} cold processes`} · seed ${config.seed}` : ""}
          </div>
          <button type="button" className="btn ghost" onClick={() => setAdvanced(true)} disabled={!config}>
            $ advanced mode
          </button>
        </div>
      </section>

      {advanced && config && (
        <Drawer title="advanced mode — tty0" onClose={() => setAdvanced(false)}>
          <AdvancedConfig
            config={config}
            caps={caps}
            onChange={(next) => {
              setOverrides(next);
              if (next.challenge !== challenge) setChallenge(next.challenge);
            }}
          />
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button
              className="btn"
              disabled={!bothOnline}
              onClick={() => {
                setAdvanced(false);
                launch();
              }}
            >
              initiate with this config
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
