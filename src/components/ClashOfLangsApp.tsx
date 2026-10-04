"use client";

import { useCallback, useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { battlePath, configQuery } from "@/lib/config";
import type { BattleConfig } from "@/lib/types";
import { BattleScreen } from "./battle/BattleScreen";
import { SelectScreen } from "./arena/SelectScreen";
import { Drawer } from "./Drawer";
import { Hud, type PanelId } from "./Hud";
import { MethodologyContent } from "./MethodologyContent";

export function ClashOfLangsApp({
  initial,
  autostart = false,
  panel: initialPanel = null,
}: {
  initial?: BattleConfig;
  autostart?: boolean;
  panel?: PanelId | null;
}) {
  const [view, setView] = useState<"select" | "battle">(initial && autostart ? "battle" : "select");
  const [config, setConfig] = useState<BattleConfig | undefined>(initial);
  const [runId, setRunId] = useState(0);
  const [panel, setPanel] = useState<PanelId | null>(initialPanel);

  const launch = useCallback((c: BattleConfig) => {
    setConfig(c);
    setRunId((n) => n + 1);
    setView("battle");
    window.history.pushState({ view: "battle" }, "", `${battlePath(c)}${configQuery(c)}`);
  }, []);

  const exit = useCallback(() => {
    setView("select");
    window.history.pushState({ view: "select" }, "", "/");
  }, []);

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      if (!path.startsWith("/battle/")) setView("select");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (initialPanel) window.history.replaceState(null, "", "/");
  }, [initialPanel]);

  return (
    <div className="shell">
      <Hud panel={panel} onPanel={setPanel} onHome={exit} />
      <main className="stage">
        {view === "battle" && config ? (
          <BattleScreen key={runId} initial={config} onExit={exit} onLaunch={launch} />
        ) : (
          <SelectScreen initial={config} onLaunch={launch} />
        )}
      </main>
      <footer className="statusbar">
        <span>{BRAND.name} · every number is measured, not simulated · scoped to one workload, one implementation, one runtime, one machine, one run</span>
        <span className="credit">
          built by{" "}
          <a href={BRAND.linkedin} target="_blank" rel="noopener noreferrer">{BRAND.author}</a>
          {" · enjoying it? "}
          <a href={BRAND.repo} target="_blank" rel="noopener noreferrer">★ star the repo</a>
          {" · "}
          <a href={BRAND.contributing} target="_blank" rel="noopener noreferrer">contribute</a>
        </span>
        <span className="hint">try typing: sudo</span>
      </footer>
      {panel && (
        <Drawer title="methodology — how fights are judged" onClose={() => setPanel(null)}>
          <MethodologyContent />
        </Drawer>
      )}
    </div>
  );
}
