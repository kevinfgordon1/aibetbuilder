import React, { useEffect, useRef, useState } from "react";
import { TIP_TEXT } from "./onboarding.js";

// Small "?" with a plain-English one-liner. Hover on desktop, tap on mobile.
export default function InfoTip({ k, text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const body = text || TIP_TEXT[k] || "";
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!body) return null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}>
      <button type="button" aria-label={"What is this? " + body} aria-expanded={open} data-info-tip={k || "tip"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid rgba(212,175,55,0.6)", background: "transparent", color: "#d4af37", fontSize: 10, fontWeight: 700, lineHeight: "14px", padding: 0, cursor: "pointer" }}>?</button>
      {open && (
        <span role="tooltip" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", width: 240, background: "#141414", border: "1px solid #6b5a1e", borderRadius: 6, padding: "8px 10px", fontSize: 12, fontWeight: 500, lineHeight: 1.45, color: "#ece8df", zIndex: 50, textAlign: "left", whiteSpace: "normal", fontFamily: "'Inter', system-ui, sans-serif" }}>
          {body}
        </span>
      )}
    </span>
  );
}
