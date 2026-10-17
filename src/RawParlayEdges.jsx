// Combo Sniper — owner-only (canSeeOwnerTools). PREVIEW: read-only scanner.
// Flags Kalshi parlay RFQs where the best price traders paid was well worse than fair,
// so Kevin can sell raw (no promo, unhedged, +EV). No quoting or trading here:
// "Offer this" is a disabled placeholder. The API checks the owner again.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import { formatAmericanOdds, formatAvailableSizeClause } from "./trueOddsLine.js";
import { venueLabel, wantsLegDetail } from "./sniperLegs.js";
import {
  DEFAULT_EDGE_AMERICAN,
  DEFAULT_SORT,
  SORT_KEYS,
  LEG_BUCKETS,
  fmtAmerican,
  etTime,
  sortRawEdges,
  matchesLegBucket,
  matchesLeague,
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
const PAGE_SIZE = 50;
const VIEW_CHIPS = [{ v: "ranked", label: "Ranked" }, { v: "day", label: "By day" }];
const fmtEtShort = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) + " ET";
};
const venueName = (v) => (v === "polymarket" ? "Polymarket" : "Kalshi");
// Labels match the column headers exactly, so the Sort-by box and the highlighted column always agree.
const SORT_OPTS = [
  { key: SORT_KEYS.margin, label: "EV / $100 risked" },
  { key: SORT_KEYS.ev, label: "Total EV" },
  { key: SORT_KEYS.size, label: "Size" },
];

const TIP = {
  fair: "Fair odds, legs multiplied together, always Kevin's inverse bet method (live). Each leg: 1 minus the implied chance of the best OPPOSING price with $500 of depth, fees included. Moneylines: best of the live Kalshi, Polymarket US, Novig and ProphetX books; any source older than 15 seconds is dropped. Player TD legs: the opposite side on Kalshi (the only live TD book). EV, EV/$100, the risk card and worst-case probabilities all use this fair.",
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

/** One line per day: edges · EV · handle · worst case. Click to open the full risk lines. */
function SummaryStrip({ d, days }) {
  const [open, setOpen] = useState(null);
  const items = d.days.map((x) => ({ key: x.day, label: dayLabel(x.day), count: x.count, ev: x.ev, r: x.risk }));
  if (d.risk && d.days.length > 1) items.push({ key: "all", label: `All shown (${DAY_CHIPS.find((c) => c.v === days)?.label || ""})`, count: d.total, ev: d.risk.ev, r: d.risk });
  if (!items.length) return <div className="strip"><div className="srow">No edges in this window</div></div>;
  return (
    <div className="strip">
      {items.map((it) => (
        <div key={it.key} className={"srow" + (open === it.key ? " open" : "")} onClick={() => setOpen(open === it.key ? null : it.key)} title="Click for the full risk breakdown">
          <span className="slabel">{open === it.key ? "▾" : "▸"} {it.label}</span>
          <span><b>{it.count.toLocaleString()}</b> edges</span>
          <span className={it.ev >= 0 ? "pos" : "neg"}>EV {usd(it.ev)}</span>
          {it.r && <span>Handle {usd(it.r.handle)}</span>}
          {it.r && it.r.worstCase != null && <span title={RISK_TIP.worst}>Worst <span className="neg">{usd(it.r.worstCase)}</span></span>}
          {it.r && it.r.note && <span className="warn" title={it.r.note}>⚠ some figures approximate</span>}
          {open === it.key && it.r && <div className="sdetail" onClick={(e) => e.stopPropagation()}><RiskLines r={it.r} ev={it.ev} /></div>}
        </div>
      ))}
    </div>
  );
}

/** Requests the scan could not score (no inverse-bet fair logged) or hides (before the inverse-bet go-live). */
function SkippedNote({ d }) {
  const s = d.skipped || {};
  const nf = s.noFair, bl = s.beforeLive;
  const parts = [];
  if (nf && nf.total > 0) {
    const v = Object.entries(nf.byVenue || {}).map(([k, n]) => `${venueName(k)} ${n.toLocaleString()}`).join(", ");
    const byDay = Object.entries(nf.byDay || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, m]) => `${dayLabel(day)}: ${Object.entries(m).map(([k, n]) => `${venueName(k)} ${n}`).join(", ")}`).join(" · ");
    parts.push(<span key="nf" title={byDay}><b>{nf.total.toLocaleString()}</b> requests skipped: no fair price ({v})</span>);
  } else if (nf) parts.push(<span key="nf">0 requests skipped for no fair price</span>);
  if (bl && bl.total > 0) {
    const v = Object.entries(bl.byVenue || {}).map(([k, n]) => `${venueName(k)} ${n.toLocaleString()}`).join(", ");
    parts.push(<span key="bl" title="Requests in the window you picked that came in before the inverse bet method went live everywhere. They stay in the database but are not scored."><b>{bl.total.toLocaleString()}</b> earlier requests hidden: before inverse bet went live {fmtEtShort(s.windowStart)} ({v})</span>);
  }
  if (s.earliestAvailable) parts.push(<span key="ea">Scored from {fmtEtShort(s.windowStart)} · data goes back to {fmtEtShort(s.earliestAvailable)}</span>);
  if (!parts.length) return null;
  return <div className="skipped">{parts.reduce((a, p, i) => (i ? [...a, <span key={"sep" + i} className="sep">·</span>, p] : [p]), [])}</div>;
}

