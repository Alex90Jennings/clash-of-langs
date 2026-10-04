"use client";

import { BRAND } from "@/lib/brand";
import { EXECUTABLE_LANGUAGES } from "@/lib/languages";
import { useSettings } from "./Settings";
import { useCapabilities } from "./useCapabilities";

export type PanelId = "methodology";

export function Hud({ panel, onPanel, onHome }: { panel: PanelId | null; onPanel: (p: PanelId | null) => void; onHome: () => void }) {
  const { sound, setSound, reducedMotion, setMotionPref } = useSettings();
  const caps = useCapabilities();
  const online = caps?.environment ? EXECUTABLE_LANGUAGES.filter((l) => caps.environment!.runtimes[l]?.available).length : 0;

  return (
    <header className="hud">
      <button className="hud-brand" onClick={onHome} aria-label={`${BRAND.name} — back to the arena`}>
        {BRAND.wordmark}
      </button>
      <nav className="hud-nav" aria-label="Panels">
        {(["methodology"] as const).map((p) => (
          <button key={p} aria-pressed={panel === p} onClick={() => onPanel(panel === p ? null : p)}>
            {p}
          </button>
        ))}
      </nav>
      <div className="hud-spacer" />
      <div className="hud-status" title={caps?.message ?? caps?.environment?.cpuModel ?? ""}>
        <span className={`dot ${caps === null ? "" : caps.online ? "on" : "off"}`} />
        <span className="label">
          {caps === null ? "probing worker…" : caps.online ? `worker ${caps.mode} · ${online}/${EXECUTABLE_LANGUAGES.length} runtimes online` : "arena offline"}
        </span>
      </div>
      <button className="toggle" aria-pressed={!reducedMotion} onClick={() => setMotionPref(reducedMotion ? "full" : "reduced")}>
        motion: {reducedMotion ? "low" : "full"}
      </button>
      <button className="toggle" aria-pressed={sound} onClick={() => setSound(!sound)}>
        [sound: {sound ? "on" : "off"}]
      </button>
    </header>
  );
}
