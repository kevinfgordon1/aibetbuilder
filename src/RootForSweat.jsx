// Sweat meter: semicircle gauge, center = pregame expected profit, needle = live expected profit now.
import React from "react";
import { gaugeFrac } from "./rootForSweat";
import { quantileOf } from "./rootForSimple";

const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const pt = (cx, cy, r, f) => { const a = Math.PI * (1 - f); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
const arc = (cx, cy, r, f0, f1) => { const [x0, y0] = pt(cx, cy, r, f0); const [x1, y1] = pt(cx, cy, r, f1); return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`; };

export default function SweatMeter({ d }) {
  const s = d && d.sweat; if (!s) return null;
  const now = Number.isFinite(Number(s.now)) ? Number(s.now) : Number(d.ev); const started = s.started === true; const base = Number.isFinite(s.baseline) ? s.baseline : null;
  const center = started && base != null ? base : now;
  const lo = Math.min(d.worst && Number.isFinite(d.worst.pnl) ? d.worst.pnl : center - 1, center - 1);
  const hi = Math.max(d.hist ? quantileOf(d.hist, 0.95) : center + 1, center + 1, now + 1);
  const f = started && base != null ? gaugeFrac(now, lo, base, hi) : 0.5;
  const diff = started && base != null ? now - base : 0;
  const mood = !started ? "Games haven't started yet" : base == null ? "No pregame number saved this week" : diff >= 0 ? "Cruising" : "Sweating";
  const W = 260, cx = 130, cy = 120, r = 100; const [nx, ny] = pt(cx, cy, r - 18, f);
  const segs = 24;
  return (
    <div className="sweat" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 14px", margin: "8px 0 12px" }}>
      <svg viewBox={`0 0 ${W} 140`} style={{ width: 240, maxWidth: "100%", display: "block" }} role="img" aria-label="Sweat meter">
        {Array.from({ length: segs }, (_, i) => { const f0 = i / segs, f1 = (i + 1) / segs; const t = Math.abs((f0 + f1) / 2 - 0.5) * 2; const red = (f0 + f1) / 2 < 0.5;
          const col = red ? `rgba(${Math.round(254 - 101 * t)},${Math.round(202 - 175 * t)},${Math.round(202 - 175 * t)},1)` : `rgba(${Math.round(209 - 204 * t)},${Math.round(250 - 100 * t)},${Math.round(229 - 124 * t)},1)`;
          return <path key={i} d={arc(cx, cy, r, f0, f1 + 0.002)} stroke={col} strokeWidth="20" fill="none" />; })}
        <line x1={cx} x2={cx} y1={cy - r - 14} y2={cy - r + 14} stroke="#e5e7eb" strokeWidth="2" />
        <text x={cx - r} y={cy + 18} fill="#fca5a5" fontSize="12" textAnchor="middle">Sweating</text>
        <text x={cx + r} y={cy + 18} fill="#6ee7b7" fontSize="12" textAnchor="middle">Cruising</text>
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#f9fafb" strokeWidth="4" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="7" fill="#f9fafb" />
      </svg>
      <div style={{ flex: "1 1 200px", fontSize: 14, lineHeight: 1.55 }}>
        <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em" }}>Sweat meter</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: !started || base == null ? "#e5e7eb" : diff >= 0 ? "#6ee7b7" : "#fca5a5" }}>{mood}</div>
        <div>Now <b>{money(now)}</b> expected</div>
        {base != null && <div className="sub">{started ? `Started at ${money(base)}` : `Starting point ${money(base)} (locks in at the first kickoff)`}</div>}
        {started && base != null && <div><b className={diff >= 0 ? "pos" : "neg"}>{money(diff)}</b> since kickoff</div>}
        {s.error && <div className="sub">{s.error}</div>}
      </div>
    </div>
  );
}
