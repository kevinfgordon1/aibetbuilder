import React, { useEffect, useRef, useState } from "react";
import { TIP_TEXT } from "./onboarding.js";

// Label text that shows a plain-English one-liner. Hover on desktop, tap/focus on mobile and keyboard.
export default function InfoTip({ k, text, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const body = text || TIP_TEXT[k] || "";
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!body) return children ?? null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline" }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}>
      <span role="button" tabIndex={0} aria-label={(typeof children === "string" ? children + ": " : "") + body} aria-expanded={open} data-info-tip={k || "tip"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } else if (e.key === "Escape") setOpen(false); }}
        style={{ cursor: "help", textDecoration: "underline dotted rgba(212,175,55,0.55)", textUnderlineOffset: 3, textDecorationThickness: 1 }}>{children}</span>
      {open && (
        <span role="tooltip" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", width: 240, background: "#141414", border: "1px solid #6b5a1e", borderRadius: 6, padding: "8px 10px", fontSize: 12, fontWeight: 500, lineHeight: 1.45, color: "#ece8df", zIndex: 50, textAlign: "left", whiteSpace: "normal", fontFamily: "'Inter', system-ui, sans-serif" }}>
          {body}
        </span>
      )}
    </span>
  );
}
