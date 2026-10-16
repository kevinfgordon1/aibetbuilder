// "What to root for" — owner-only cheat sheet across ALL open Combo Locks (live inverse bet fairs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { rootFor } from "./rootForEngine";
import PnlCurve from "./RootForCurve";
import EvBars from "./RootForEvBars";
import SweatMeter from "./RootForSweat";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import { nightmareKeys, summarySentence, chanceWords, typicalRange, topByGain, topByDrop, sMoney, fmtAmerican, americanFromP } from "./rootForSimple";

const VIEW_KEY = "rootfor.view";
const readView = () => { try { return (typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY)) === "detailed" ? "detailed" : "simple"; } catch { return "simple"; } };

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
const REFRESH_MS = 10 * 60 * 1000;
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


function Simple({ d, nightmare }) {
  const range = typicalRange(d.hist);
  const worstAm = d.worst && americanFromP(d.worst.p);
  const bestP = d.best && d.best.p;
  return (
    <div>
      <div className="lead">{summarySentence(d)}</div>
      {range && <div className="lead2">Most weekends land between <b className="neg">{sMoney(range.lo)}</b> and <b className="pos">{sMoney(range.hi)}</b>.</div>}
      <SweatMeter d={d} />
      <div className="pair">
        <div className="panel good">
          <h5>Root for these 5 <span className="sub">· adds this to your expected profit if they win</span></h5>
          {(() => { const top = topByGain(d); const mx = Math.max(...top.map((t) => t.gain), 1); return top.map((t) => (
            <div className="bar" key={t.event + t.outcome} title={t.game}>
              <div className="bl"><b>{t.name}</b> <span className="sub">{am(t.american)}{t.start ? ` · ${tStart(t.start)}` : ""}</span></div>
              <div className="bt"><div className="bf pos" style={{ width: `${(t.gain / mx) * 100}%` }} /><span className="bv pos" title={`Adds ${sMoney(t.gain)} to your expected profit if they win`}>{sMoney(t.gain)}</span></div>
            </div>)); })()}
        </div>
        <div className="panel bad">
          <h5>Your nightmare: <span className="neg">{sMoney(d.worst && d.worst.pnl)}</span> {worstAm != null && <span className="sub">· odds {fmtAmerican(worstAm)} ({chanceWords(d.worst.p)})</span>}</h5>
          <div className="sub" style={{ margin: "-2px 0 6px" }}>Results that hurt most · cuts this from your expected profit if it happens</div>
          {(() => { const bad = topByDrop(d); const mx = Math.max(...bad.map((k) => -k.drop), 1); return bad.map((k) => (
            <div className="bar" key={k.event + k.outcome}>
              <div className="bl"><b>{k.label}</b> <span className="sub">{am(k.american)}{k.start ? ` · ${tStart(k.start)}` : ""}</span></div>
              <div className="bt"><div className="bf negb" style={{ width: `${(-k.drop / mx) * 100}%` }} /><span className="bv neg" title={`Cuts ${sMoney(k.drop)} from your expected profit if this happens`}>{sMoney(k.drop)}</span></div>
            </div>)); })()}
        </div>
      </div>
      <div className="two">
        <div className="box good">
          <h5>Best case &amp; chance of profit</h5>
          <div>Everything hits: <span className="big pos">{sMoney(d.best && d.best.pnl)}</span> <span className="sub">({bestP > 0 ? chanceWords(bestP) : "very unlikely"})</span></div>
          <div style={{ marginTop: 8 }}>Chance you finish ahead: <b>{chanceWords(d.pProfit)}</b> <span className="sub">· odds {fmtAmerican(americanFromP(d.pProfit))} ({pct(d.pProfit, 0)})</span></div>
        </div>
      </div>
      <EvBars hist={d.hist} ev={d.ev} pProfit={d.pProfit} worst={d.worst} />
      <h4>How likely each result is</h4>
      <PnlCurve hist={d.hist} worst={d.worst} ev={d.ev} pProfit={d.pProfit} best={d.best} />
      <div className="note">Switch to <b>Detailed</b> for every game, what-ifs and the math.</div>
    </div>
  );
}

const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };

