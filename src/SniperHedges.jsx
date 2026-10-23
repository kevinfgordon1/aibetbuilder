// "Log hedge" for a sniper fill: record a manual sportsbook bet ON the parlay (arb-out). Pre-fills from the
// latest book_arb suggestion. Kevin only (API: /api/sniper-dashboard?hedge=1, requireOwner).
import React, { useState } from "react";
import { fmtAmerican, fmtUsd } from "./sniperDashboard.js";

const C = { border: "#2a2a2a", gold: "#bc9e66", text: "#e4e0d8", text2: "#a8a49c", muted: "#8a8a8a", good: "#7cc49a", bad: "#d88c84" };
const signed = (x) => (x > 0 ? "+" : "") + fmtUsd(x);
const pnlColor = (x) => (x > 0 ? C.good : x < 0 ? C.bad : C.text);
const inp = { background: "#111", color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, colorScheme: "dark" };
const btn = (gold) => ({ ...inp, cursor: "pointer", background: gold ? C.gold : "#1f1f1f", color: gold ? "#17140f" : C.text, fontWeight: 700 });
const etTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—");
const localInput = (iso) => { const d = iso ? new Date(iso) : new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Suggested hedge from the latest book_arb check (best book, its parlay price and the stake that locks it). */
export function hedgeSuggestion(r) {
  const b = r && r.bookArb && r.bookArb.books && r.bookArb.books.find((x) => x.arb);
  return b ? { book: b.label || b.book, american: b.american, stake: Math.round(Number(b.stake) * 100) / 100, locked: b.locked, source: "book_arb" } : null;
}

/** One-line status for the row: "Locked +$4.77" or "Hedged: worst −$12 / best +$30". */
export function hedgeLabel(h) {
  if (!h) return null;
  return h.locked ? `Locked ${signed(h.worst)}` : `Hedged: worst ${signed(h.worst)} / best ${signed(h.best)}`;
}

export function HedgeForm({ r, initial, onSave, onCancel }) {
  const sug = hedgeSuggestion(r);
  const s0 = initial || sug || {};
  const [book, setBook] = useState(s0.book || ""); const [american, setAmerican] = useState(s0.american != null ? String(s0.american) : "");
  const [stake, setStake] = useState(s0.stake != null ? String(s0.stake) : ""); const [placedAt, setPlacedAt] = useState(localInput(initial && initial.placed_at));
  const [notes, setNotes] = useState((initial && initial.notes) || ""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const a = Number(american);
  const valid = book.trim() && Number.isFinite(a) && (a >= 100 || a <= -100) && Number(stake) > 0;
  async function submit(e) {
    e.preventDefault(); if (!valid) { setErr("Book, odds (+100 or more / −100 or less) and stake are required"); return; }
    setBusy(true); setErr(null);
    try { await onSave({ book: book.trim(), american: Math.round(a), stake: Number(stake), placedAt: new Date(placedAt).toISOString(), notes: notes || null, source: !initial && sug && book.trim() === sug.book ? "book_arb" : "manual" }); }
    catch (x) { setErr(String(x.message || x)); } finally { setBusy(false); }
  }
  const lab = { display: "flex", flexDirection: "column", gap: 3, color: C.text2, fontSize: 11 };
  return (
    <form onSubmit={submit} data-testid="hedge-form" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
      <label style={lab}>Book<input value={book} onChange={(e) => setBook(e.target.value)} placeholder="FanDuel" style={{ ...inp, width: 110 }} /></label>
      <label style={lab}>Odds (American)<input value={american} onChange={(e) => setAmerican(e.target.value)} placeholder="+798" style={{ ...inp, width: 80 }} /></label>
      <label style={lab}>Stake ($)<input type="number" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} style={{ ...inp, width: 80 }} /></label>
      <label style={lab}>Placed<input type="datetime-local" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} style={inp} /></label>
      <label style={lab}>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inp, width: 160 }} /></label>
      <button type="submit" disabled={busy} style={btn(true)}>{busy ? "Saving…" : initial ? "Save" : "Log hedge"}</button>
      <button type="button" onClick={onCancel} style={btn(false)}>Cancel</button>
      {!initial && sug ? <div style={{ color: C.muted, fontSize: 11, width: "100%" }}>Pre-filled from the latest arb check: {sug.book} {fmtAmerican(sug.american)}, {fmtUsd(sug.stake)} locks about {fmtUsd(sug.locked)}. Change it to what you actually bet.</div> : null}
      {err ? <div style={{ color: C.bad, fontSize: 12, width: "100%" }}>{err}</div> : null}
    </form>
  );
}

