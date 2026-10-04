"use client";

import { useEffect, useRef } from "react";
import { getLanguage } from "@/lib/languages";
import { formatT, tag, type LogLine } from "./battleState";

export function BattleLog({ lines, grow = false }: { lines: LogLine[]; grow?: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <section className={`panel log ${grow ? "grow" : ""}`} aria-label="Battle log">
      <div className="panel-title">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        live feed — every line is a real engine event
      </div>
      <div className="log-body scroll" ref={body} role="log" aria-live="off">
        {lines.length === 0 && <div className="log-line muted">awaiting command_</div>}
        {lines.map((l) => {
          const who = l.who === "sys" || l.who === "client" ? null : l.who;
          return (
            <div key={l.id} className={`log-line log-${l.kind}`}>
              <span className="ts">[{formatT(l.t)}]</span>{" "}
              {who && (
                <span className="who" style={{ color: getLanguage(who)?.color }}>
                  [{tag(who)}]{" "}
                </span>
              )}
              {l.kind === "cmd" ? `> ${l.text}` : l.text}
            </div>
          );
        })}
      </div>
    </section>
  );
}
