import React, { useState } from "react";
import { americanFromProb, fmtAmerican, fmtUsd } from "./sniperDashboard.js";

// Settled vs decided-but-unsettled vs live sniper fills (from /api/sniper-dashboard?matched=1 → breakdown).
const C = { surface: "#181818", head: "#1f1f1f", border: "#2a2a2a", gold: "#bc9e66", text: "#e4e0d8", muted: "#8a8a8a", good: "#7cc49a", bad: "#d88c84" };
const signed = (x) => `${x >= 0 ? "+" : "−"}${fmtUsd(Math.abs(x || 0))}`;
const col = (x) => (x > 0 ? C.good : x < 0 ? C.bad : C.text);
const LABEL = { allHit: "All legs hit (we lose, pending)", busted: "Leg lost (we win, pending)", live: "Live" };
const etTime = (iso) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " ET" : "time TBD");
const th = { textAlign: "left", padding: "6px 8px", color: C.muted, fontSize: 11, borderBottom: `1px solid ${C.border}` };
const td = { padding: "6px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text, verticalAlign: "top" };

function Box({ label, value, sub, color }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", minWidth: 150 }}>
    <div style={{ color: C.muted, fontSize: 11 }}>{label}</div><div style={{ fontSize: 18, fontWeight: 700, color: color || C.text }}>{value}</div><div style={{ color: C.muted, fontSize: 11 }}>{sub}</div></div>;
}
function Table({ title, groups }) {
  const keys = Object.keys(groups || {}).sort();
  if (!keys.length) return null;
  return <div style={{ marginTop: 10 }}><div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{title}</div>
    <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["", "Settled P&L", "Pending (decided)", "Live: cost / max win"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{keys.map((k) => { const g = groups[k]; const pend = g.busted.pnl + g.allHit.pnl; return <tr key={k}>
        <td style={td}>{k}</td>
        <td style={{ ...td, color: col(g.settled.pnl) }}>{signed(g.settled.pnl)} <span style={{ color: C.muted }}>({g.settled.n})</span></td>
        <td style={{ ...td, color: col(pend) }}>{signed(pend)} <span style={{ color: C.muted }}>({g.busted.n} won · {g.allHit.n} lost)</span></td>
        <td style={td}>{fmtUsd(g.live.cost)} / {fmtUsd(g.live.maxWin)} <span style={{ color: C.muted }}>({g.live.n})</span></td></tr>; })}</tbody></table></div>;
}

export default function SniperBreakdown({ data }) {
  const [show, setShow] = useState("allHit");
  const b = data && data.breakdown; if (!b) return null;
  const t = b.totals; const legsById = {}; for (const r of data.rows || []) legsById[r.rfqId] = r.legs || [];
  const legText = (id, k) => { const l = (legsById[id] || []).find((x) => `${x.ticker}:${x.side}`.toUpperCase() === String(k).toUpperCase() || String(k).toUpperCase().startsWith(String(x.ticker).toUpperCase())); return l ? `${l.bet || l.label}${l.kickoff ? ` · ${etTime(l.kickoff)}` : ""}` : String(k).split(":")[0]; };
  const list = b.positions.filter((p) => show === "all" || p.state === show);
  return <div data-testid="sniper-breakdown" style={{ marginBottom: 14 }}>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Box label="Settled P&L" value={signed(t.settled.pnl)} color={col(t.settled.pnl)} sub={`${t.settled.n} settled on Kalshi`} />
      <Box label="Decided, not settled" value={signed(t.busted.pnl + t.allHit.pnl)} color={col(t.busted.pnl + t.allHit.pnl)} sub={`${t.busted.n} busted (+${fmtUsd(t.busted.pnl)}) · ${t.allHit.n} all hit (−${fmtUsd(-t.allHit.pnl)})`} />
      <Box label="Settled + decided" value={signed(b.decidedPnl)} color={col(b.decidedPnl)} sub="what P&L becomes once Kalshi settles" />
      <Box label="Live" value={`${t.live.n} open`} sub={`${fmtUsd(t.live.cost)} at risk · max win ${fmtUsd(t.live.maxWin)}`} />
    </div>
    <Table title="By sport" groups={b.bySport} />
    <Table title="By fill day (ET)" groups={b.byDay} />
    <div style={{ display: "flex", gap: 6, margin: "10px 0 4px" }}>
      {[["allHit", `All hit (${t.allHit.n})`], ["busted", `Busted (${t.busted.n})`], ["live", `Live (${t.live.n})`], ["all", "All unsettled"]].map(([k, l]) =>
        <button key={k} onClick={() => setShow(k)} style={{ background: show === k ? C.gold : C.head, color: show === k ? "#17140f" : C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>)}
    </div>
    <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Filled", "Sport", "Sold at", "State", "Pending legs", "Cost", "Max win", "Max loss", "Pending P&L"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{list.map((p) => <tr key={p.rfqId}>
        <td style={td}>{etTime(p.createdAt)}<div style={{ color: C.muted, fontSize: 10 }}>{p.rfqId.slice(0, 8)}</div></td>
        <td style={td}>{p.sport}</td>
        <td style={{ ...td, color: C.gold }}>{fmtAmerican(americanFromProb(p.soldYes))}</td>
        <td style={td}>{LABEL[p.state]}</td>
        <td style={td}>{p.state === "live" ? p.pending.map((k) => <div key={k}>{legText(p.rfqId, k)}</div>) : p.state === "busted" ? <span style={{ color: C.muted }}>lost: {p.lost.map((k) => legText(p.rfqId, k)).join(", ")}</span> : "—"}</td>
        <td style={td}>{fmtUsd(p.cost)}</td><td style={td}>{fmtUsd(p.maxWin)}</td><td style={td}>{fmtUsd(p.maxLoss)}</td>
        <td style={{ ...td, color: col(p.pendingPnl) }}>{p.state === "live" ? "—" : signed(p.pendingPnl)}</td></tr>)}</tbody></table>
  </div>;
}