export default function RootFor({ user, initialData = null }) {
  const [open, setOpen] = useState(true);
  const [view, setViewState] = useState(readView);
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
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
  // live: reprice every 10 minutes while the tab is visible (in-game prices included). No alerts.
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
  const nightmare = useMemo(() => (base && base.model ? nightmareKeys(base.model) : []), [base]);
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
        .rootfor .seg{display:inline-flex;border:1px solid #374151;border-radius:8px;overflow:hidden}.rootfor .seg button{border:0;border-radius:0;background:transparent;color:#9ca3af}.rootfor .seg button.on{background:#f59e0b;color:#111827;font-weight:600}
        .rootfor .lead{font-size:18px;font-weight:600;line-height:1.35;margin:12px 0 2px}.rootfor .lead2{color:#cbd5e1;font-size:14px;margin:0 0 12px}
        .rootfor .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:6px 0 14px}
        .rootfor .card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
        .rootfor .card .rk{color:#f59e0b;font-weight:700;font-size:12px}.rootfor .card .tm{font-size:16px;font-weight:700;margin:2px 0}.rootfor .card .gm{color:#9ca3af;font-size:12px}
        .rootfor .card .od{font-size:14px;margin-top:6px}.rootfor .card .sw{font-size:14px;margin-top:4px}
        .rootfor .box{border-radius:10px;padding:12px 14px;margin:0 0 12px}.rootfor .box.bad{background:rgba(127,29,29,.25);border:1px solid #7f1d1d}.rootfor .box.good{background:rgba(6,95,70,.22);border:1px solid #065f46}
        .rootfor .box h5{margin:0 0 6px;font-size:14px}.rootfor .box ol{margin:6px 0 0 18px;padding:0}.rootfor .box li{margin:3px 0}
        .rootfor .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
        .rootfor .big{font-size:20px;font-weight:700}
        .rootfor .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 12px}
        .rootfor .panel{border-radius:10px;padding:12px 14px;background:#111827;border:1px solid #1f2937}.rootfor .panel.good{border-color:#065f46}.rootfor .panel.bad{border-color:#7f1d1d}
        .rootfor .panel h5{margin:0 0 8px;font-size:15px}
        .rootfor .bar{margin:8px 0}.rootfor .bl{font-size:13px;margin-bottom:3px}
        .rootfor .bt{display:flex;align-items:center;gap:8px}.rootfor .bf{height:14px;border-radius:4px;min-width:4px;flex:0 0 auto;max-width:calc(100% - 80px)}
        .rootfor .bf.pos{background:#34d399}.rootfor .bf.negb{background:#f87171}.rootfor .bv{font-weight:700;font-size:13px;white-space:nowrap}
        @media (max-width:700px){.rootfor .pair{grid-template-columns:1fr}}
        @media (max-width:600px){.rootfor .hide-sm{display:none}}
      `}</style>
      <h3>
        What to root for <span className="tag">Owner</span>
        <span className="sub">{d ? `Last updated ${etStamp(d.asOf)} · auto-updates every 10 min · ${d.locksPriced} of ${d.locksTotal} open locks · ${d.events} games` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span className="seg" role="group" aria-label="View">
            <button type="button" className={view === "simple" ? "on" : ""} aria-pressed={view === "simple"} onClick={() => setView("simple")}>Simple</button>
            <button type="button" className={view === "detailed" ? "on" : ""} aria-pressed={view === "detailed"} onClick={() => setView("detailed")}>Detailed</button>
          </span>
          <button type="button" onClick={load} disabled={st.loading}>{st.loading ? "Updating…" : "Refresh"}</button>
          <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </span>
      </h3>
      {st.error && <div className="note neg">{st.error}</div>}
      {open && d && view === "simple" && <Simple d={base} nightmare={nightmare} />}
      {open && d && view === "detailed" && (
        <>
          <SweatMeter d={base} />
          {Object.keys(picks).length > 0 && (
            <div className="banner">
              <b>What-if:</b> {Object.entries(picks).map(([ev, pk]) => `${(base.model.teamNames || {})[`${ev}:${pk.team}`] || pk.team} ${pk.won ? "won" : "lost"}`).join(" · ")}
              {whatIf && whatIf.error ? <span className="neg">{whatIf.error}</span> : <span className="sub">numbers below are conditional (simulated)</span>}
              <button type="button" onClick={() => setPicks({})} style={{ marginLeft: "auto" }}>Reset</button>
            </div>
          )}
          <h4>Top 5 to root for (biggest boost to expected profit if they win)</h4>
          <table>
            <thead><tr><th>#</th><th>Root for</th><th className="hide-sm">Game</th><th className="num">Chance now</th><th className="num">Fair</th><th className="num">Adds to exp. profit</th><th className="num">Swing</th><th className="num hide-sm">If it hits / misses</th></tr></thead>
            <tbody>
              {topByGain(base).map((t, i) => (
                <tr key={t.event}>
                  <td>{i + 1}</td><td><b>{t.name}</b></td><td className="hide-sm">{t.game}</td>
                  <td className="num">{pct(t.p)}</td><td className="num">{am(t.american)}</td>
                  <td className="num pos">{sUsd(t.gain)}</td>
                  <td className="num">{usd(t.swing)}</td>
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
          <EvBars hist={d.hist} ev={d.ev} pProfit={d.pProfit} worst={d.worst} />
          <h4>How likely each result is{whatIf ? " (what-if)" : ""}</h4>
          <PnlCurve hist={d.hist} worst={d.worst} ev={d.ev} pProfit={d.pProfit} best={d.best} />
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
