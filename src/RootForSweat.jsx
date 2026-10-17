// Sweat meter: semicircle gauge, center = pregame expected profit, needle = live expected profit now.
import React from "react";
import { gaugeFrac, liveLegMoves } from "./rootForSweat";
import { american } from "./rootForPrices";
import { quantileOf } from "./rootForSimple";

const etTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const pt = (cx, cy, r, f) => { const a = Math.PI * (1 - f); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
const arc = (cx, cy, r, f0, f1) => { const [x0, y0] = pt(cx, cy, r, f0); const [x1, y1] = pt(cx, cy, r, f1); return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`; };

// Preview: in-play legs moving the needle (signed $ share of now − pregame), one shared scale.
function LiveLegs({ d }) {
  const s = d.sweat || {}; const model = d.model || {};
  const positions = d.livePos || [...(model.positions || []), ...(s.kept || [])];
  const probs = { ...(s.last || {}), ...(model.probs || {}) };
  const starts = {}; const meta = {}; for (const e of d.perEvent || []) { starts[e.event] = e.start; meta[e.event] = e; }
  const { legs, settled } = liveLegMoves(positions, probs, s.frozen || {}, starts, new Set(s.finished || []));
  const shown = legs.filter((l) => Math.abs(l.move) >= 0.5);
  const mx = Math.max(...shown.map((l) => Math.abs(l.move)), 1);
  return (
    <div className="livelegs" data-noclick style={{ flex: "1 1 300px", minWidth: 0, borderLeft: "1px solid #1f2937", paddingLeft: 14 }}>
      <style>{`@media (max-width:600px){.livelegs{border-left:0!important;padding-left:0!important;border-top:1px solid #1f2937;padding-top:10px}}`}</style>
      <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Live legs moving the needle</div>
      {!shown.length ? <div className="sub" style={{ fontSize: 13, padding: "10px 0" }}>No legs are live right now. Once a game you're in kicks off, its push on the needle shows up here.</div>
        : shown.map((l) => { const e = meta[l.event] || {}; const pk = e.rootFor; const p = pk && probs[l.event] ? probs[l.event][pk] : null; const am = american(p); const pos = l.move >= 0;
          return (
            <div key={l.event} style={{ margin: "6px 0" }}>
              <div style={{ fontSize: 12.5, marginBottom: 2 }}><b>{e.rootForName || e.game || l.event}</b> <span className="sub">{e.game && e.rootForName ? `${e.game} · ` : ""}{am != null ? `live ${am > 0 ? "+" : ""}${am}` : ""}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ height: 12, borderRadius: 4, minWidth: 4, background: pos ? "#34d399" : "#f87171", width: `calc((100% - 70px) * ${(Math.abs(l.move) / mx).toFixed(4)})` }} />
                <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", color: pos ? "#6ee7b7" : "#fca5a5" }}>{money(l.move)}</span>
              </div>
            </div>); })}
      {shown.length > 0 && Math.abs(settled) >= 0.5 && <div className="sub" style={{ fontSize: 11.5, marginTop: 4 }}>Finished games: <b className={settled >= 0 ? "pos" : "neg"}>{money(settled)}</b> (not shown)</div>}
    </div>
  );
}

export default function SweatMeter({ d, legs = true }) {
  const s = d && d.sweat; if (!s) return null;
  const now = Number.isFinite(Number(s.now)) ? Number(s.now) : Number(d.ev); const started = s.started === true; const base = Number.isFinite(s.baseline) ? s.baseline : null;
  const center = started && base != null ? base : now;
  const lo = Math.min(d.worst && Number.isFinite(d.worst.pnl) ? d.worst.pnl : center - 1, center - 1);
  const hi = Math.max(d.hist ? quantileOf(d.hist, 0.95) : center + 1, center + 1, now + 1);
  const f = started && base != null ? gaugeFrac(now, lo, base, hi) : 0.5;
  const diff = started && base != null ? now - base : 0;
  const mood = s.error ? "Pregame number unavailable" : !started ? "No games have started yet" : base == null ? "Pregame number unavailable" : Math.abs(diff) < 0.5 ? "On track" : diff > 0 ? "Above expected" : "Below expected";
  const W = 260, cx = 130, cy = 120, r = 100; const [nx, ny] = pt(cx, cy, r - 18, f);
  const segs = 24;
  return (
    <div className="sweat" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 14px", margin: "8px 0 12px" }}>
      <svg viewBox={`0 0 ${W} 140`} style={{ width: 240, maxWidth: "100%", display: "block" }} role="img" aria-label="Live meter">
        {Array.from({ length: segs }, (_, i) => { const f0 = i / segs, f1 = (i + 1) / segs; const t = Math.abs((f0 + f1) / 2 - 0.5) * 2; const red = (f0 + f1) / 2 < 0.5;
          const col = red ? `rgba(${Math.round(254 - 101 * t)},${Math.round(202 - 175 * t)},${Math.round(202 - 175 * t)},1)` : `rgba(${Math.round(209 - 204 * t)},${Math.round(250 - 100 * t)},${Math.round(229 - 124 * t)},1)`;
          return <path key={i} d={arc(cx, cy, r, f0, f1 + 0.002)} stroke={col} strokeWidth="20" fill="none" />; })}
        <line x1={cx} x2={cx} y1={cy - r - 14} y2={cy - r + 14} stroke="#e5e7eb" strokeWidth="2" />
        <text x={4} y={cy + 18} fill="#fca5a5" fontSize="12" textAnchor="start">Below expected</text>
        <text x={W - 4} y={cy + 18} fill="#6ee7b7" fontSize="12" textAnchor="end">Above expected</text>
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#f9fafb" strokeWidth="4" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="7" fill="#f9fafb" />
      </svg>
      <div style={{ flex: "1 1 200px", fontSize: 14, lineHeight: 1.55 }}>
        <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em" }}>Live meter</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: !started || base == null || Math.abs(diff) < 0.5 ? "#e5e7eb" : diff >= 0 ? "#6ee7b7" : "#fca5a5" }}>{mood}</div>
        <div>Now <b>{money(now)}</b> expected</div>
        {base != null && <div className="sub">{started ? `Pregame ${money(base)}` : `Pregame ${money(base)} (each game locks in at its kickoff)`}</div>}
        {started && base != null && <div><b className={diff >= 0 ? "pos" : "neg"}>{money(diff)}</b> from games played</div>}
        {started && s.source && Object.values(s.source).includes("kickoff") && <div className="sub" style={{ fontSize: 11.5 }}>Some starting points are Kalshi prices at kickoff (saved history).</div>}
        {started && s.since && <div className="sub" style={{ fontSize: 11.5, color: "#fbbf24" }}>Some games have no pregame number: measured since {etTime(s.since)} ET.</div>}
        
      </div>
      {legs && started && base != null && <LiveLegs d={d} />}
    </div>
  );
}
