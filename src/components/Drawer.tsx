"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="panel-title">
          <span className="lights">
            <i />
            <i />
            <i />
          </span>
          {title}
          <span style={{ flex: 1 }} />
          <button className="toggle" onClick={onClose}>
            esc ✕
          </button>
        </div>
        <div className="drawer-body scroll">{children}</div>
      </aside>
    </>
  );
}
