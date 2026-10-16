// Combo Sniper — owner-only (canSeeOwnerTools). PREVIEW: read-only scanner.
// Flags Kalshi parlay RFQs where the best price traders paid was well worse than fair,
// so Kevin can sell raw (no promo, unhedged, +EV). No quoting or trading here:
// "Offer this" is a disabled placeholder. The API checks the owner again.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import {
  DEFAULT_EDGE_AMERICAN,
  DEFAULT_SORT,
  SORT_KEYS,
  fmtAmerican,
  etTime,
  sortRawEdges,
} from "./rawParlayEdges.js";

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
const VENUE_CHIPS = [{ v: "all", label: "All venues" }, { v: "kalshi", label: "Kalshi" }, { v: "polymarket", label: "Polymarket" }];
const MARKET_CHIPS = [{ v: "all", label: "All" }, { v: "ml", label: "Moneylines" }, { v: "td", label: "Player TDs" }];
const DAY_CHIPS = [{ v: 1, label: "Today" }, { v: 3, label: "3 days" }, { v: 7, label: "7 days" }];
const dayLabel = (k) => {
  const d = new Date(k + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? k : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const OFFER_TITLE = "Coming later. This preview never quotes or trades.";
const SORT_OPTS = [
  { key: SORT_KEYS.margin, label: "Profit margin" },
  { key: SORT_KEYS.ev, label: "Total EV" },
  { key: SORT_KEYS.size, label: "Size" },
];

const TIP = {
  fair: "Fair odds, legs multiplied together. Moneyline legs, Inverse bet (live, default): 1 minus the implied chance of the best opposing price, $500 deep, fees included, from the live Kalshi, Polymarket US, Novig and ProphetX books; any source older than 15 seconds is dropped. Kalshi mid: the Kalshi bid/ask midpoint only. Promo: the same inverse-bet true odds as the Promo / boost calculator: 1 minus the implied chance of the best opposing price across the trusted sportsbooks and exchanges in our odds feed, which refreshes about every 5 minutes. Rows whose sportsbook data is over 6 minutes old are skipped. Polymarket requests use the same fairs, with each leg mapped to the same NFL game. Player TD legs: Kalshi Yes vs No devigged at $500 of depth on each side (fee included).",
  mm: "The price the winning market maker quoted, before the taker's fee. Polymarket: the anonymous RFQ trade print matched to this request.",
  got: "What the taker actually paid all-in, after Kalshi's taker fee (0.07 × contracts × price × (1 − price), rounded up to the cent on the whole order). Polymarket: combo taker fee contracts × price × (0.0695 × (1 − price) + 0.06 × (1 − price)^4), rounded up to the cent.",
  sell: "The price we'd actually receive selling YES on the venue's price grid, after our maker fee (Kalshi: series rate, currently $0; Polymarket combos: $0) and rounding. EV is computed from this price.",
  gets: "What the taker would pay all-in at our quote, after their Kalshi or Polymarket fee and rounding. Must beat 'Taker got' to win the request.",
  margin: "EV per $100 we put up, from the 'We sell at' price.",
  ev: "Expected profit on the whole order: chance every leg loses × contracts − what we put up.",
  loss: "What we put up (exact, rounded): lost if every leg wins.",
};
const ASSUME = "Assumes we'd have filled every flagged row in this set.";
const RISK_TIP = {
  handle: "Handle: total the takers would stake with us (their all-in cost at our price). " + ASSUME,
  sum: "Sum of max losses: each parlay's max loss added up, as if every one could hit at once. Overstates risk when parlays share games. " + ASSUME,
  worst: "True worst case: our net P&L in the single worst combination of game results — we lose payout minus premium on parlays that hit and keep the premium on the ones that miss. Opposite teams in one game can't both win; shared legs counted once. Solved exactly (not sampled). Ties ignored. Chance uses fair per-game win probabilities fitted from that day's parlay fairs, independent across games. " + ASSUME,
  best: "Best case: our P&L in the most favorable combination of results (usually: every parlay misses, keep all premium). " + ASSUME,
  ev: "EV doesn't change with correlation — it's just the sum of each row's EV. ± is the exact standard deviation of the day's P&L, including correlation from shared games. P&L is very skewed for long-shot parlays (many small wins, rare big losses), so the 2 SD range is not symmetric in likelihood. " + ASSUME,
};
const pct = (p) => {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  if (v === 0) return "0%";
  if (v < 0.01) return "<0.01%";
  return (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0)) + "%";
};
function RiskLines({ r, ev }) {
  if (!r) return null;
  const sd = r.sd;
  return (
    <div className="risk">
      <div title={RISK_TIP.handle}>Handle {usd(r.handle)}</div>
      <div title={RISK_TIP.sum}>Sum of max losses <span className="neg">{usd(-r.sumMaxLoss)}</span></div>
      <div title={RISK_TIP.worst}>True worst case {r.worstCase != null ? <span className="neg">{usd(r.worstCase)}</span> : "—"}
        {r.pWorst != null && ` (${pct(r.pWorst)} chance)`}{r.pLoss != null && ` · Chance of losing day: ${pct(r.pLoss)}`}</div>
      <div title={RISK_TIP.best}>Best case {r.bestCase != null ? <span className="pos">{usd(r.bestCase)}</span> : "—"}</div>
      <div title={RISK_TIP.ev}><span className={ev >= 0 ? "pos" : "neg"}>EV {usd(ev)}</span>{sd != null && ` ± ${usd(sd)} (2 SD range: ${usd(ev - 2 * sd)} to ${usd(ev + 2 * sd)})`}</div>
      {r.note && <div className="note">{r.note}</div>}
    </div>
  );
}

export default function RawParlayEdges({ user }) {
  const [days, setDays] = useState(1);
  const [edge, setEdge] = useState(String(DEFAULT_EDGE_AMERICAN));
  const [minCost, setMinCost] = useState("0");
  const [market, setMarket] = useState("all");
  const [fairSrc, setFairSrc] = useState("pm");
  const [venue, setVenue] = useState("all");
  const [sortKey, setSortKey] = useState(DEFAULT_SORT);
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const load = useCallback(async () => {
    const c = supabase();
    if (!c) return setState({ loading: false, error: "Not configured", data: null });
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const qs = new URLSearchParams({ days: String(days), edge: String(Number(edge) || 0), minCost: String(Number(minCost) || 0), market, fair: fairSrc, venue });
      const r = await fetch("/api/raw-parlay-edges?" + qs, { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && typeof j.error === "string" && j.error) || `Request failed (${r.status})`);
      setState({ loading: false, error: null, data: j });
    } catch (e) {
      setState({ loading: false, error: String((e && e.message) || e), data: null });
    }
  }, [days, edge, minCost, market, fairSrc, venue]);

  useEffect(() => { if (canSeeOwnerTools(user)) load(); }, [days, market, fairSrc, venue]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = useMemo(() => sortRawEdges(state.data && state.data.edges, sortKey), [state.data, sortKey]);

  if (!canSeeOwnerTools(user)) return null;
  const d = state.data;
  const thSort = (key, label, className, tip) => (
    <th
      className={(className || "") + " sortable" + (sortKey === key ? " on" : "")}
      onClick={() => setSortKey(key)}
      title={(tip ? tip + " " : "") + `Click to sort by ${label} (highest first).`}
      role="columnheader"
      aria-sort={sortKey === key ? "descending" : "none"}
    >
      {label}{sortKey === key ? " ↓" : ""}
    </th>
  );
  return (
    <div className="raw-edges" data-raw-edges="true">
      <style>{`
        .raw-edges{color:#e5e7eb;font-size:13px}
        .raw-edges h2{font-size:18px;margin:0 0 4px}
        .raw-edges .sub{color:#9ca3af;margin-bottom:12px;max-width:900px}
        .raw-edges .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
        .raw-edges .chip{padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#e5e7eb;cursor:pointer}
        .raw-edges .chip.on{background:#1d4ed8;border-color:#1d4ed8}
        .raw-edges input,.raw-edges select{background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 6px}
        .raw-edges input{width:80px}
        .raw-edges select{min-width:140px}
        .raw-edges table{border-collapse:collapse;width:100%}
        .raw-edges th,.raw-edges td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}
        .raw-edges th{color:#9ca3af;font-weight:500;white-space:nowrap}
        .raw-edges th.sortable{cursor:pointer;user-select:none}
        .raw-edges th.sortable:hover{color:#e5e7eb}
        .raw-edges th.sortable.on{color:#93c5fd}
        .raw-edges .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .raw-edges .rank{width:2.5em;color:#9ca3af;font-variant-numeric:tabular-nums}
        .raw-edges .pos{color:#4ade80}.raw-edges .neg{color:#f87171}.raw-edges .fair{color:#93c5fd}
        .raw-edges .legs div{white-space:nowrap}
        .raw-edges .legs div.td{color:#fbbf24}
        .raw-edges .vtag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;margin-bottom:2px}
        .raw-edges .vtag.kalshi{background:rgba(16,185,129,.15);color:#6ee7b7}.raw-edges .vtag.polymarket{background:rgba(59,130,246,.18);color:#93c5fd}
        .raw-edges .tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
        .raw-edges .tile{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px;min-width:150px}
        .raw-edges .tile b{display:block;font-size:15px}
        .raw-edges .risk div{white-space:nowrap;cursor:help}.raw-edges .risk .note{color:#fbbf24;white-space:normal;max-width:320px}
      `}</style>
      <h2>Combo Sniper <span style={{ fontSize: 12, color: "#fbbf24" }}>Preview · only you</span></h2>
      <div className="sub">
        Ranked Kalshi and Polymarket parlay requests we could have filled +EV — traders paid well worse than fair. Selling raw at the
        "We sell at" price is +EV with no promo, but unhedged: you carry the full max loss if every leg wins. Read-only, nothing is quoted.
      </div>
      <div className="bar">
        {DAY_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (days === c.v ? " on" : "")} onClick={() => setDays(c.v)}>{c.label}</button>
        ))}
        <span style={{ width: 8 }} />
        {MARKET_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (market === c.v ? " on" : "")} onClick={() => setMarket(c.v)}>{c.label}</button>
        ))}
        <span style={{ width: 8 }} />
        {VENUE_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (venue === c.v ? " on" : "")} onClick={() => setVenue(c.v)}>{c.label}</button>
        ))}
        <label title={TIP.fair}>Fair{" "}
          <select aria-label="Fair source" value={fairSrc} onChange={(e) => setFairSrc(e.target.value)}>
            <option value="pm">Inverse bet (live)</option>
            <option value="kalshi">Kalshi mid</option>
            <option value="promo">Promo (odds feed, 5 min)</option>
          </select>
        </label>
        <label>Offer = fair minus <input aria-label="Edge in American odds" inputMode="numeric" value={edge} onChange={(e) => setEdge(e.target.value)} /></label>
        <label>Min request $ <input aria-label="Minimum request size" inputMode="decimal" value={minCost} onChange={(e) => setMinCost(e.target.value)} /></label>
        <label>Sort by{" "}
          <select aria-label="Sort by" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {SORT_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
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
                {x.risk ? <RiskLines r={x.risk} ev={x.ev} /> : <><span className={x.ev >= 0 ? "pos" : "neg"}>EV {usd(x.ev)}</span> · sum of max losses {usd(x.maxLoss)}</>}
              </div>
            ))}
            {d.risk && d.days.length > 1 && (
              <div className="tile" key="all">
                <span style={{ color: "#9ca3af" }}>All shown ({DAY_CHIPS.find((c) => c.v === days)?.label || ""})</span>
                <b>{d.total.toLocaleString()} edges</b>
                <RiskLines r={d.risk} ev={d.risk.ev} />
              </div>
            )}
            {!d.days.length && <div className="tile">No edges in this window</div>}
          </div>
          <div className="sub">
            Scanned {d.scanned.toLocaleString()} traded requests{d.truncated ? " (capped)" : ""}. Showing top {ranked.length} of {d.total.toLocaleString()} ranked by {SORT_OPTS.find((o) => o.key === sortKey)?.label || "Profit margin"}.
            {" "}Maker fee: {Object.entries(d.series || {}).map(([s, v]) => `${s} ${v.fee_type || "unknown"} (${v.rate})`).join(", ") || "—"}.
          </div>
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Time (ET)</th><th>Legs</th><th className="num" title={TIP.fair}>Fair</th><th className="num" title={TIP.mm}>Winning MM quote</th>
                <th className="num" title={TIP.got}>Taker got (after fee)</th>
                <th className="num" title={TIP.sell}>We sell at</th>
                <th className="num" title={TIP.gets}>Taker gets</th>
                {thSort(SORT_KEYS.margin, "EV / $100 risked", "num", TIP.margin)}
                {thSort(SORT_KEYS.ev, "EV", "num", TIP.ev)}
                <th className="num" title={TIP.loss}>Max loss</th>
                {thSort(SORT_KEYS.size, "Size", "num")}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((e, i) => (
                <tr key={e.rfq_id}>
                  <td className="rank">{i + 1}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{etTime(e.ts)}</td>
                  <td className="legs"><span className={"vtag " + (e.venue || "kalshi")}>{e.venue === "polymarket" ? "Polymarket" : "Kalshi"}</span>{e.legs.map((l, j) => <div key={j} className={e.legIsTd && e.legIsTd[j] ? "td" : undefined}>{l}</div>)}</td>
                  <td className="num fair" title={e.kalshiFairAmerican != null ? `Kalshi-only fair ${fmtAmerican(e.kalshiFairAmerican)}` : undefined}>{fmtAmerican(e.fairAmerican)}</td>
                  <td className="num" title={`Maker sold YES at $${e.winningMmYes}`}>{fmtAmerican(e.winningMmAmerican)}</td>
                  <td className="num" title={`Taker paid ${usd(e.takerGotCost)} for ${e.contracts} contracts, fee included`}>{fmtAmerican(e.takerGotAmerican)}</td>
                  <td className="num pos" title={`We sell YES at $${e.weSellYes}: receive ${usd(e.weReceive)}, put up ${usd(e.maxLoss)}${e.makerFee ? `, maker fee ${usd(e.makerFee)}` : ", no maker fee"}`}>{fmtAmerican(e.weSellAmerican)}</td>
                  <td className="num" title={`Taker would pay ${usd(e.takerGetsCost)} for ${e.contracts} contracts, fee included`}>{fmtAmerican(e.takerGetsAmerican)}</td>
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
