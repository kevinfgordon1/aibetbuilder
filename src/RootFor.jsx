// "What to root for" — owner-only cheat sheet across ALL open Combo Locks (live inverse bet fairs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { rootFor } from "./rootForEngine";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";

let client = null;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sUsd = (n) => (n > 0 ? "+" : "") + usd(n);
const pct = (p, d = 1) => (p == null ? "—" : p > 0 && p * 100 < 0.5 * 10 ** -d ? `<${(10 ** -d).toFixed(d)}%` : (p * 100).toFixed(d) + "%");
const oneIn = (p) => (p > 0 ? `about 1 in ${Math.round(1 / p).toLocaleString("en-US")}` : "");
const am = (a) => (a == null ? "—" : (a > 0 ? "+" : "") + Math.round(a));
const amFromP = (p) => (!(p > 0 && p < 1) ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
const etStamp = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
const REFRESH_MS = 3 * 60 * 1000;
const tStart = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET" : "");

// condition one game on a team winning (keep its outcomes) or losing (drop them), renormalized
function conditioned(model, picks) {
  const probs = { ...model.probs };
  for (const [ev, { team, won }] of Object.entries(picks)) {
    const g = model.groups[ev]; const p = probs[ev]; if (!g || !p || !g[team]) continue;
    const keep = Object.keys(p).filter((o) => g[team].includes(o) === won);
    const z = keep.reduce((a, o) => a + p[o], 0); if (!(z > 0)) continue;
    probs[ev] = Object.fromEntries(keep.map((o) => [o, p[o] / z]));
  }
  return probs;
}

function Hist({ hist, zero = 0 }) {
  if (!hist || !hist.bins || !hist.bins.length) return null;
  const W = 640, H = 150, pad = 26; const bins = hist.bins;
  const lo = bins[0].from, hi = bins[bins.length - 1].to; const x = (v) => pad + ((v - lo) / (hi - lo || 1)) * (W - 2 * pad);
  const maxP = Math.max(...bins.map((b) => b.p)) || 1;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: "100%", maxWidth: 760, display: "block" }} role="img" aria-label="P&L distribution">
      {bins.map((b, i) => { const h = (b.p / maxP) * H; return <rect key={i} x={x(b.from) + 0.5} y={H - h} width={Math.max(1, x(b.to) - x(b.from) - 1)} height={h} fill={b.to <= zero ? "#f87171" : b.from >= zero ? "#34d399" : "#fbbf24"}><title>{`${usd(b.from)} to ${usd(b.to)}: ${pct(b.p, 2)}`}</title></rect>; })}
      {zero > lo && zero < hi && <line x1={x(zero)} x2={x(zero)} y1={0} y2={H} stroke="#e5e7eb" strokeDasharray="3 3" />}
      <text x={pad} y={H + 15} fill="#9ca3af" fontSize="11">{usd(lo)}</text>
      {zero > lo && zero < hi && <text x={x(zero)} y={H + 15} fill="#e5e7eb" fontSize="11" textAnchor="middle">$0</text>}
      <text x={W - pad} y={H + 15} fill="#9ca3af" fontSize="11" textAnchor="end">{usd(hi)}{hist.tailP > 0 ? "+" : ""}</text>
    </svg>
  );
}

const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };

