// Raw parlay edges — owner-only (canSeeOwnerTools). PREVIEW: read-only scanner.
// Flags Kalshi parlay RFQs where the best price traders paid was well worse than fair,
// so Kevin can sell raw (no promo, unhedged, +EV). No quoting or trading here:
// "Offer this" is a disabled placeholder. The API checks the owner again.
import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import { DEFAULT_EDGE_AMERICAN, fmtAmerican, etTime } from "./rawParlayEdges.js";

let client = null;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const DAY_CHIPS = [{ v: 1, label: "Today" }, { v: 3, label: "3 days" }, { v: 7, label: "7 days" }];
const dayLabel = (k) => {
  const d = new Date(k + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? k : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const OFFER_TITLE = "Coming later. This preview never quotes or trades.";

export default function RawParlayEdges({ user }) {
  const [days, setDays] = useState(1);
  const [edge, setEdge] = useState(String(DEFAULT_EDGE_AMERICAN));
  const [minCost, setMinCost] = useState("0");
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const load = useCallback(async () => {
    const c = supabase();
    if (!c) return setState({ loading: false, error: "Not configured", data: null });
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const qs = new URLSearchParams({ days: String(days), edge: String(Number(edge) || 0), minCost: String(Number(minCost) || 0) });
      const r = await fetch("/api/raw-parlay-edges?" + qs, { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && typeof j.error === "string" && j.error) || `Request failed (${r.status})`);
      setState({ loading: false, error: null, data: j });
    } catch (e) {
      setState({ loading: false, error: String((e && e.message) || e), data: null });
    }
  }, [days, edge, minCost]);

  useEffect(() => { if (canSeeOwnerTools(user)) load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canSeeOwnerTools(user)) return null;
  const d = state.data;
  return (
    <div className="raw-edges" data-raw-edges="true">
      <style>{`
        .raw-edges{color:#e5e7eb;font-size:13px}
        .raw-edges h2{font-size:18px;margin:0 0 4px}
        .raw-edges .sub{color:#9ca3af;margin-bottom:12px;max-width:900px}
        .raw-edges .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
        .raw-edges .chip{padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#e5e7eb;cursor:pointer}
        .raw-edges .chip.on{background:#1d4ed8;border-color:#1d4ed8}
        .raw-edges input{width:80px;background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 6px}
        .raw-edges table{border-collapse:collapse;width:100%}
        .raw-edges th,.raw-edges td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}
        .raw-edges th{color:#9ca3af;font-weight:500;white-space:nowrap}
        .raw-edges .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .raw-edges .pos{color:#4ade80}.raw-edges .neg{color:#f87171}.raw-edges .fair{color:#93c5fd}
        .raw-edges .legs div{white-space:nowrap}
        .raw-edges .tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
        .raw-edges .tile{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px;min-width:150px}
        .raw-edges .tile b{display:block;font-size:15px}
      `}</style>
      <h2>Raw parlay edges <span style={{ fontSize: 12, color: "#fbbf24" }}>Preview · only you</span></h2>
      <div className="sub">
        Kalshi parlay requests where the best price traders paid was well worse than fair. Selling raw at the suggested
        offer is +EV with no promo, but unhedged: you carry the full max loss if every leg wins. Read-only, nothing is quoted.
      </div>
      <div className="bar">
        {DAY_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (days === c.v ? " on" : "")} onClick={() => setDays(c.v)}>{c.label}</button>
        ))}
        <label>Offer = fair minus <input aria-label="Edge in American odds" inputMode="numeric" value={edge} onChange={(e) => setEdge(e.target.value)} /></label>
        <label>Min request $ <input aria-label="Minimum request size" inputMode="decimal" value={minCost} onChange={(e) => setMinCost(e.target.value)} /></label>
        <button type="button" className="chip" onClick={load} disabled={state.loading}>{state.loading ? "Scanning…" : "Scan"}</button>
      </div>
      {state.error && <div className="neg">{state.error}</div>}
      {d && (
        <>
          <div className="tiles">
            {d.days.map((x) => (
              <div className="tile" key={x.day}>
                <span style={{ color: "#9ca3af" }}>{dayLabel(x.day)}</span>
                <b>{x.count.toLocaleString()} edges</b>
                <span className={x.ev >= 0 ? "pos" : "neg"}>EV {usd(x.ev)}</span> · max loss {usd(x.maxLoss)}
              </div>
            ))}
            {!d.days.length && <div className="tile">No edges in this window</div>}
          </div>
          <div className="sub">
            Scanned {d.scanned.toLocaleString()} traded requests{d.truncated ? " (capped)" : ""}. Showing top {d.edges.length} of {d.total.toLocaleString()} by EV.
            {" "}Maker fee: {Object.entries(d.series || {}).map(([s, v]) => `${s} ${v.fee_type || "unknown"} (${v.rate})`).join(", ") || "—"}.
          </div>
          <table>
            <thead>
              <tr>
                <th>Time (ET)</th><th>Legs</th><th className="num">Fair</th><th className="num">Best trader price</th>
                <th className="num">Suggested offer</th><th className="num">EV / $100 risked</th><th className="num">EV</th>
                <th className="num">Max loss</th><th className="num">Size</th><th></th>
              </tr>
            </thead>
            <tbody>
              {d.edges.map((e) => (
                <tr key={e.rfq_id}>
                  <td style={{ whiteSpace: "nowrap" }}>{etTime(e.ts)}</td>
                  <td className="legs">{e.legs.map((l, i) => <div key={i}>{l}</div>)}</td>
                  <td className="num fair">{fmtAmerican(e.fairAmerican)}</td>
                  <td className="num">{fmtAmerican(e.bestTraderAmerican)}</td>
                  <td className="num">{fmtAmerican(e.offerAmerican)}</td>
                  <td className="num pos">{usd(e.evPer100)}</td>
                  <td className="num pos">{usd(e.ev)}</td>
                  <td className="num neg">{usd(e.maxLoss)}</td>
                  <td className="num">{Math.round(e.contracts).toLocaleString()} ct{e.requestedCost != null ? ` · ${usd(e.requestedCost)} req` : ""}</td>
                  <td><button type="button" className="chip" disabled title={OFFER_TITLE} style={{ opacity: 0.5, cursor: "not-allowed" }}>Offer this</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
