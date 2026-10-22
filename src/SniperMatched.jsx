// Sniper "Matched" — live filled sniper positions with the Combo Locks results toolkit: live needle,
// P&L distribution, why-it's-+EV bars, root-for lists (house view: we root AGAINST the legs),
// record / ROI / expected vs actual, cumulative P&L, breakdowns and per-leg / per-game tables.
import React, { useMemo, useState } from "react";
import SweatMeter from "./RootForSweat";
import PnlCurve from "./RootForCurve";
import EvBars from "./RootForEvBars";
import { topByGain, topByDrop } from "./rootForSimple";
import { americanFromProb, fmtAmerican, fmtUsd } from "./sniperDashboard.js";

const C = { surface: "#181818", head: "#1f1f1f", border: "#2a2a2a", gold: "#bc9e66", text: "#e4e0d8", text2: "#a8a49c", muted: "#8a8a8a", good: "#7cc49a", bad: "#d88c84", warn: "#e0a04a" };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const h2 = { color: C.gold, fontSize: 14, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", margin: "0 0 10px" };
const th = { textAlign: "left", padding: "6px 8px", color: C.text2, fontWeight: 600, fontSize: 12, borderBottom: `1px solid ${C.border}`, background: C.head, whiteSpace: "nowrap" };
const td = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #222", color: C.text, verticalAlign: "top" };
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x) => (x > 0 ? "+" : "") + fmtUsd(x);
const pnlColor = (x) => (x > 0 ? C.good : x < 0 ? C.bad : C.text);
const etTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—");
const statusColor = { won: C.good, lost: C.bad, open: C.gold, confirming: C.warn, void: C.muted };

function Stat({ label, value, sub, color }) {
  return (<div style={{ ...card, flex: "1 1 150px" }}><div style={{ color: C.text2, fontSize: 12 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 700, color: color || C.text, margin: "4px 0" }}>{value}</div>{sub && <div style={{ color: C.muted, fontSize: 11 }}>{sub}</div>}</div>);
}

