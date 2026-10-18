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
  const kept = (s.kept || []).filter((p) => !s.keptIds || s.keptIds.includes(String(p.id)));
  const positions = d.livePos || [...(model.positions || []), ...kept];
  const probs = { ...(s.last || {}), ...(model.probs || {}) };
  const starts = {}; const meta = {}; for (const e of d.perEvent || []) { starts[e.event] = e.start; meta[e.event] = e; }
  const finals = model.finals || {};
  const { legs, done, settled } = liveLegMoves(positions, probs, s.frozen || {}, starts, new Set([...(s.finished || []), ...Object.keys(finals)]));
  const doneShown = done.filter((l) => Math.abs(l.move) >= 0.5);
  const result = (ev) => { // "HOU Texans won" / "Over 42.5 hit"
    const pr = probs[ev] || {}; const w = finals[ev] || Object.entries(pr).filter(([o]) => o !== "__neither").sort((a, b) => b[1] - a[1])[0]?.[0]; if (!w) return ev;
    const e = meta[ev] || {}; const team = String(w).split(/[<>]=?/)[0];
    const nm = ((e.outcomes || []).find((o) => o.outcome === w) || {}).name || (model.teamNames || {})[`${ev}:${team}`] || w;
    return w === "yes" || w === "no" || /^(Not: |Over |Under )/.test(nm) ? `${nm} hit` : `${nm} won`;
  };
  const shown = legs.filter((l) => Math.abs(l.move) >= 0.5);
  const mx = Math.max(...shown.map((l) => Math.abs(l.move)), ...doneShown.map((l) => Math.abs(l.move)), 1);
  return (
    <div className="livelegs" data-noclick style={{ flex: "1 1 300px", minWidth: 0, borderLeft: "1px solid #1f2937", paddingLeft: 14 }}>
      <style>{`@media (max-width:600px){.livelegs{border-left:0!important;padding-left:0!important;border-top:1px solid #1f2937;padding-top:10px}}`}</style>
      <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Live legs moving the needle <span style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}>· change in expected profit since kickoff</span></div>
      {!shown.length ? <div className="sub" style={{ fontSize: 13, padding: "10px 0" }}>No legs are live right now. Once a game you're in kicks off, its push on the needle shows up here.</div>
        : shown.map((l) => { const e = meta[l.event] || {}; const pk = e.rootFor; const p = pk && probs[l.event] ? probs[l.event][pk] : null; const am = american(p); const pos = l.move >= 0;
          return (
            <div key={l.event} style={{ margin: "6px 0" }}>
              <div style={{ fontSize: 12.5, marginBottom: 2 }}><b>{e.rootForName || e.game || l.event}</b> <span className="sub">{e.game && e.rootForName ? `${e.game} · ` : ""}{am != null ? `live ${am > 0 ? "+" : ""}${am}` : ""}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ height: 12, borderRadius: 4, minWidth: 4, background: pos ? "#34d399" : "#f87171", width: `calc((100% - 70px) * ${(Math.abs(l.move) / mx).toFixed(4)})` }} />
                <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", color: pos ? "#6ee7b7" : "#fca5a5" }}>{money(l.move)} EV</span>
              </div>
            </div>); })}
      {doneShown.length > 0 && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Finished games <span style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}>· total <b className={settled >= 0 ? "pos" : "neg"}>{money(settled)}</b> change in expected profit since kickoff</span></div>
        {doneShown.map((l) => { const e = meta[l.event] || {}; const pos = l.move >= 0;
          return (
            <div key={l.event} style={{ margin: "6px 0" }}>
              <div style={{ fontSize: 12.5, marginBottom: 2 }}><b>{result(l.event)}</b> <span className="sub">{e.game ? `${e.game} · ` : ""}final</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ height: 12, borderRadius: 4, minWidth: 4, background: pos ? "#34d399" : "#f87171", width: `calc((100% - 70px) * ${(Math.abs(l.move) / mx).toFixed(4)})` }} />
                <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", color: pos ? "#6ee7b7" : "#fca5a5" }}>{money(l.move)} EV</span>
              </div>
            </div>); })}
      </div>}
    </div>
  );
}