export default function HedgePanel({ r, api }) {
  const [mode, setMode] = useState(null); // null | 'new' | hedge id
  const hs = r.hedges || []; const h = r.hedge;
  const box = { background: "#111", border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, flex: "1 1 100%" };
  const save = async (body) => { if (mode === "new") await api("POST", "", { rfqId: r.rfqId, ...body }); else await api("PATCH", `&id=${mode}`, body); setMode(null); };
  const del = async (id) => { if (window.confirm("Delete this hedge? The fill goes back to unhedged risk.")) await api("DELETE", `&id=${id}`); };
  return (
    <div data-testid="hedge-panel" style={box} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ color: C.gold, fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>My hedges {h ? <span style={{ color: h.locked ? C.good : C.gold }}>· {hedgeLabel(h)}</span> : null}</div>
        {r.status === "open" && mode == null ? <button type="button" style={btn(true)} onClick={() => setMode("new")}>Log hedge</button> : null}
      </div>
      {hs.length === 0 && mode == null ? <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>No hedge logged. If you bet this parlay at a book, log it so P&L and the sniper's caps count it.</div> : null}
      {hs.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr>{["Book", "Odds", "Stake", "Pays if parlay hits", "Placed", "Notes", "Status", ""].map((x) => <th key={x} style={{ textAlign: "left", padding: "4px 6px", color: C.text2, fontSize: 11, borderBottom: `1px solid ${C.border}` }}>{x}</th>)}</tr></thead>
          <tbody>{hs.map((x) => {
            const dec = x.american > 0 ? 1 + x.american / 100 : 1 + 100 / -x.american;
            const c = { padding: "4px 6px", fontSize: 12, color: x.status === "void" ? C.muted : C.text };
            return (<tr key={x.id}><td style={c}>{x.book}</td><td style={c}>{fmtAmerican(x.american)}</td><td style={c}>{fmtUsd(x.stake)}</td><td style={c}>{fmtUsd(x.stake * dec)}</td><td style={c}>{etTime(x.placed_at)}</td><td style={c}>{x.notes || ""}</td><td style={c}>{x.status === "void" ? "void (refunded)" : "active"}</td>
              <td style={c}><button type="button" style={btn(false)} onClick={() => setMode(x.id)}>Edit</button> <button type="button" style={btn(false)} onClick={() => api("PATCH", `&id=${x.id}`, { status: x.status === "void" ? "active" : "void" })}>{x.status === "void" ? "Un-void" : "Void"}</button> <button type="button" style={{ ...btn(false), color: C.bad }} onClick={() => del(x.id)}>Delete</button></td></tr>);
          })}</tbody>
        </table>
      )}
      {mode != null && <HedgeForm r={r} initial={mode === "new" ? null : hs.find((x) => x.id === mode)} onSave={save} onCancel={() => setMode(null)} />}
      {h ? (
        <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          If the parlay <b>hits</b>: Kalshi −{fmtUsd(r.risk)} + book {signed(h.hitDelta)} = <b style={{ color: pnlColor(h.hit) }}>{signed(h.hit)}</b> · If it <b>misses</b>: Kalshi {signed(r.toWin)} − book {fmtUsd(h.stake)} = <b style={{ color: pnlColor(h.miss) }}>{signed(h.miss)}</b>
          <div style={{ color: C.muted, fontSize: 11 }}>{h.locked ? "Locked: same profit either way." : "Partly hedged: worst and best case shown."} The sniper counts this fill at {fmtUsd(h.netRisk)} worst-case loss instead of {fmtUsd(r.risk)}, freeing {fmtUsd(Math.max(0, h.freed))} of cap room. If the book voids a leg (e.g. a player is inactive) its payout changes — mark the hedge Void or edit it.</div>
        </div>
      ) : null}
    </div>
  );
}