// Expanded legs: compact Combo Locks leg table (LEG · TRUE WIN PROB (BEST OPP)). Loaded on expand from
// /api/raw-parlay-edges?legs=<rfq_id>; until it arrives (or if it fails) the plain leg lines show.
const legCache = new Map();
async function fetchLegs(rfqId) {
  if (legCache.has(rfqId)) return legCache.get(rfqId);
  const p = (async () => {
    const c = supabase();
    if (!c) throw new Error("Not configured");
    const { data: { session } } = await c.auth.getSession();
    if (!session) throw new Error("Sign in required");
    const r = await fetch("/api/raw-parlay-edges?legs=" + encodeURIComponent(rfqId), { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) throw new Error((j && typeof j.error === "string" && j.error) || `Request failed (${r.status})`);
    return j.legs || [];
  })();
  legCache.set(rfqId, p);
  p.catch(() => legCache.delete(rfqId));
  return p;
}
const LEG_TIP = "Fair = 1 minus the implied chance of the best opposing price ($500 of depth, fees included), logged when the request came in. Inverse bet method.";
const PlainLegs = ({ e }) => <div className="legs">{e.legs.map((l, j) => <div key={j} className={e.legIsTd && e.legIsTd[j] ? "td" : undefined}>{l}</div>)}</div>;
// Rows under 1% EV (EV/$100 risked < $1.00) keep the simple leg list: no detail fetch, no price lookups.
function SniperLegs({ e }) {
  return wantsLegDetail(e) ? <SniperLegDetail e={e} /> : <PlainLegs e={e} />;
}
function SniperLegDetail({ e }) {
  const [st, setSt] = useState({ legs: null, error: null });
  useEffect(() => {
    let live = true;
    fetchLegs(e.rfq_id).then((legs) => live && setSt({ legs, error: null }), (err) => live && setSt({ legs: null, error: String((err && err.message) || err) }));
    return () => { live = false; };
  }, [e.rfq_id]);
  if (!st.legs) {
    return (
      <div className="legs">
        {e.legs.map((l, j) => <div key={j} className={e.legIsTd && e.legIsTd[j] ? "td" : undefined}>{l}</div>)}
        <div className="legmeta">{st.error ? `Leg detail unavailable: ${st.error}` : "Loading leg detail…"}</div>
      </div>
    );
  }
  return (
    <div className="ltab">
      <div className="lhead"><div>Leg</div><div title={LEG_TIP}>True win prob (best opp)</div></div>
      {st.legs.map((l, j) => (
        <div key={j} className="lrow">
          <div>
            <div className="ltitle">{l.kind === "td" && <span className="ltd">TD</span>}{l.title}</div>
            {l.subtitle && <div className="lsub">{l.subtitle}</div>}
            {l.when && <div className="lwhen">{l.when}</div>}
          </div>
          <div>
            {l.fairAmerican != null
              ? <div className="lfair">{formatAmericanOdds(l.fairAmerican)}{l.winPct != null && ` (${l.winPct.toFixed(1)}%)`}</div>
              : <div className="lsub">No fair logged for this leg</div>}
            {l.bestOpp && (
              <div className="lopp">Best opp: {formatAmericanOdds(l.bestOpp.american)} on {venueLabel(l.bestOpp.venue)}{l.bestOpp.side ? ` · ${l.bestOpp.side}` : ""}{l.bestOpp.afterKalshiFee ? " · after Kalshi fee" : ""}</div>
            )}
            {(l.depth || (l.others && l.others.length > 0)) && (
              <div className="lmeta">
                {l.depth && <span>top {formatAmericanOdds(l.depth.top)} · {formatAmericanOdds(l.depth.at500)} at $500</span>}
                {l.depth && l.others.length > 0 && " · "}
                {l.others.length > 0 && <span>also {l.others.map((o) => `${venueLabel(o.venue)} ${formatAmericanOdds(o.american)}`).join(", ")}</span>}
              </div>
            )}
            {l.now && <div className="lmeta">Now on {venueLabel(l.now.venue)}: {formatAmericanOdds(l.now.american)}{formatAvailableSizeClause(l.now.size)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RawParlayEdges({ user }) {
  const [days, setDays] = useState(1);
  const [edge, setEdge] = useState(String(DEFAULT_EDGE_AMERICAN));
  const [minCost, setMinCost] = useState("0");
  const [market, setMarket] = useState("all");
  const fairSrc = "pm";
  const [venue, setVenue] = useState("all");
  const [sortKey, setSortKey] = useState(DEFAULT_SORT);
  const [legBucket, setLegBucket] = useState("all");
  const [league, setLeague] = useState("all");
  const [view, setView] = useState("ranked");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openRows, setOpenRows] = useState(() => new Set());
  const [closedDays, setClosedDays] = useState(() => new Set());
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
  useEffect(() => { setShown(PAGE_SIZE); }, [state.data, sortKey, legBucket, league, view]);

  const allEdges = (state.data && state.data.edges) || [];
  const leagues = useMemo(() => {
    const m = new Map();
    for (const e of allEdges) for (const l of (e.summary && e.summary.leagues) || []) m.set(l, (m.get(l) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [allEdges]);
  const ranked = useMemo(
    () => sortRawEdges(allEdges.filter((e) => matchesLegBucket(e, legBucket) && matchesLeague(e, league)), sortKey),
    [allEdges, sortKey, legBucket, league],
  );
  const groups = useMemo(() => {
    if (view !== "day") return null;
    const m = new Map();
    ranked.forEach((e, i) => { const k = e.day || "unknown"; if (!m.has(k)) m.set(k, []); m.get(k).push({ e, rank: i + 1 }); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [ranked, view]);

  if (!canSeeOwnerTools(user)) return null;
  const d = state.data;
  const sortLabel = SORT_OPTS.find((o) => o.key === sortKey)?.label || SORT_OPTS[0].label;
  const filtered = legBucket !== "all" || league !== "all";
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDay = (k) => setClosedDays((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
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
  const COLS = 11;
  const row = ({ e, rank }) => {
    const open = openRows.has(e.rfq_id);
    const sum = e.summary || { text: `${e.legs.length} legs` };
    return (
      <React.Fragment key={e.rfq_id}>
        <tr className={"erow" + (open ? " open" : "")} onClick={() => toggleRow(e.rfq_id)} title={open ? "Click to hide legs" : "Click to show legs"}>
          <td className="rank">{rank}</td>
          <td style={{ whiteSpace: "nowrap" }}>{etTime(e.ts)}</td>
          <td className="parlay"><span className={"vtag " + (e.venue || "kalshi")}>{venueName(e.venue)}</span> <span className="caret">{open ? "▾" : "▸"}</span> {sum.text}{e.legIsTd && e.legIsTd.some(Boolean) && <span className="tdmark"> TD</span>}</td>
          <td className="num fair" title={e.kalshiFairAmerican != null ? `Kalshi-only fair ${fmtAmerican(e.kalshiFairAmerican)}` : undefined}>{fmtAmerican(e.fairAmerican)}</td>
          <td className="num" title={`Winning MM quote ${fmtAmerican(e.winningMmAmerican)} (maker sold YES at $${e.winningMmYes}). Taker paid ${usd(e.takerGotCost)} for ${e.contracts} contracts, fee included.`}>{fmtAmerican(e.takerGotAmerican)}</td>
          <td className="num pos" title={`We sell YES at $${e.weSellYes}: receive ${usd(e.weReceive)}, put up ${usd(e.maxLoss)}${e.makerFee ? `, maker fee ${usd(e.makerFee)}` : ", no maker fee"}`}>{fmtAmerican(e.weSellAmerican)}</td>
          <td className="num" title={`Taker would pay ${usd(e.takerGetsCost)} for ${e.contracts} contracts, fee included`}>{fmtAmerican(e.takerGetsAmerican)}</td>
          <td className={"num pos" + (sortKey === SORT_KEYS.margin ? " hl" : "")}>{usd(e.evPer100)}</td>
          <td className={"num pos" + (sortKey === SORT_KEYS.ev ? " hl" : "")}>{usd(e.ev)}</td>
          <td className="num neg">{usd(e.maxLoss)}</td>
          <td className={"num" + (sortKey === SORT_KEYS.size ? " hl" : "")}>{Math.round(e.contracts).toLocaleString()} ct{e.requestedCost != null ? ` · ${usd(e.requestedCost)} req` : ""}</td>
        </tr>
        {open && (
          <tr className="legrow"><td></td><td colSpan={COLS - 1}>
            <SniperLegs e={e} />
            <div className="legmeta">Winning MM quote {fmtAmerican(e.winningMmAmerican)} · we receive {usd(e.weReceive)} · {e.ticker}{" "}
              <button type="button" className="chip" disabled title={OFFER_TITLE} style={{ opacity: 0.5, cursor: "not-allowed", marginLeft: 8 }}>Offer this</button></div>
          </td></tr>
        )}
      </React.Fragment>
    );
  };
  const more = (total, onMore) => (total > shown ? (
    <tr className="morerow"><td colSpan={COLS}><button type="button" className="chip" onClick={onMore}>Show {Math.min(PAGE_SIZE, total - shown)} more ({(total - shown).toLocaleString()} left)</button></td></tr>
  ) : null);
  return (
    <div className="raw-edges" data-raw-edges="true">
      <style>{`
        .raw-edges{color:#e5e7eb;font-size:13px}
        .raw-edges h2{font-size:18px;margin:0 0 4px}
        .raw-edges .sub{color:#9ca3af;margin-bottom:10px;max-width:980px}
        .raw-edges .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
        .raw-edges .grp{display:inline-flex;gap:4px;align-items:center;padding-right:8px;margin-right:2px;border-right:1px solid rgba(255,255,255,.08)}
        .raw-edges .grp:last-child{border-right:none}
        .raw-edges .glabel{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
        .raw-edges .chip{padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#e5e7eb;cursor:pointer;font-size:12px}
        .raw-edges .chip.on{background:#1d4ed8;border-color:#1d4ed8}
        .raw-edges input,.raw-edges select{background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:3px 6px}
        .raw-edges input{width:64px}
        .raw-edges select{min-width:140px}
        .raw-edges table{border-collapse:collapse;width:100%}
        .raw-edges th,.raw-edges td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}
        .raw-edges th{color:#9ca3af;font-weight:500;white-space:nowrap;position:sticky;top:0;background:#0b0f17}
        .raw-edges th.sortable{cursor:pointer;user-select:none}
        .raw-edges th.sortable:hover{color:#e5e7eb}
        .raw-edges th.sortable.on{color:#93c5fd}
        .raw-edges td.hl{background:rgba(59,130,246,.08);font-weight:600}
        .raw-edges .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .raw-edges .rank{width:2.5em;color:#9ca3af;font-variant-numeric:tabular-nums}
        .raw-edges .pos{color:#4ade80}.raw-edges .neg{color:#f87171}.raw-edges .fair{color:#93c5fd}
        .raw-edges tr.erow{cursor:pointer}.raw-edges tr.erow:hover td{background:rgba(255,255,255,.03)}
        .raw-edges tr.erow.open td{border-bottom:none}
        .raw-edges .parlay{white-space:nowrap}
        .raw-edges .caret{color:#6b7280;font-size:10px}
        .raw-edges .tdmark{color:#fbbf24;font-size:11px}
        .raw-edges tr.legrow td{padding-top:0;background:rgba(255,255,255,.02)}
        .raw-edges .legs div{white-space:nowrap;padding:1px 0}
        .raw-edges .legs div.td{color:#fbbf24}
        .raw-edges .legmeta{color:#6b7280;font-size:11px;margin-top:4px}
        .raw-edges .ltab{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;overflow:hidden;margin-top:2px}
        .raw-edges .lhead,.raw-edges .lrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:12px;padding:5px 10px}
        .raw-edges .lhead{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid rgba(255,255,255,.06)}
        .raw-edges .lrow{border-bottom:1px solid rgba(255,255,255,.04);font-size:11px;line-height:1.35}
        .raw-edges .lrow:last-child{border-bottom:none}
        .raw-edges .lrow:nth-child(odd){background:rgba(255,255,255,.012)}
        .raw-edges .ltitle{font-size:12px;font-weight:600;color:#e8eaed;white-space:normal}
        .raw-edges .ltd{font-size:9px;font-weight:700;color:#fbbf24;border:1px solid rgba(251,191,36,.4);border-radius:4px;padding:0 3px;margin-right:5px;vertical-align:1px}
        .raw-edges .lsub{color:#6b7280}
        .raw-edges .lwhen{color:#4b5563}
        .raw-edges .lfair{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;font-weight:600;color:#f59e0b}
        .raw-edges .lopp{color:#9ca3af}
        .raw-edges .lmeta{color:#4b5563}
        .raw-edges .vtag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;min-width:58px;text-align:center}
        .raw-edges .vtag.kalshi{background:rgba(16,185,129,.15);color:#6ee7b7}.raw-edges .vtag.polymarket{background:rgba(59,130,246,.18);color:#93c5fd}
        .raw-edges .strip{border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:8px}
        .raw-edges .srow{display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer}
        .raw-edges .srow:last-child{border-bottom:none}
        .raw-edges .srow:hover{background:rgba(255,255,255,.03)}
        .raw-edges .slabel{color:#9ca3af;min-width:170px}
        .raw-edges .warn{color:#fbbf24;font-size:11px}
        .raw-edges .sdetail{flex-basis:100%;padding:4px 0 2px 18px;cursor:default}
        .raw-edges .skipped{color:#9ca3af;font-size:12px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px}
        .raw-edges .skipped b{color:#fbbf24}
        .raw-edges .sep{color:#4b5563}
        .raw-edges tr.dayhead td{background:rgba(255,255,255,.04);cursor:pointer;font-weight:600;color:#e5e7eb}
        .raw-edges tr.morerow td{text-align:center;border-bottom:none;padding:10px}
        .raw-edges .risk div{white-space:nowrap;cursor:help}.raw-edges .risk .note{color:#fbbf24;white-space:normal;max-width:520px}
      `}</style>
      <h2>Combo Sniper <span style={{ fontSize: 12, color: "#fbbf24" }}>Preview · only you</span></h2>
      <div className="sub">
        Kalshi and Polymarket parlay requests we could have filled +EV: traders paid well worse than fair. Selling at "We sell at" is +EV
        but unhedged, so you carry the full max loss if every leg wins. Read-only, nothing is quoted. Click a row to see its legs.
      </div>
      <div className="bar">
        <span className="grp"><span className="glabel">Window</span>{DAY_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (days === c.v ? " on" : "")} onClick={() => setDays(c.v)}>{c.label}</button>
        ))}</span>
        <span className="grp"><span className="glabel">Venue</span>{VENUE_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (venue === c.v ? " on" : "")} onClick={() => setVenue(c.v)}>{c.label}</button>
        ))}</span>
        <span className="grp"><span className="glabel">Market</span>{MARKET_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (market === c.v ? " on" : "")} onClick={() => setMarket(c.v)}>{c.label}</button>
        ))}</span>
      </div>
      <div className="bar">
        <span className="grp"><span className="glabel">Legs</span>{LEG_BUCKETS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (legBucket === c.v ? " on" : "")} onClick={() => setLegBucket(c.v)}>{c.label}</button>
        ))}</span>
        <span className="grp"><span className="glabel">League</span>{["all", ...leagues].map((l) => (
          <button key={l} type="button" className={"chip" + (league === l ? " on" : "")} onClick={() => setLeague(l)}>{l === "all" ? "All" : l}</button>
        ))}</span>
        <span className="grp"><span className="glabel">View</span>{VIEW_CHIPS.map((c) => (
          <button key={c.v} type="button" className={"chip" + (view === c.v ? " on" : "")} onClick={() => setView(c.v)}>{c.label}</button>
        ))}</span>
      </div>
      <div className="bar">
        <span className="chip on" title={TIP.fair}>Fair: Inverse bet (live)</span>
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
          <SummaryStrip d={d} days={days} />
          <SkippedNote d={d} />
          <div className="sub">
            Scanned {d.scanned.toLocaleString()} traded requests{d.truncated ? " (capped)" : ""}. {d.total.toLocaleString()} edges, ranked by {sortLabel}
            {filtered ? ` · ${ranked.length.toLocaleString()} match the leg/league filter` : ""}{d.complete === false ? ` · loaded the top ${allEdges.length.toLocaleString()} for every sort` : ""}.
            {" "}Maker fee: {Object.entries(d.series || {}).map(([s, v]) => `${s} ${v.fee_type || "unknown"} (${v.rate})`).join(", ") || "—"}.
          </div>
          <table>
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Time (ET)</th><th>Parlay</th><th className="num" title={TIP.fair}>Fair</th>
                <th className="num" title={TIP.got + " Hover a cell for the winning MM quote."}>Taker got</th>
                <th className="num" title={TIP.sell}>We sell at</th>
                <th className="num" title={TIP.gets}>Taker gets</th>
                {thSort(SORT_KEYS.margin, "EV / $100 risked", "num", TIP.margin)}
                {thSort(SORT_KEYS.ev, "Total EV", "num", TIP.ev)}
                <th className="num" title={TIP.loss}>Max loss</th>
                {thSort(SORT_KEYS.size, "Size", "num")}
              </tr>
            </thead>
            <tbody>
              {!groups && <>
                {ranked.slice(0, shown).map((e, i) => row({ e, rank: i + 1 }))}
                {more(ranked.length, () => setShown((n) => n + PAGE_SIZE))}
              </>}
              {groups && groups.map(([day, items]) => {
                const closed = closedDays.has(day);
                const ev = items.reduce((a, x) => a + x.e.ev, 0);
                return (
                  <React.Fragment key={day}>
                    <tr className="dayhead" onClick={() => toggleDay(day)}><td colSpan={COLS}>{closed ? "▸" : "▾"} {dayLabel(day)} · {items.length.toLocaleString()} edges · <span className="pos">EV {usd(ev)}</span></td></tr>
                    {!closed && items.slice(0, shown).map(row)}
                    {!closed && more(items.length, () => setShown((n) => n + PAGE_SIZE))}
                  </React.Fragment>
                );
              })}
              {!ranked.length && <tr><td colSpan={COLS} style={{ color: "#9ca3af" }}>No edges match these filters.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