export default function SweatMeter({ d, legs = true }) {
  const s = d && d.sweat; if (!s) return null;
  const now = Number.isFinite(Number(s.now)) ? Number(s.now) : Number(d.ev); const started = s.started === true; const base = Number.isFinite(s.baseline) ? s.baseline : null;
  const center = started && base != null ? base : now;
  // ±2 SD lines: the sheet's own result distribution (d.hist). Only percentiles exist, so 2.3rd/97.7th percentile
  // spreads (measured from the sheet's expected value d.ev) are placed around the gauge's expectation.
  const hasH = !!(d.hist && d.hist.bins && d.hist.bins.length); const mean = Number.isFinite(Number(d.ev)) ? Number(d.ev) : now;
  const sdLo = hasH ? Math.max(1, mean - quantileOf(d.hist, 0.023)) : null, sdHi = hasH ? Math.max(1, quantileOf(d.hist, 0.977) - mean) : null;
  const m2 = hasH ? center - sdLo : null, p2 = hasH ? center + sdHi : null;
  // dollar axis: ±2 SD sit at 1/8 from each end (gauge edges = ±2.67 SD), widened if the needle goes past
  const lo = hasH ? Math.min(center - sdLo * 4 / 3, now) : Math.min(d.worst && Number.isFinite(d.worst.pnl) ? d.worst.pnl : center - 1, center - 1);
  const hi = hasH ? Math.max(center + sdHi * 4 / 3, now) : Math.max(d.hist ? quantileOf(d.hist, 0.95) : center + 1, center + 1, now + 1);
  const f = started && base != null ? gaugeFrac(now, lo, base, hi) : 0.5;
  const diff = started && base != null ? now - base : 0;
  const mood = s.error ? "Pregame number unavailable" : !started ? "No games have started yet" : base == null ? "Pregame number unavailable" : Math.abs(diff) < 0.5 ? "On track" : diff > 0 ? "Above expected" : "Below expected";
  const W = 260, cx = 130, cy = 132, r = 100; const [nx, ny] = pt(cx, cy, r - 18, f);
  const segs = 24;
  return (
    <div className="sweat" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 14px", margin: "8px 0 12px" }}>
      <svg viewBox={`-60 0 ${W + 120} 152`} style={{ width: 460, maxWidth: "100%", flex: "0 1 460px", display: "block" }} role="img" aria-label="Live meter">
        {Array.from({ length: segs }, (_, i) => { const f0 = i / segs, f1 = (i + 1) / segs; const t = Math.abs((f0 + f1) / 2 - 0.5) * 2; const red = (f0 + f1) / 2 < 0.5;
          const col = red ? `rgba(${Math.round(254 - 101 * t)},${Math.round(202 - 175 * t)},${Math.round(202 - 175 * t)},1)` : `rgba(${Math.round(209 - 204 * t)},${Math.round(250 - 100 * t)},${Math.round(229 - 124 * t)},1)`;
          return <path key={i} d={arc(cx, cy, r, f0, f1 + 0.002)} stroke={col} strokeWidth="20" fill="none" />; })}
        <line x1={cx} x2={cx} y1={cy - r - 14} y2={cy - r + 14} stroke="#e5e7eb" strokeWidth="2" />
        <text x={cx} y={cy - r - 17} fill="#f5c542" fontSize="13" fontWeight="700" textAnchor="middle">{money(center)}</text>
        {hasH && [[m2, "#fca5a5"], [p2, "#6ee7b7"]].map(([v, col]) => { const g = gaugeFrac(v, lo, center, hi); const [x0, y0] = pt(cx, cy, r - 12, g); const [x1, y1] = pt(cx, cy, r + 12, g); const [tx0, ty0] = pt(cx, cy, r + 12, g); const tx = tx0 + (g < 0.5 ? -4 : 4), ty = ty0 - 6;
          return <g key={col}><line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#f9fafb" strokeWidth="2" strokeDasharray="2 2" /><text x={tx} y={ty} fill={col} fontSize="11" fontWeight="700" textAnchor={g < 0.5 ? "end" : "start"}>{money(v)}</text></g>; })}
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
        {hasH && <div className="sub" style={{ fontSize: 11.5 }}>Dotted lines: likely range (±2 SD) {money(m2)} to {money(p2)}</div>}
        {started && base != null && <div><b className={diff >= 0 ? "pos" : "neg"}>{money(diff)}</b> from games played</div>}
        {started && s.source && Object.values(s.source).includes("kickoff") && <div className="sub" style={{ fontSize: 11.5 }}>Some starting points are Kalshi prices at kickoff (saved history).</div>}
        {started && s.since && <div className="sub" style={{ fontSize: 11.5, color: "#fbbf24" }}>Some games have no pregame number: measured since {etTime(s.since)} ET.</div>}
        
      </div>
      {legs && started && base != null && <LiveLegs d={d} />}
    </div>
  );
}