export default function RootFor({ user, initialData = null }) {
  const [open, setOpen] = useState(true);
  const [st, setSt] = useState({ loading: false, error: null, data: initialData });
  const load = useCallback(async () => {
    const c = supabase();
    if (!c) return setSt({ loading: false, error: "Not configured", data: null });
    setSt((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const r = await fetch("/api/root-for", { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `Request failed (${r.status})`);
      setSt({ loading: false, error: null, data: j });
    } catch (e) { setSt((s) => ({ loading: false, error: String((e && e.message) || e), data: s.data })); }
  }, []);
  useEffect(() => { if (canSeeOwnerTools(user) && !initialData) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // live: reprice every 3 minutes while the tab is visible (in-game prices included). No alerts.
  useEffect(() => {
    if (!canSeeOwnerTools(user) || initialData) return undefined;
    const id = setInterval(() => { if (typeof document === "undefined" || document.visibilityState !== "hidden") load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [user, initialData, load]);
  const [picks, setPicks] = useState({});
  const base = st.data;
  const whatIf = useMemo(() => {
    if (!base || !base.model || !Object.keys(picks).length) return null;
    try {
      const r = rootFor(base.model.positions, conditioned(base.model, picks), { mcSamples: 50000, histBins: 32 });
      return r;
    } catch (e) { return { error: String(e.message || e) }; }
  }, [base, picks]);
  const toggle = (ev, team) => setPicks((p) => {
    const cur = p[ev]; const n = { ...p };
    if (!cur || cur.team !== team) n[ev] = { team, won: true };
    else if (cur.won) n[ev] = { team, won: false };
    else delete n[ev];
    return n;
  });
  if (!canSeeOwnerTools(user)) return null;
  const d = base && whatIf && !whatIf.error ? { ...base, ...whatIf, top: base.top, perEvent: base.perEvent } : base;
  const slots = [];
  if (base) for (const e of base.perEvent) { const k = (e.slot && e.slot.key) || "9"; let g = slots.find((x) => x.key === k); if (!g) slots.push((g = { key: k, label: (e.slot && e.slot.label) || "Other days", rows: [] })); g.rows.push(e); }
  slots.sort((a, b) => a.key.localeCompare(b.key));
  const teamBtns = (e) => {
    const g = base.model && base.model.groups[e.event]; if (!g) return null;
    return Object.keys(g).map((t) => { const pk = picks[e.event]; const on = pk && pk.team === t; return (
      <button key={t} type="button" className={"wi" + (on ? (pk.won ? " won" : " lost") : "")} onClick={() => toggle(e.event, t)} title="Tap: won → lost → clear">
        {e.kind === "game" ? t : t.toUpperCase()}{on ? (pk.won ? " ✓" : " ✗") : ""}
      </button>); });
  };
  return (
    <div className="rootfor">
      <style>{`
        .rootfor{border:1px solid #374151;border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#0b1220;color:#e5e7eb;font-size:13px}
        .rootfor h3{margin:0;font-size:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .rootfor .sub{color:#9ca3af;font-size:12px}.rootfor .tag{font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(16,185,129,.15);color:#6ee7b7}
        .rootfor .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
        .rootfor .tile{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
        .rootfor .tile b{display:block;font-size:18px;margin:2px 0}.rootfor .tile span{color:#9ca3af;font-size:12px}
        .rootfor .pos{color:#6ee7b7}.rootfor .neg{color:#fca5a5}
        .rootfor table{width:100%;border-collapse:collapse;margin-top:6px}.rootfor th,.rootfor td{padding:6px;border-bottom:1px solid #1f2937;text-align:left}
        .rootfor th{color:#9ca3af;font-weight:500;font-size:12px}.rootfor .num{text-align:right;font-variant-numeric:tabular-nums}
        .rootfor h4{margin:14px 0 4px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
        .rootfor button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}
        .rootfor .note{color:#9ca3af;font-size:12px;margin-top:6px}
        .rootfor .wi{padding:2px 7px;margin-right:4px;font-size:11px}.rootfor .wi.won{background:#065f46;border-color:#10b981}.rootfor .wi.lost{background:#7f1d1d;border-color:#ef4444}
        .rootfor .banner{background:#1e293b;border:1px solid #f59e0b;border-radius:8px;padding:6px 10px;margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .rootfor .slot td{background:#111827;color:#93c5fd;font-weight:600;font-size:12px}
        @media (max-width:600px){.rootfor .hide-sm{display:none}}
      `}</style>
      <h3>
        What to root for <span className="tag">Owner</span>
        <span className="sub">{d ? `Last updated ${etStamp(d.asOf)} · auto-updates every 3 min · ${d.locksPriced} of ${d.locksTotal} open locks · ${d.events} games` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" onClick={load} disabled={st.loading}>{st.loading ? "Updating…" : "Refresh"}</button>
          <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </span>
      </h3>
      {st.error && <div className="note neg">{st.error}</div>}
      {open && d && (
        <>
          {Object.keys(picks).length > 0 && (
            <div className="banner">
              <b>What-if:</b> {Object.entries(picks).map(([ev, pk]) => `${(base.model.teamNames || {})[`${ev}:${pk.team}`] || pk.team} ${pk.won ? "won" : "lost"}`).join(" · ")}
              {whatIf && whatIf.error ? <span className="neg">{whatIf.error}</span> : <span className="sub">numbers below are conditional (simulated)</span>}
              <button type="button" onClick={() => setPicks({})} style={{ marginLeft: "auto" }}>Reset</button>
            </div>
          )}
          <h4>Top 5 to root for (biggest swing in total P&L)</h4>
          <table>
            <thead><tr><th>#</th><th>Root for</th><th className="hide-sm">Game</th><th className="num">Chance now</th><th className="num">Fair</th><th className="num">Swing</th><th className="num hide-sm">If it hits / misses</th></tr></thead>
            <tbody>
              {d.top.map((t, i) => (
                <tr key={t.event}>
                  <td>{i + 1}</td><td><b>{t.name}</b></td><td className="hide-sm">{t.game}</td>
                  <td className="num">{pct(t.p)}</td><td className="num">{am(t.american)}</td>
                  <td className="num pos">{usd(t.swing)}</td>
                  <td className="num hide-sm">{sUsd(t.ifHit)} / {sUsd(t.ifMiss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid">
            <div className="tile"><span>Best outcome</span><b className="pos">{sUsd(d.best && d.best.pnl)}</b><span>{d.best && d.best.p != null ? (d.best.p < 1e-4 ? `${pct(d.best.p, 3)} chance (${oneIn(d.best.p)})` : `${pct(d.best.p, 3)} chance (${am(amFromP(d.best.p))})`) : "chance not computed"}</span></div>
            <div className="tile"><span>Worst outcome</span><b className={d.worst && d.worst.pnl < 0 ? "neg" : "pos"}>{sUsd(d.worst && d.worst.pnl)}</b><span>{d.worst && d.worst.p != null ? `${pct(d.worst.p, 3)} chance (${am(amFromP(d.worst.p))})` : "chance not computed"}</span></div>
            <div className="tile"><span>Total EV</span><b className={d.ev >= 0 ? "pos" : "neg"}>{sUsd(d.ev)}</b><span>±2 SD: {sUsd(d.lo2)} to {sUsd(d.hi2)}</span></div>
            <div className="tile"><span>Chance of a profit</span><b>{pct(d.pProfit, 1)}</b><span>{d.exact && d.exact.pProfit === false ? "simulated" : "exact"}</span></div>
          </div>
          <div className="note">±2 SD is correlation-aware (same team across locks moves together). With long shots the real range is lopsided: most slates land near the downside, and a rare all-hit slate makes the upside tail much longer than the ±2 SD band suggests.</div>
          <h4>P&L distribution{whatIf ? " (what-if)" : ""}</h4>
          <Hist hist={d.hist} />
          <div className="note">Red = loss, green = profit (simulated slates, {d.hist ? d.hist.samples.toLocaleString() : "—"}). {d.hist && d.hist.tailP > 0 ? `${pct(d.hist.tailP, 2)} of slates land above ${usd(d.hist.tailFrom)} (folded into the last bar).` : ""}</div>
          <h4>Per game, by time slot <span className="sub" style={{ textTransform: "none" }}>· tap a team: won → lost → clear</span></h4>
          <table>
            <thead><tr><th>Game</th><th className="hide-sm">Start</th><th>Root for</th><th className="num">Chance now</th><th className="num">Swing</th><th>What-if</th></tr></thead>
            <tbody>
              {slots.map((g) => (
                <React.Fragment key={g.key}>
                  <tr className="slot"><td colSpan={6}>{g.label}</td></tr>
                  {g.rows.map((e) => (
                    <tr key={e.event}>
                      <td>{e.game}</td><td className="hide-sm sub">{tStart(e.start)}</td><td>{e.swing != null && Math.abs(e.swing) >= 0.5 ? e.rootForName : "Doesn't matter"}</td>
                      <td className="num">{pct(e.p)}</td><td className="num">{e.swing != null ? usd(Math.abs(e.swing)) : "—"}</td><td>{teamBtns(e)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <div className="note">
            Chances come from the live inverse bet method: each leg is 1 minus the best opposing price with $500 of depth (fees included) across {Object.entries((d.legs || []).reduce((a, l) => { if (l.best) a[l.best] = (a[l.best] || 0) + 1; return a; }, {})).map(([v, n]) => `${VENUE[v] || v} (${n} legs)`).join(", ") || "—"}; ProphetX is off until its key is set. Chances are the raw inverted prices, not scaled. A team in many locks is one outcome, and both sides of a game can't both win. When locks hold both sides, the two raw chances add to a bit under 100%; the gap is treated as a slate where neither side's leg wins. Different games are independent. Where a game has a spread lock, its spread is nested inside the moneyline (covering implies winning), so spread and moneyline legs move together; totals stay independent of the winner (no live joint price to correlate them). Prices update in-game.
            {" "}{d.method === "exact" ? "Exact enumeration." : d.note}
            {d.unpriced && d.unpriced.length ? ` ${d.unpriced.length} lock(s) left out: a leg had no live price with $500 depth (${d.unpriced.map((u) => u.leg).slice(0, 3).join(", ")}${d.unpriced.length > 3 ? "…" : ""}).` : ""}
            {d.resting ? ` Resting hedge orders (${Math.round(d.resting).toLocaleString()} contracts) count only once filled.` : ""}
          </div>
        </>
      )}
    </div>
  );
}
