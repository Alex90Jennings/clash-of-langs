"use client";

import { useState } from "react";
import { EXECUTABLE_LANGUAGES, getLanguage, SUPPORTED_LANGUAGES } from "@/lib/languages";
import { play } from "@/lib/sound";
import type { Capabilities, LanguageId } from "@/lib/types";

export type Availability = "online" | "offline" | "probing";

export function availability(lang: LanguageId, caps: Capabilities | null): { state: Availability; reason?: string } {
  if (caps === null) return { state: "probing" };
  if (!caps.online || !caps.environment) return { state: "offline", reason: caps.message ?? "arena offline" };
  const rt = caps.environment.runtimes[lang];
  return rt?.available ? { state: "online" } : { state: "offline", reason: rt?.reason ?? "runtime missing on this worker" };
}

const STATUS_TEXT: Record<Availability, string> = {
  online: "● READY",
  probing: "◌ PROBING",
  offline: "✕ OFFLINE",
};

type Pair = [LanguageId | null, LanguageId | null];

function Slot({ index, lang, active, onClick }: { index: 0 | 1; lang: LanguageId | null; active: boolean; onClick: () => void }) {
  const meta = lang ? getLanguage(lang) : undefined;
  return (
    <button
      type="button"
      className={`slot corners ${meta ? "filled flicker-in" : ""}`}
      style={meta ? ({ ["--fighter" as string]: meta.color } as React.CSSProperties) : undefined}
      aria-pressed={active}
      onClick={onClick}
    >
      <div className="slot-label">
        {index === 0 ? "player_01" : "player_02"} {active ? "· choosing" : "· click to change"}
      </div>
      {meta ? (
        <>
          <div className="slot-name">{meta.name}</div>
          <div className="slot-meta">
            <span className="tag">{meta.runtime}</span>
            <span className="tag">{meta.execution}</span>
            <span className="tag">{meta.memory}</span>
          </div>
          <div className="slot-glyph" aria-hidden="true">
            {meta.glyph}
          </div>
        </>
      ) : (
        <div className="slot-empty caret">SELECT FIGHTER</div>
      )}
    </button>
  );
}

export function FighterSelect({ fighters, onChange, caps }: { fighters: Pair; onChange: (f: Pair) => void; caps: Capabilities | null }) {
  const [active, setActive] = useState<0 | 1>(fighters[0] ? 1 : 0);
  const [hover, setHover] = useState<LanguageId | null>(null);

  const choose = (lang: LanguageId) => {
    const next: Pair = [...fighters];
    const other = active === 0 ? 1 : 0;
    if (next[other] === lang) next[other] = next[active];
    next[active] = lang;
    play("select");
    onChange(next);
    setActive(other);
  };

  const inspect = hover ? getLanguage(hover) : undefined;
  const inspectAvail = hover ? availability(hover, caps) : undefined;

  return (
    <>
      <div className="versus">
        <Slot key={fighters[0] ?? "empty-0"} index={0} lang={fighters[0]} active={active === 0} onClick={() => setActive(0)} />
        <div className="vs-mark" aria-hidden="true">
          VS
        </div>
        <Slot key={fighters[1] ?? "empty-1"} index={1} lang={fighters[1]} active={active === 1} onClick={() => setActive(1)} />
      </div>

      <section className="roster" aria-label="Fighter roster">
        <p className="section-label">
          <span className="prompt">ls ./fighters --for=player_0{active + 1}</span>
        </p>
        <div className="roster-grid" role="listbox" aria-label={`Choose fighter for player ${active + 1}`}>
          {SUPPORTED_LANGUAGES.map((l) => {
            const a = availability(l.id, caps);
            const selectable = a.state === "online" || a.state === "probing";
            return (
              <button
                key={l.id}
                type="button"
                role="option"
                className="cart"
                style={{ ["--c" as string]: l.color } as React.CSSProperties}
                aria-selected={fighters[active] === l.id}
                aria-pressed={fighters.includes(l.id)}
                disabled={!selectable}
                title={a.reason ?? `${l.name} — ${l.tagline}`}
                onMouseEnter={() => setHover(l.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(l.id)}
                onBlur={() => setHover(null)}
                onClick={() => choose(l.id)}
              >
                <div className="cart-glyph">{l.glyph}</div>
                <div className="cart-name">{l.name}</div>
                <div className={`cart-status ${a.state === "offline" ? "offline" : ""}`}>{STATUS_TEXT[a.state]}</div>
              </button>
            );
          })}
        </div>
        <div className="meta-line" aria-live="polite">
          {inspect ? (
            <>
              <span style={{ color: inspect.color }}>{inspect.name}</span>
              <span>
                runtime <b>{inspect.runtime}</b>
              </span>
              <span>
                exec <b>{inspect.execution}</b>
              </span>
              <span>
                typing <b>{inspect.typing}</b>
              </span>
              <span>
                memory <b>{inspect.memory}</b>
              </span>
              <span className={inspectAvail?.state === "online" ? "glow" : inspectAvail?.state === "offline" ? "red" : "amber"}>
                {inspectAvail?.state === "online"
                  ? inspect.tagline
                  : inspectAvail?.state === "offline"
                    ? `offline — ${inspectAvail.reason}`
                    : "probing…"}
              </span>
            </>
          ) : (
            <span>hover a fighter to inspect it_</span>
          )}
        </div>
      </section>
    </>
  );
}
