// Sweat meter: semicircle gauge, center = pregame expected profit, needle = live expected profit now.
import React, { useContext, useEffect, useMemo, useState } from "react";
// Sheet passes its loading flag down so the pill under the gauge can say "refreshing…".
export const PillLoading = React.createContext(false);
import { gaugeFrac, liveLegMoves, lockedPregameEv } from "./rootForSweat";
import { american } from "./rootForPrices";
import { quantileOf } from "./rootForSimple";
import { rootFor } from "./rootForEngine";

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
// Pregame range for the day: the same locks as Now, every one of the day's games at its kickoff (frozen) chances,
// later games at their current pregame chances. Kickoff numbers never change, so the range doesn't drift as games
// finish. 2.3rd/97.7th percentiles of that distribution = the ±2 SD lines (the engine only gives percentiles).
export function pregameRange(d, s, full = false) {
  try {
    const model = d.model || {}; const sn = (s.dayRow && s.dayRow.snap) || null; let pos; let preP;
    const today = s.dayResult != null && !!(sn && sn.positions);
    if (today) { // Today: the saved day row (all of the day's locks, settled ones too)
      pos = Object.values(sn.positions); preP = { ...(model.probs || {}), ...(sn.last || {}), ...(sn.frozen || {}) };
    } else { // Today & beyond / All: open locks + kept finished ones, as Now
      const kept = (s.kept || []).filter((p) => !s.keptIds || s.keptIds.includes(String(p.id)));
      pos = [...(model.positions || []), ...kept];
      preP = { ...((sn && sn.last) || {}), ...(s.last || {}), ...(model.probs || {}), ...((sn && sn.frozen) || {}), ...(s.frozen || {}) };
    }
    if (!pos.length) return null;
    // per-lock freezes (first-kickoff snapshots): contracts as of then; for the joint simulation each game uses the
    // chances of the earliest-frozen lock holding it (one draw per game), then the range is shifted to the center
    const lp = (sn && sn.lockPre) || {}; const byT = Object.values(lp).sort((a, b) => String(b.t0).localeCompare(String(a.t0)));
    const simP = { ...preP }; for (const f of byT) Object.assign(simP, f.probs || {});
    const simPos = pos.map((p) => { const f = lp[String(p.id)]; return f ? { ...p, hit: f.pos.hit, miss: f.pos.miss } : p; });
    // Sniper page: Pregame = fill-time value of the open fills (server sends sweat.fixedBaseline).
    const center = today ? null : s.fixedBaseline && Number.isFinite(Number(s.baseline)) ? Number(s.baseline) : lockedPregameEv(pos, preP, lp);
    const r = rootFor(simPos, simP, { histBins: 40, mcSamples: 20000, rng: seeded(11) });
    if (!r || !r.hist || !r.hist.bins || !r.hist.bins.length) return null;
    if (full) return { r, center };
    return { ev: Number(r.ev), q023: quantileOf(r.hist, 0.023), q977: quantileOf(r.hist, 0.977), center, frozenLocks: Object.keys(lp).length, fallbackLegs: Object.values(lp).reduce((a, f) => a + Number(f.fb || 0), 0), ...savedLegCounts(lp) };
  } catch { return null; }
}
// Pregame (kickoff-price) version of the sheet's distribution for the header, win/lose bars and result chart:
// same simulation as the needle's ±2 SD lines, shifted so its expected value equals the needle's center.
// null before any game has started (then live = pregame anyway).
export function pregameView(d) {
  const s = d && d.sweat; if (!s || s.started !== true) return null;
  const out = pregameRange(d, s, true); if (!out) return null;
  const c = Number.isFinite(out.center) ? out.center : Number.isFinite(Number(s.baseline)) ? Number(s.baseline) : null; if (c == null) return null;
  const { r } = out; const k = c - Number(r.ev);
  const bins = r.hist.bins.map((b) => ({ ...b, from: b.from + k, to: b.to + k }));
  const pProfit = bins.reduce((a, b) => a + (b.to <= 0 ? 0 : b.from >= 0 ? b.p : b.p * (b.to / ((b.to - b.from) || 1))), 0);
  const mv = (x) => (x && Number.isFinite(Number(x.pnl)) ? { ...x, pnl: Number(x.pnl) + k } : x);
  return { ev: c, hist: { ...r.hist, bins }, worst: mv(r.worst), best: mv(r.best), pProfit };
}
// How each frozen lock's kickoff numbers were taken: st = legs from prices saved ≤15 min before the first kickoff
// (exact), fb = estimated (earlier saved price / stored snapshot), n = legs frozen. Locks frozen before n existed
// are left out of the count.
export function savedLegCounts(lp) {
  let saved = 0, est = 0, legsN = 0;
  for (const f of Object.values(lp || {})) { if (!f || f.n == null) continue; legsN += Number(f.n) || 0; saved += Number(f.st) || 0; est += Number(f.fb) || 0; }
  return { savedLegs: saved, estimatedLegs: est, countedLegs: legsN };
}
// Finished binary legs (props/totals/spreads) lose their names when they drop off the board: saved names first,
// else read the Kalshi ticker ("KXNFLTD-26OCT18NONYG-NOKMILLER5-1" → "K. Miller (NO) 1+ TD").
const NFL = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAC","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
const splitGame = (g) => { for (const a of NFL) if (g.startsWith(a) && NFL.includes(g.slice(a.length))) return `${a}@${g.slice(a.length)}`; return g; };
const titleCase = (x) => x.charAt(0) + x.slice(1).toLowerCase();
export function tickerLabel(ev) {
  const m = String(ev).match(/^KX[A-Z]*?(TD|TOTAL|SPREAD|GAME)-\d{2}[A-Z]{3}\d{2}([A-Z]+)(?:-(.+))?$/); if (!m) return null;
  const [, kind, game, tail = ""] = m; const g = splitGame(game);
  if (kind === "TOTAL" && /^\d+$/.test(tail)) return `Over ${Number(tail) - 0.5} ${g}`;
  if (kind === "SPREAD") { const s = tail.match(/^([A-Z]+?)(\d+)$/); if (s) return `${s[1]} −${Number(s[2]) - 0.5} (${g})`; }
  if (kind === "TD") { const s = tail.match(/^([A-Z]+?)([A-Z])([A-Z]+)\d+-(\d+)$/); if (s) { const team = NFL.find((a) => game.includes(a) && tail.startsWith(a) && /^[A-Z]{2,}/.test(tail.slice(a.length))) || s[1];
    const rest = tail.slice(team.length).replace(/\d+-\d+$/, ""); return `${rest.charAt(0)}. ${titleCase(rest.slice(1))} (${team}) ${s[4]}+ TD`; } }
  return null;
}

const etTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const pt = (cx, cy, r, f) => { const a = Math.PI * (1 - f); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
const arc = (cx, cy, r, f0, f1) => { const [x0, y0] = pt(cx, cy, r, f0); const [x1, y1] = pt(cx, cy, r, f1); return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`; };

const agoText = (s) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`);
// big ticking "Updated 37s ago" pill, from the server's computed asOf; amber > 3 min, red > 6 min
export function UpdatedPill({ asOf, loading }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const t = Date.parse(asOf); if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const lvl = s > 360 ? "red" : s > 180 ? "amber" : "ok";
  return <span className={`upd-pill ${lvl}`} role="status" aria-live="off" title={`Data computed ${new Date(asOf).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`}><span className="dot" />Updated {agoText(s)}{loading ? " · refreshing…" : ""}</span>;
}

// Preview: in-play legs moving the needle (signed $ share of now − pregame), one shared scale.
function LiveLegs({ d, part = "live" }) {
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
    const saved = (((s.dayRow && s.dayRow.snap && s.dayRow.snap.names) || {})[ev]) || null;
    if (w === "yes" || w === "no") { const lbl = (saved && (saved.yes || saved.label)) || e.rootForName || tickerLabel(ev) || e.game || ev; return `${String(lbl).replace(/:\s*$/, "")} — ${w === "yes" ? "hit" : "no hit"}`; }
    const nm2 = nm === w && saved && saved[w] ? saved[w] : nm;
    return /^(Not: |Over |Under )/.test(nm2) ? `${nm2} — hit` : `${nm2} won`;
  };
  const shown = legs.filter((l) => Math.abs(l.move) >= 0.5);
  const mx = Math.max(...shown.map((l) => Math.abs(l.move)), ...doneShown.map((l) => Math.abs(l.move)), 1);
  if (part === "done") return !doneShown.length ? null : (
    <div className="donelegs" data-noclick style={{ alignSelf: "stretch", width: "100%", borderTop: "1px solid #1f2937", paddingTop: 8, marginTop: 4 }}>
      {doneShown.length > 0 && <div>
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
    </div>
  );
}

export default function SweatMeter({ d, legs = true, liveCol = true }) {
  const pillLoading = useContext(PillLoading);
  const s0 = d && d.sweat;
  const preR = useMemo(() => (legs && s0 && s0.started ? pregameRange(d, s0) : null), [d && d.asOf, legs, s0 && s0.baseline, s0 && s0.dayResult, s0 && (s0.keptIds || []).length, s0 && (s0.kept || []).length, d && d.model && (d.model.positions || []).length]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = s0; if (!s) return null;
  const now = Number.isFinite(Number(s.now)) ? Number(s.now) : Number(d.ev); const started = s.started === true; const base = preR && started && Number.isFinite(preR.center) ? preR.center : Number.isFinite(s.baseline) ? s.baseline : null;
  const center = started && base != null ? base : now;
  // ±2 SD lines + axis: frozen pregame distribution of the day (pregameRange); falls back to the sheet's current
  // distribution (past/final days) when the pregame one can't be built.
  const pre = preR && started && base != null ? preR : null;
  const hasH = !!pre || !!(d.hist && d.hist.bins && d.hist.bins.length); const mean = pre ? pre.ev : Number.isFinite(Number(d.ev)) ? Number(d.ev) : now;
  const sdLo = !hasH ? null : Math.max(1, mean - (pre ? pre.q023 : quantileOf(d.hist, 0.023))), sdHi = !hasH ? null : Math.max(1, (pre ? pre.q977 : quantileOf(d.hist, 0.977)) - mean);
  const m2 = hasH ? center - sdLo : null, p2 = hasH ? center + sdHi : null;
  // one dollar axis for needle + lines: ±2 SD sit 1/8 in from each end (ends = ±2.67 SD). Never widened, so the
  // lines stay put; a needle past an end is pinned there with an arrow.
  const lo = hasH ? center - sdLo * 4 / 3 : Math.min(d.worst && Number.isFinite(d.worst.pnl) ? d.worst.pnl : center - 1, center - 1, now);
  const hi = hasH ? center + sdHi * 4 / 3 : Math.max(d.hist ? quantileOf(d.hist, 0.95) : center + 1, center + 1, now);
  const off = started && base != null ? (now > hi ? 1 : now < lo ? -1 : 0) : 0;
  const f = started && base != null ? gaugeFrac(now, lo, base, hi) : 0.5;
  const diff = started && base != null ? now - base : 0;
  const mood = s.error ? "Pregame number unavailable" : !started ? "No games have started yet" : base == null ? "Pregame number unavailable" : Math.abs(diff) < 0.5 ? "On track" : diff > 0 ? "Above expected" : "Below expected";
  const W = 260, cx = 130, cy = 132, r = 100; const [nx, ny] = pt(cx, cy, r - 18, f);
  const segs = 24;
  return (
    <div className="sweat" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 16, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 14px", margin: "8px 0 12px" }}>
      <div style={{ flex: "0 1 460px", maxWidth: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg viewBox={`-60 0 ${W + 120} 152`} style={{ width: 460, maxWidth: "100%", display: "block" }} role="img" aria-label="Live meter">
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
        {off !== 0 && (() => { const g = off > 0 ? 1 : 0; const [ax, ay] = pt(cx, cy, r - 18, g); const dx = off > 0 ? 1 : -1;
          return <g><polygon points={`${ax + dx * 14},${ay} ${ax + dx * 2},${ay - 7} ${ax + dx * 2},${ay + 7}`} fill="#f5c542" /><text x={ax - dx * 4} y={ay - 10} fill="#f5c542" fontSize="10.5" fontWeight="700" textAnchor={off > 0 ? "end" : "start"}>{money(now)} off scale</text></g>; })()}
      </svg>
        {d.asOf && <UpdatedPill asOf={d.asOf} loading={pillLoading} />}
        {legs && started && base != null && <LiveLegs d={d} part="done" />}
      </div>
      <div style={{ flex: "1 1 200px", fontSize: 14, lineHeight: 1.55, paddingTop: 8 }}>
        <div style={{ fontSize: 13, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".04em" }}>Live meter</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: !started || base == null || Math.abs(diff) < 0.5 ? "#e5e7eb" : diff >= 0 ? "#6ee7b7" : "#fca5a5" }}>{mood}</div>
        <div>Now <b>{money(now)}</b> expected</div>
        {base != null && <div className="sub">{started ? `Pregame ${money(base)}` : `Pregame ${money(base)} (each game locks in at its kickoff)`}</div>}
        {hasH && <div className="sub" style={{ fontSize: 11.5 }}>{pre ? "Pregame likely range" : "Dotted lines: likely range"} (±2 SD) {money(m2)} to {money(p2)}</div>}
        {started && base != null && <div><b className={diff >= 0 ? "pos" : "neg"}>{money(diff)}</b> {s.fixedBaseline ? "since the fills (games played + price moves)" : "from games played"}</div>}
        {started && pre && pre.countedLegs > 0 && <div className="sub" data-testid="rf-saved-legs" style={{ fontSize: 11.5 }}>Kickoff numbers: <b>{pre.savedLegs}</b> of {pre.countedLegs} legs from prices saved before kickoff{pre.estimatedLegs ? `, ${pre.estimatedLegs} estimated` : ""}{pre.countedLegs - pre.savedLegs - pre.estimatedLegs > 0 ? `, ${pre.countedLegs - pre.savedLegs - pre.estimatedLegs} from live prices at kickoff` : ""}.</div>}
        {started && s.source && Object.values(s.source).includes("kickoff") && <div className="sub" style={{ fontSize: 11.5 }}>Some starting points are Kalshi prices at kickoff (saved history).</div>}
        {started && s.since && <div className="sub" style={{ fontSize: 11.5, color: "#fbbf24" }}>Some games have no pregame number: measured since {etTime(s.since)} ET.</div>}
        
      </div>
      {legs && liveCol && started && base != null && <LiveLegs d={d} />}
    </div>
  );
}