function CumChart({ curve }) {
  if (!curve || curve.length < 1) return <div style={{ color: C.muted, fontSize: 12 }}>The chart starts after the first matched position settles.</div>;
  const W = 640, H = 180, P = 30; const pts = [{ pnl: 0, ev: 0 }, ...curve];
  const ys = pts.flatMap((p) => [p.pnl, p.ev]); const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1;
  const x = (i) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P); const y = (v) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W }} role="img" aria-label="Cumulative P&L">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#333" />
      <path d={line("ev")} stroke={C.muted} strokeDasharray="4 3" fill="none" strokeWidth="2" />
      <path d={line("pnl")} stroke={C.gold} fill="none" strokeWidth="2.5" />
      <text x={W - P} y={y(pts.at(-1).pnl) - 6} fill={C.gold} fontSize="11" textAnchor="end">Actual {signed(pts.at(-1).pnl)}</text>
      <text x={W - P} y={y(pts.at(-1).ev) + 14} fill={C.muted} fontSize="11" textAnchor="end">Expected {signed(pts.at(-1).ev)}</text>
      <text x={P} y={12} fill={C.text2} fontSize="11">{fmtUsd(hi)}</text><text x={P} y={H - 8} fill={C.text2} fontSize="11">{fmtUsd(lo)}</text>
    </svg>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div style={{ ...card, flex: "1 1 300px", overflowX: "auto" }}>
      <div style={h2}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["", "Bets", "W-L", "Open", "Risk", "P&L", "ROI", "Expected"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
        <tbody>{rows.map((g) => (
          <tr key={g.key}><td style={td}>{g.key}</td><td style={td}>{g.n}</td><td style={td}>{g.won}-{g.lost}</td><td style={td}>{g.open}</td><td style={td}>{fmtUsd(g.risk)}</td>
            <td style={{ ...td, color: pnlColor(g.pnl) }}>{signed(g.pnl)}</td><td style={td}>{pct(g.roi)}</td><td style={td}>{signed(g.ev)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// Plain-English result label (house view). TD events are yes/no on "player scores".
function friendly(o, tdNames) {
  const td = tdNames[String(o.event || "").toUpperCase()];
  if (td) return { label: o.outcome === "yes" ? `${td.who} scores a TD` : `${td.who} held without a TD`, game: td.game };
  return { label: `${o.name} win`, game: o.game };
}
function RootList({ title, items, word, good, tdNames }) {
  return (
    <div style={{ ...card, flex: "1 1 300px" }}>
      <div style={h2}>{title}</div>
      {items.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>Nothing big riding on one result right now.</div> : items.map((o) => (
        <div key={`${o.event}:${o.outcome}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "5px 0", borderBottom: "1px solid #222" }}>
          <span><b style={{ color: good ? C.good : C.bad }}>{word}{friendly(o, tdNames).label}</b><div style={{ color: C.muted, fontSize: 11 }}>{friendly(o, tdNames).game}{o.start ? ` · ${etTime(o.start)}` : ""} · {Math.round(o.p * 100)}% ({o.american != null ? fmtAmerican(o.american) : "—"})</div></span>
          <span style={{ color: good ? C.good : C.bad, fontWeight: 700, whiteSpace: "nowrap" }}>{signed(good ? o.gain : o.drop)}</span>
        </div>
      ))}
    </div>
  );
}

export default function SniperMatched({ data }) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => (data && data.rows ? data.rows.filter((r) => filter === "all" || (filter === "open" ? r.status === "open" || r.status === "confirming" : r.status === filter)) : []), [data, filter]);
  if (!data) return null;
  if (data.empty) {
    return (
      <div style={{ ...card, marginBottom: 14, textAlign: "center", padding: 28 }} data-testid="sniper-matched-empty">
        <div style={h2}>Matched</div>
        <div style={{ fontSize: 16, color: C.text }}>No sniper quotes have been matched yet.</div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Once a taker accepts and the fill confirms, the record, P&L, live needle and leg breakdowns show up here.</div>
      </div>
    );
  }
  const p = data.perf; const t = p.total; const root = data.root;
  const d = root ? { ...root, asOf: data.asOf, sweat: data.sweat } : null;
  const tdNames = {}; for (const r of data.rows) for (const l of r.legs) if (l.type === "td") tdNames[l.ticker] = { who: l.bet.replace(/ anytime TD.*$/, ""), game: `${l.game}${l.kickoff ? "" : ""}` };
  return (
    <div data-testid="sniper-matched" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}><h2 style={{ ...h2, fontSize: 18, margin: 0 }}>Matched</h2><span style={{ color: C.muted, fontSize: 12 }}>Live filled sniper positions. We're the house: we win when any leg loses.</span></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Record" value={`${t.won}-${t.lost}${t.void ? `-${t.void}` : ""}`} sub={`${t.open} open · ${t.n} matched`} />
        <Stat label="P&L (settled)" value={signed(t.pnl)} color={pnlColor(t.pnl)} sub={`Expected ${signed(t.settledEv)}`} />
        <Stat label="ROI" value={pct(t.roi)} sub={`on ${fmtUsd(t.settledRisk)} risked`} />
        <Stat label="Win rate" value={pct(t.winRate)} sub={`Expected ${t.won + t.lost ? pct(t.expectedWins / (t.won + t.lost + t.void)) : "—"}`} />
        <Stat label="Open risk" value={fmtUsd(data.rows.filter((r) => r.status === "open").reduce((a, r) => a + r.risk, 0))} sub={`To win ${fmtUsd(data.rows.filter((r) => r.status === "open").reduce((a, r) => a + r.toWin, 0))}`} />
        <Stat label="Expected (all)" value={signed(t.ev)} sub="Σ edge at the fair we sold at" />
      </div>
      {d && (
        <div style={{ ...card, marginBottom: 12, background: "#111" }}>
          <div style={h2}>Live needle · open positions</div>
          <SweatMeter d={d} legs={false} liveCol={false} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 420px" }}><PnlCurve hist={root.hist} worst={root.worst} ev={root.ev} pProfit={root.pProfit} best={root.best} xLabel="Sniper result on open positions ($)" unit="slates" /></div>
            <div style={{ flex: "1 1 280px" }}><EvBars hist={root.hist} ev={root.ev} pProfit={root.pProfit} worst={root.worst} /></div>
          </div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Best case {signed(root.best && root.best.pnl)} · worst case {signed(root.worst && root.worst.pnl)} · chance of profit {pct(root.pProfit, 0)}</div>
        </div>
      )}
      {d && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <RootList title="Best results to root for" word="Root for: " good tdNames={tdNames} items={topByGain(d, 6)} />
          <RootList title="Results that hurt us" word="" tdNames={tdNames} items={topByDrop(d, 6)} />
        </div>
      )}
      <div style={{ ...card, marginBottom: 12 }}><div style={h2}>Cumulative P&L · actual vs expected</div><CumChart curve={p.curve} /></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Breakdown title="By number of legs" rows={p.byLegs} />
        <Breakdown title="By market" rows={p.byMarket} />
        <Breakdown title="By edge" rows={p.byEdge} />
        <Breakdown title="By day (ET)" rows={p.byDay} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ ...card, flex: "2 1 520px", overflowX: "auto" }}>
          <div style={h2}>Legs across matched positions (we root against)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Leg", "Game", "Positions", "Risk tied", "Open", "W-L", "P&L", "Leg result"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
            <tbody>{p.legRows.slice(0, 40).map((l) => (
              <tr key={l.key}><td style={td}>{l.bet}<div style={{ color: C.muted, fontSize: 11 }}>{l.market}</div></td><td style={td}>{l.game}</td><td style={td}>{l.positions}</td><td style={td}>{fmtUsd(l.risk)}</td><td style={td}>{l.open}</td>
                <td style={td}>{l.won}-{l.lost}</td><td style={{ ...td, color: pnlColor(l.pnl) }}>{signed(l.pnl)}</td><td style={{ ...td, color: l.result ? (l.result.includes("good") ? C.good : C.bad) : C.muted }}>{l.result || "pending"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}><div style={h2}>Legs that beat us</div>{p.beatUs.length ? p.beatUs.map((l) => <div key={l.key} style={{ fontSize: 12, padding: "3px 0" }}>{l.bet} <span style={{ color: C.bad }}>({l.positions} pos, {fmtUsd(l.risk)})</span></div>) : <div style={{ color: C.muted, fontSize: 12 }}>None yet.</div>}</div>
          <div style={card}><div style={h2}>Legs that saved us</div>{p.savedUs.length ? p.savedUs.map((l) => <div key={l.key} style={{ fontSize: 12, padding: "3px 0" }}>{l.bet} <span style={{ color: C.good }}>({l.positions} pos, {fmtUsd(l.risk)})</span></div>) : <div style={{ color: C.muted, fontSize: 12 }}>None yet.</div>}</div>
        </div>
      </div>
      <Breakdown title="By game" rows={p.gameRows.slice(0, 20)} />
      <div style={{ ...card, marginTop: 12, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ ...h2, margin: 0 }}>Matched positions</div><span style={{ flex: 1 }} />
          {["all", "open", "won", "lost"].map((f) => <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? C.gold : C.head, color: filter === f ? "#17140f" : C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>{f}</button>)}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Filled", "Status", "Legs (bet · game · kickoff)", "Fair", "We got", "Edge", "Risk", "To win", "P&L"].map((x) => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.rfqId}>
              <td style={td}>{etTime(r.filledAt)}</td>
              <td style={{ ...td, color: statusColor[r.status] || C.text, fontWeight: 700, textTransform: "capitalize" }}>{r.status}</td>
              <td style={td}>{r.legs.map((l) => <div key={l.ticker + l.side}>{l.bet} <span style={{ color: C.muted }}>· {l.game}{l.kickoff ? ` · ${etTime(l.kickoff)}` : l.date ? ` · ${l.date}` : ""}</span>{l.result ? <span style={{ color: l.result === l.side ? C.bad : C.good }}> · {l.result === l.side ? "hit" : "missed"}</span> : null}</div>)}</td>
              <td style={td}>{fmtAmerican(americanFromProb(r.fairYes))}</td>
              <td style={{ ...td, color: C.gold }}>{fmtAmerican(americanFromProb(r.soldYes))}<div style={{ color: C.muted, fontSize: 11 }}>we hold No {fmtAmerican(americanFromProb(1 - r.soldYes))}</div></td>
              <td style={td}>{pct(r.edge)}</td><td style={td}>{fmtUsd(r.risk)}</td><td style={td}>{fmtUsd(r.toWin)}</td>
              <td style={{ ...td, color: r.pnl == null ? C.muted : pnlColor(r.pnl) }}>{r.pnl == null ? "—" : signed(r.pnl)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
