// Sniper dashboard — owner-only (canSeeOwnerTools). Read-only view of the isolated Combo Sniper
// service (sniper_ledger / sniper_decisions) via /api/sniper-dashboard. No trading controls.
import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { fmtAmerican, fmtUsd, takerSeesAmerican } from "./sniperDashboard.js";
import SniperMatched, { MyFills } from "./SniperMatched";
import RootFor from "./RootFor";

let client = null;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key); return client;
}
const C = { bg: "#141414", surface: "#181818", head: "#1f1f1f", border: "#2a2a2a", gold: "#bc9e66", text: "#e4e0d8", text2: "#a8a49c", muted: "#8a8a8a", good: "#7cc49a", bad: "#d88c84", warn: "#e0a04a" };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const h2 = { color: C.gold, fontSize: 14, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", margin: "0 0 10px" };
const th = { textAlign: "left", padding: "6px 8px", color: C.text2, fontWeight: 600, fontSize: 12, borderBottom: `1px solid ${C.border}`, background: C.head, whiteSpace: "nowrap" };
const td = { padding: "6px 8px", fontSize: 12, borderBottom: `1px solid #222`, color: C.text, verticalAlign: "top" };
const etTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—");
const legLabel = (l) => { const [t, side] = String(l).split(":"); const p = t.split("-"); const pick = p[p.length - 1]; return `${t.startsWith("KXNFLTD") ? "TD " : ""}${pick}${side === "no" ? " (No)" : ""} · ${p[1] || ""}`; };
const stateColor = (s) => (s === "won" ? C.good : s === "lost" ? C.bad : s === "filled" ? C.gold : s === "cancelled" || s === "declined" ? C.muted : C.text);

function Meter({ label, value, cap, note }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  const col = pct >= 90 ? C.bad : pct >= 70 ? C.warn : C.gold;
  return (
    <div style={{ ...card, flex: "1 1 200px" }}>
      <div style={{ color: C.text2, fontSize: 12 }}>{label}</div>
      <div style={{ color: C.text, fontSize: 20, fontWeight: 700, margin: "4px 0" }}>{fmtUsd(value)} <span style={{ color: C.muted, fontSize: 12, fontWeight: 500 }}>/ {fmtUsd(cap)}</span></div>
      <div style={{ height: 6, background: "#222", borderRadius: 3 }}><div style={{ width: `${pct}%`, height: 6, background: col, borderRadius: 3 }} /></div>
      {note && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

// Risk by game: toggle between real fills only and fills + live quotes (what the per-game cap counts).
function RiskByGame({ r, caps, labels }) {
  const [view, setView] = useState("filled");
  const filled = r.filledGames || [];
  const rows = view === "filled" ? filled : r.games;
  if (!filled.length && !r.games.length) return null;
  const capLine = view === "all";
  const scale = capLine ? caps.perGame : Math.max(caps.perGame, ...rows.map((g) => g.risk), 1);
  return (
    <div style={{ ...card, marginBottom: 14 }} data-testid="risk-by-game">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ ...h2, margin: 0 }}>{view === "filled" ? "Filled risk by game" : "Filled + open quotes by game"}</div>
        <span style={{ flex: 1 }} />
        {[["filled", "Filled"], ["all", "Filled + open quotes"]].map(([k, l]) => <button key={k} onClick={() => setView(k)} style={{ background: view === k ? C.gold : C.head, color: view === k ? "#17140f" : C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>)}
      </div>
      <div style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>{view === "filled" ? `Money at risk on live fills that haven't settled (a parlay counts in every game it touches)` : `Fills plus live quotes waiting on a buyer — what the ${fmtUsd(caps.perGame)} per-game cap counts`}</div>
      {rows.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>{view === "filled" ? "No unsettled fills." : "No open risk."}</div>}
      {rows.slice(0, 12).map((g) => (
        <div key={g.game} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "4px 0" }}>
          <span style={{ width: 230, color: C.text2 }}>{labels[g.game] || g.game}</span>
          <div style={{ flex: 1, height: 8, background: "#222", borderRadius: 4, position: "relative" }}>
            <div style={{ width: `${Math.min(100, (g.risk / scale) * 100)}%`, height: 8, background: capLine && g.risk >= caps.perGame * 0.9 ? C.bad : C.gold, borderRadius: 4 }} />
            {capLine && <div title={`${fmtUsd(caps.perGame)} per-game cap`} style={{ position: "absolute", right: 0, top: -3, width: 2, height: 14, background: C.bad }} />}
          </div>
          <span style={{ width: 120, textAlign: "right" }}>{capLine ? `${fmtUsd(g.risk)} / ${fmtUsd(caps.perGame)}` : fmtUsd(g.risk)}</span>
        </div>
      ))}
      {capLine && rows.length > 0 && <div style={{ color: C.muted, fontSize: 11, marginTop: 6, textAlign: "right" }}><span style={{ display: "inline-block", width: 2, height: 10, background: C.bad, marginRight: 4, verticalAlign: "middle" }} />{fmtUsd(caps.perGame)} per-game cap</div>}
    </div>
  );
}

export default function SniperDashboard({ user }) {
  const [book, setBook] = useState("auto");
  const [data, setData] = useState(null); const [matched, setMatched] = useState(null); const [matchedErr, setMatchedErr] = useState(null); const [onlyMatched, setOnlyMatched] = useState(false); const [tab, setTab] = useState("fills"); const [err, setErr] = useState(null); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    const c = supabase(); if (!c) { setErr("Supabase not configured"); return; }
    setLoading(true);
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) { setErr("Sign in required"); return; }
      fetch(`/api/sniper-dashboard?matched=1`, { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } }).then(async (x) => { const m = await x.json().catch(() => null); if (m && m.ok) { setMatched(m); setMatchedErr(null); } else throw new Error((m && m.error) || `HTTP ${x.status}`); }).catch((e) => setMatchedErr(String((e && e.message) || e)));
      const r = await fetch(`/api/sniper-dashboard?book=${book}&days=7`, { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j); setErr(null);
    } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
  }, [book]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  // Hedge writes (Log / edit / void / delete) then reload so totals, root-for and caps reflect it.
  const hedgeApi = useCallback(async (method, qs = "", body) => {
    const c = supabase(); const { data: { session } } = await c.auth.getSession();
    if (!session) throw new Error("Sign in required");
    const r = await fetch(`/api/sniper-dashboard?hedge=1${qs}`, { method, headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer " + session.access_token }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await load(); return j;
  }, [load]);

  const s = data && data.status; const r = data && data.risk; const caps = (data && data.caps) || {};
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "70vh", padding: 16, borderRadius: 12 }} data-testid="sniper-dashboard">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ color: C.gold, fontSize: 22, margin: 0 }}>Sniper</h1>
        {s && <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: s.mode === "live" ? C.bad : C.head, color: s.mode === "live" ? "#17140f" : C.gold, border: `1px solid ${C.gold}` }}>{s.mode === "live" ? "LIVE" : s.mode === "dry" ? "TEST MODE" : "MODE UNKNOWN"}</span>}
        {s && s.halted && <span style={{ color: C.bad, fontWeight: 700, fontSize: 12 }}>HALTED</span>}
        {s && <span style={{ color: s.stale ? C.warn : C.text2, fontSize: 12 }}>Last update {etTime(s.lastSummaryAt)}{s.stale ? " (stale)" : ""}</span>}
        {s && s.kickoffs && <span style={{ color: C.text2, fontSize: 12 }}>Kickoffs: ESPN {s.kickoffs.espn ?? 0} · odds {s.kickoffs.odds ?? 0} · fallback {s.kickoffs.fallbacks ?? 0}</span>}
        <span style={{ flex: 1 }} />
        <select value={book} onChange={(e) => setBook(e.target.value)} style={{ background: C.head, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
          <option value="auto">Auto</option><option value="live">Live book</option><option value="dry">Test book</option>
        </select>
        <button onClick={load} disabled={loading} style={{ background: C.gold, color: "#17140f", border: 0, borderRadius: 6, padding: "5px 12px", fontWeight: 700, cursor: "pointer" }}>{loading ? "…" : "Refresh"}</button>
      </div>
      {err && <div style={{ ...card, color: C.bad, marginBottom: 12 }}>{err}</div>}
      {!data && !err && <div style={{ color: C.muted }}>Loading…</div>}
      {matchedErr && <div style={{ ...card, color: C.bad, marginBottom: 12 }} data-testid="sniper-matched-error">Couldn't load My Fills / What to root for{matched ? " (showing last good data)" : ""}: {matchedErr}. It retries on the next refresh.</div>}
      {matched && (
        <div>
          <div style={{ display: "flex", gap: 6, margin: "0 0 10px" }}>
            {[["fills", "My Fills"], ["root", "What to root for"], ["results", "Results"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? C.gold : "#1f1f1f", color: tab === k ? "#17140f" : C.text, border: "1px solid #2a2a2a", borderRadius: 6, padding: "5px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{l}</button>)}
          </div>
          {tab === "fills" ? <MyFills data={matched} api={hedgeApi} /> : tab === "root" ? <RootFor user={user} apiUrl="/api/sniper-dashboard?rootfor=1" noun="fills" defaultOpen /> : <SniperMatched data={matched} />}
        </div>
      )}
      {data && (
        <>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>Showing the {data.book === "live" ? "live" : "test-mode"} book. Rules: max {fmtUsd(caps.perQuoteRisk)} risk per quote; min edge after fees {Math.round((caps.minEdge || 0) * 100)}% moneylines, 4% other NFL, 5% college and NBA, 6% TDs; depth per leg {fmtUsd(caps.depthGame)} game lines / {fmtUsd(caps.depthTd)} TDs (measured as potential profit); NFL, college football and NBA; no repeat parlays.</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <Meter label="Open risk" value={r.open} cap={caps.totalOpen} note={`Max ${fmtUsd(caps.longDatedOpen)} on parlays settling more than 32h out`} />
            <Meter label="Biggest game" value={r.maxGame ? r.maxGame.risk : 0} cap={caps.perGame} note={r.maxGame ? ((data.gameLabels || {})[r.maxGame.game] || r.maxGame.game) : "No open games"} />
            <Meter label="Today's loss" value={r.dayLoss} cap={caps.dailyLoss} note={`P&L today ${fmtUsd(r.dayPnl)}`} />
            <div style={{ ...card, flex: "1 1 200px" }}>
              <div style={{ color: C.text2, fontSize: 12 }}>Risk opened today</div>
              <div style={{ fontSize: 20, fontWeight: 700, margin: "4px 0" }}>{fmtUsd(r.dayRisk)}</div>
              <div style={{ color: C.text2, fontSize: 12 }}>Running P&L <b style={{ color: r.runningPnl >= 0 ? C.good : C.bad }}>{fmtUsd(r.runningPnl)}</b></div>
            </div>
          </div>
          <RiskByGame r={r} caps={caps} labels={data.gameLabels || {}} />
          <div style={{ ...card, marginBottom: 14, overflowX: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={h2}>Quotes, fills & results</div><span style={{ flex: 1 }} />
              <label style={{ color: C.text2, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} /> Matched only</label></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Time", "Status", "Legs", "Fair", "We offer", "Taker sees", "Edge", "Size", "Risk", "Fill", "Result / P&L"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
              <tbody>
                {(onlyMatched ? data.quotes.filter((q) => q.filledContracts > 0 || ["filled", "won", "lost", "accepted"].includes(q.state)) : data.quotes).length === 0 && <tr><td style={{ ...td, color: C.muted }} colSpan={11}>No quotes in the last 7 days.</td></tr>}
                {(onlyMatched ? data.quotes.filter((q) => q.filledContracts > 0 || ["filled", "won", "lost", "accepted"].includes(q.state)) : data.quotes).map((q) => (
                  <tr key={q.rfqId}>
                    <td style={td}>{etTime(q.createdAt)}</td>
                    <td style={{ ...td, color: stateColor(q.state), fontWeight: 600 }}>{q.state}{q.pulledReason ? <div style={{ color: C.warn, fontSize: 11 }}>pulled: {q.pulledReason === "game_started" ? "at kickoff" : q.pulledReason}</div> : null}</td>
                    <td style={td}>{q.legs.map((l) => { const li = (data.legInfo || {})[l]; return <div key={l} style={{ marginBottom: 2 }}>{li ? <><span style={{ color: C.text }}>{li.bet}</span><span style={{ color: C.muted }}> · {li.game}</span></> : legLabel(l)}</div>; })}</td>
                    <td style={td}>{fmtAmerican(q.fairAmerican)}</td>
                    <td style={{ ...td, color: C.gold }}>{fmtAmerican(q.quoteAmerican)}</td>
                    <td style={td} title="Buyer's odds after Kalshi taker fee">{fmtAmerican(q.quoteYes ? takerSeesAmerican(q.quoteYes, q.contracts) : null)}</td>
                    <td style={td}>{q.edge == null ? "—" : `${(q.edge * 100).toFixed(1)}%`}</td>
                    <td style={td}>{q.contracts}</td>
                    <td style={td}>{fmtUsd(q.risk)}</td>
                    <td style={td}>{q.filledContracts ? `${q.filledContracts} @ ${fmtUsd(q.filledCost + q.filledFee)}` : "—"}</td>
                    <td style={{ ...td, color: q.pnl == null ? C.text : q.pnl >= 0 ? C.good : C.bad }}>{q.pnl == null ? (q.result || "—") : `${q.result || ""} ${fmtUsd(q.pnl)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...card, flex: "1 1 320px" }}>
              <div style={h2}>Daily P&L</div>
              {r.days.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>Nothing settled yet.</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Day", "W-L", "P&L", "Running"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
                  <tbody>{[...r.days].reverse().map((d) => (
                    <tr key={d.day}><td style={td}>{d.day}</td><td style={td}>{d.wins}-{d.losses}</td>
                      <td style={{ ...td, color: d.pnl >= 0 ? C.good : C.bad }}>{fmtUsd(d.pnl)}</td><td style={{ ...td, color: d.running >= 0 ? C.good : C.bad }}>{fmtUsd(d.running)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div style={{ ...card, flex: "2 1 480px", overflowX: "auto" }}>
              <div style={h2}>Why it skipped (last 24h, per hour)</div>
              {data.skips.hours.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>No summaries yet.</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th}>Hour (ET)</th>{data.skips.reasons.map((x) => <th key={x} style={th}>{x.replace(/_/g, " ")}</th>)}</tr></thead>
                  <tbody>{[...data.skips.hours].reverse().slice(0, 24).map((h) => (
                    <tr key={h.hour}><td style={td}>{h.hour.slice(5)}</td>{data.skips.reasons.map((x) => <td key={x} style={{ ...td, color: h[x] ? C.text : C.muted }}>{h[x].toLocaleString()}</td>)}</tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
