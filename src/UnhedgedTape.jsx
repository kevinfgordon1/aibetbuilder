// Unhedged RFQ blotter — read-only RFQs from public.unhedged_rfqs.
// Private tab (same owner gate as Combo Locks / Miss tape). No quoting UI.
// Do not pass user.id into the tape query: combo-worker does not write
// user_id, so eq('user_id', owner) would hide every worker row.
// Status chips: Fills (someone else matched) | Requests (status=seen,
// would-quote) | All. Default Fills (Kalshi tape). Polymarket defaults to
// Requests — Poly cannot show fill prices. We did not take these (paper).
// Summary + tape are MLB and NFL moneylines only. Default date chip is Today.
// Today / 24h / 7d stay one page. Month / All time page only after that chip
// is selected. Tiles use head counts (same window + venue + status + beat-fill).
// Legs cell is a per-leg Fair / Kalshi / Poly breakdown plus sport + event date.
// Manual Refresh only — do not poll. Row pull is a slim column list; Fills
// filter filled_at, Requests filter created_at.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  UNHEDGED_DATE_FILTERS,
  UNHEDGED_DEFAULT_DATE_RANGE,
  UNHEDGED_DEFAULT_STATUS_MODE,
  UNHEDGED_STATUS_FILTERS,
  countUnhedgedRfqs,
  defaultStatusModeForVenue,
  fetchUnhedgedRfqs,
  filterUnhedgedAnalytics,
  formatEtTime,
  isTickerBlob,
  mergeUnhedgedSummary,
  normalizeStatusMode,
  normalizeUnhedgedDateRange,
  normalizeVenueFilter,
  summarizeUnhedgedRows,
  unhedgedActivityTs,
  unhedgedDateRangeLabel,
  unhedgedDateRangePages,
  unhedgedDisplayTs,
  unhedgedRefreshLabel,
  visibleUnhedgedRows,
} from "./unhedgedTape";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue}</span>;
}

const VENUE_CHIPS = [
  { key: "all", label: "All" },
  { key: "kalshi", label: "Kalshi", cls: "venue-kalshi" },
  { key: "polymarket", label: "Polymarket", cls: "venue-poly" },
];

function formatRowStatus(status) {
  if (status === "filled") return "Filled";
  if (status === "would_quote" || status === "quoted") return "Would-quote";
  if (status === "started") return "Started";
  return "Request";
}

function FilterChip({ label, active, onClick, className, title }) {
  return (
    <button
      type="button"
      className={"chip btn" + (active ? " on" : "") + (className ? " " + className : "")}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function visibleBreakdownLegs(legs) {
  return (legs || []).filter((l) => (l.name || l.text) && !isTickerBlob(l.name || l.text));
}

function LegBreakdown({ legs }) {
  const rows = visibleBreakdownLegs(legs);
  if (!rows.length) return null;
  const showBest = rows.some((l) => l.bestOpponentAmerican != null);
  return (
    <table className="legs">
      <thead>
        <tr>
          <th>Leg</th>
          <th>Sport</th>
          <th>Event</th>
          <th>Fair</th>
          <th>Kalshi</th>
          <th>Poly</th>
          {showBest ? <th>Best opp</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={i}>
            <td>{l.name || l.text}</td>
            <td>{l.sport || "—"}</td>
            <td className="num muted">{l.eventText || "—"}</td>
            <td className="num fair">{l.fairText || "—"}</td>
            <td className="num">{l.kalshiText || "—"}</td>
            <td className="num">{l.polyText || "—"}</td>
            {showBest ? <td className="num">{l.bestText || "—"}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tile({ k, v, sub, tone, title }) {
  const color = tone === "pos" ? "#34d399" : tone === "warn" ? "#fcd34d" : "#e8eaed";
  return (
    <div className="tile" title={title}>
      <div className="k">{k}</div>
      <div className="v num" style={{ color }}>{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function UnhedgedBlotter({
  rows,
  fetched,
  counts,
  missingTable,
  loaded,
  error,
  onRefresh,
  refreshing,
  paging,
  dateRange = UNHEDGED_DEFAULT_DATE_RANGE,
  onDateRangeChange,
  venueFilter = "all",
  onVenueFilterChange,
  statusMode = UNHEDGED_DEFAULT_STATUS_MODE,
  onStatusModeChange,
  quoteBeatFill = false,
  onQuoteBeatFillChange,
}) {
  const list = rows || [];
  const dateKey = normalizeUnhedgedDateRange(dateRange);
  const modeKey = normalizeStatusMode(statusMode);
  const heavy = unhedgedDateRangePages(dateKey);
  const showFills = modeKey === "fills" || modeKey === "all";
  const showRequests = modeKey === "requests" || modeKey === "all";
  const polyRequestNote = venueFilter === "polymarket" && modeKey === "requests";
  const venueScoped = useMemo(
    () => filterUnhedgedAnalytics(list, { venue: venueFilter, quoteBeatFill: false }),
    [list, venueFilter],
  );
  const filtered = useMemo(
    () => filterUnhedgedAnalytics(venueScoped, { venue: "all", quoteBeatFill }),
    [venueScoped, quoteBeatFill],
  );
  const venueSummary = useMemo(
    () => summarizeUnhedgedRows(venueScoped, { fetched: fetched == null ? list.length : fetched }),
    [venueScoped, fetched, list.length],
  );
  const rowSummary = useMemo(
    () => summarizeUnhedgedRows(filtered, { fetched: fetched == null ? list.length : fetched }),
    [filtered, fetched, list.length],
  );
  const useHead = counts && !(venueFilter !== "all" && counts.venueDropped);
  const summary = useMemo(
    () => mergeUnhedgedSummary(rowSummary, useHead ? counts : null),
    [rowSummary, useHead, counts],
  );
  const beatFillCount = useHead && counts.beatFill != null ? counts.beatFill : venueSummary.beatFill;
  return (
    <div className="uh">
      <style>{`
        .uh{color:#e8eaed}
        .uh .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px}
        .uh .num{font-variant-numeric:tabular-nums}
        .uh .chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:#c3c6cc}
        .uh .chip.warn{background:rgba(245,158,11,.15);color:#fcd34d}
        .uh .chip.ok{background:rgba(16,185,129,.18);color:#6ee7b7}
        .uh .chip.venue-kalshi{background:rgba(6,182,212,.15);color:#67e8f9}
        .uh .chip.venue-poly{background:rgba(91,110,245,.15);color:#a5b4fc}
        .uh .chip.btn{cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);font:inherit;font-size:12px;font-weight:600}
        .uh .chip.btn:disabled{opacity:.55;cursor:wait}
        .uh .chip.btn.on{background:rgba(59,130,246,.2);color:#93c5fd;border-color:rgba(59,130,246,.35)}
        .uh .chip.btn.venue-kalshi.on{background:rgba(6,182,212,.2);color:#67e8f9;border-color:rgba(6,182,212,.35)}
        .uh .chip.btn.venue-poly.on{background:rgba(91,110,245,.2);color:#a5b4fc;border-color:rgba(91,110,245,.35)}
        .uh .chip.btn.warn.on{background:rgba(245,158,11,.2);color:#fcd34d;border-color:rgba(245,158,11,.35)}
        .uh .filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 12px}
        .uh .legs{width:auto;min-width:100%;margin:2px 0 0;border-collapse:collapse;font-size:12px}
        .uh .legs th{padding:2px 10px 2px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;font-weight:600}
        .uh .legs td{padding:3px 10px 3px 0;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle}
        .uh .legs tr:last-child td{border-bottom:none}
        .uh .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .uh .muted{color:#6b7280}
        .uh .fair{color:#93c5fd}
        .uh .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:0 0 12px}
        .uh .tile{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px}
        .uh .tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280}
        .uh .tile .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
        .uh .tile .sub{font-size:11px;color:#8a8f98;margin-top:3px;line-height:1.35}
        .uh table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
        .uh th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .uh td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums;vertical-align:top}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Unhedged RFQs</div>
        <span className="chip">read-only</span>
        <span className="chip">paper</span>
        <span className="chip">MLB + NFL ML</span>
        <span className="chip">pregame</span>
        {loaded && !missingTable && !paging && showFills && (
          <span className="chip ok num">{summary.filled} filled</span>
        )}
        {loaded && !missingTable && !paging && showRequests && (
          <span className="chip warn num">{summary.requests} requests</span>
        )}
        {onRefresh ? (
          <button
            type="button"
            className="chip btn"
            disabled={!!refreshing || !!paging || !loaded}
            aria-busy={!!refreshing || !!paging}
            title="Re-fetch the tape. Manual only — this page does not auto-refresh. Does not reload the app. Today / 24h / 7d stay one page."
            onClick={onRefresh}
          >
            {unhedgedRefreshLabel(refreshing || paging)}
          </button>
        ) : null}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {modeKey === "requests"
          ? "Seen pregame MLB/NFL combo RFQs the worker already priced or recorded. Would-quote is what we would have quoted — paper only. We did not take these."
          : modeKey === "all"
            ? "Filled matches plus seen RFQ requests. We did not take these — paper only."
            : "Filled pregame RFQs someone else matched on Kalshi or Polymarket. We did not take these — paper only."}
        {" "}In-game and started RFQs stay off this tape. No quoting from this page.
      </div>
      {polyRequestNote ? (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Polymarket does not expose others’ quotes or tape, so fill prices are unavailable from the venue. Would-quote is still what we would have quoted.
        </div>
      ) : null}

      {loaded && !missingTable && (
        <div className="filters" role="group" aria-label="Unhedged RFQ filters">
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 2 }}>Date</span>
          {UNHEDGED_DATE_FILTERS.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              active={dateKey === c.key}
              onClick={() => { if (onDateRangeChange) onDateRangeChange(c.key); }}
              title={c.key === "all" || c.key === "month"
                ? `${c.label} window — pages from the server after you pick this chip. Tile counts are a head query.`
                : `Filled rows in this ${c.label.toLowerCase()} window (one page). Tile counts are a head query.`}
            />
          ))}
          <span className="muted" style={{ margin: "0 4px" }}>·</span>
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 2 }}>Show</span>
          {UNHEDGED_STATUS_FILTERS.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              active={modeKey === c.key}
              onClick={() => { if (onStatusModeChange) onStatusModeChange(c.key); }}
              title={c.key === "fills"
                ? "status=filled — someone else matched. Kalshi tape."
                : c.key === "requests"
                  ? "status=seen RFQ requests. Would-quote is what we would have quoted. Fill price is — unless the venue published one."
                  : "Filled matches plus seen requests in this date window + venue."}
            />
          ))}
          <span className="muted" style={{ margin: "0 4px" }}>·</span>
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 2 }}>Venue</span>
          {VENUE_CHIPS.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              className={c.cls}
              active={venueFilter === c.key}
              onClick={() => { if (onVenueFilterChange) onVenueFilterChange(c.key); }}
              title={c.key === "all"
                ? "All venues in this date window. Defaults to Fills."
                : c.key === "polymarket"
                  ? "Polymarket only. Defaults to Requests — fill prices are not available from the venue."
                  : `Kalshi only. Defaults to Fills.`}
            />
          ))}
          <span className="muted" style={{ margin: "0 4px" }}>·</span>
          <FilterChip
            label={`Would-quote beat fill · ${beatFillCount}`}
            className="warn"
            active={quoteBeatFill}
            onClick={() => {
              if (modeKey === "requests") return;
              if (onQuoteBeatFillChange) onQuoteBeatFillChange(!quoteBeatFill);
            }}
            title={modeKey === "requests"
              ? "Beat-fill needs a fill price. Requests do not have one — the filter stays off."
              : "Show only rows where our would-quote is a better buy-side YES than the print (higher American, e.g. +614 vs +452 or −110 vs −150). Count is for the selected date window + venue. Rows missing quote or fill never pass."}
          />
        </div>
      )}

      {loaded && !missingTable && !(paging && !counts) && (
        <div className="tiles">
          {showFills ? (
            <Tile
              k="Filled"
              v={summary.filled}
              sub="someone else matched · we did not take these"
              tone={summary.filled ? "pos" : undefined}
              title={`status=filled in the ${unhedgedDateRangeLabel(dateKey)} window + venue${quoteBeatFill ? " + beat-fill" : ""}. Head count when the server can. Matched by anyone on the venue. We are paper.`}
            />
          ) : null}
          {showRequests ? (
            <Tile
              k="Requests"
              v={summary.requests}
              sub="status=seen · would-quote when priced"
              tone={summary.requests ? "warn" : undefined}
              title={`status=seen in the ${unhedgedDateRangeLabel(dateKey)} window + venue (created_at). Head count when the server can. Paper only — we did not quote live.`}
            />
          ) : null}
          <Tile
            k="Would-quote"
            v={summary.withQuote}
            sub="our_quote_american present"
            tone={summary.withQuote ? "warn" : undefined}
            title="5% net-cost wrap — the American we would have filled at. Null is —. Head count for the selected date window + venue + status (+ beat-fill when that chip is on)."
          />
          {showFills ? (
            <Tile
              k="Beat fill"
              v={beatFillCount}
              sub="would-quote better YES than the print"
              tone={beatFillCount ? "warn" : undefined}
              title="our_quote_american > fill_american in this date window + venue. Same rule as the beat-fill chip. Missing quote or fill never counts."
            />
          ) : null}
        </div>
      )}

      <div className="card">
        {!loaded || paging ? (
          <div className="empty">Loading…</div>
        ) : missingTable ? (
          <div className="empty">No unhedged RFQ tape yet. The worker has not published this table.</div>
        ) : list.length === 0 ? (
          <div className="empty">
            {modeKey === "requests"
              ? "No seen pregame MLB or NFL moneyline RFQs."
              : modeKey === "all"
                ? "No pregame MLB or NFL moneyline RFQs."
                : "No filled pregame MLB or NFL moneyline RFQs."}
            {error && error.message ? <span className="muted"> ({error.message})</span> : null}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {modeKey === "requests"
              ? "No seen pregame MLB or NFL moneyline RFQs match these filters."
              : modeKey === "all"
                ? "No pregame MLB or NFL moneyline RFQs match these filters."
                : "No filled pregame MLB or NFL moneyline RFQs match these filters."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time ET</th>
                <th>Status</th>
                <th>Venue</th>
                <th>Legs</th>
                <th>Amount</th>
                <th>Taker / RFQ</th>
                <th>Fill price</th>
                <th>True / fair</th>
                <th>Would-quote</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                return (
                  <tr key={r.id}>
                    <td className="num muted">{formatEtTime(unhedgedDisplayTs(r) || unhedgedActivityTs(r) || r.at)}</td>
                    <td><span className={"chip " + (r.statusTone || "")}>{formatRowStatus(r.status)}</span></td>
                    <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
                    <td>
                      <LegBreakdown legs={r.legs} />
                    </td>
                    <td className="num">{r.amountText}</td>
                    <td className="num">{r.theirText}</td>
                    <td className="num">{r.fillText}</td>
                    <td className="num fair">{r.fairText}</td>
                    <td className="num">{r.ourText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {loaded && !missingTable && list.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Showing {modeKey === "requests" ? "seen" : modeKey === "all" ? "filled and seen" : "filled"} pregame MLB and NFL moneylines in the {unhedgedDateRangeLabel(dateKey)} window ({heavy ? "paged from the server after this chip" : "one page; Month / All time page only after you pick that chip"}, {modeKey === "requests" ? "newest created_at first" : "newest activity first"}). Tile counts are a head query. Venue and beat-fill chips filter this set. In-game rows are hidden. Fill price is — when the venue does not publish one.
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnhedgedTape({ user }) {
  const owner = user && user.email === OWNER_EMAIL;
  const [raw, setRaw] = useState([]);
  const [counts, setCounts] = useState(null);
  const [missingTable, setMissingTable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  const [dateRange, setDateRange] = useState(UNHEDGED_DEFAULT_DATE_RANGE);
  const [venueFilter, setVenueFilter] = useState("all");
  const [statusMode, setStatusMode] = useState(UNHEDGED_DEFAULT_STATUS_MODE);
  const [quoteBeatFill, setQuoteBeatFill] = useState(false);
  const rowGen = useRef(0);
  const countGen = useRef(0);

  const reloadRows = useCallback(async ({ button } = {}) => {
    if (!owner) return;
    const gen = rowGen.current + 1;
    rowGen.current = gen;
    const heavy = unhedgedDateRangePages(dateRange);
    if (button) setRefreshing(true);
    if (heavy) setPaging(true);
    try {
      const result = await fetchUnhedgedRfqs(supabase, {
        dateRange,
        venue: venueFilter,
        statusMode,
      });
      if (gen !== rowGen.current) return;
      setRaw(result.rows);
      setMissingTable(result.missingTable);
      setError(result.error);
      setLoaded(true);
    } finally {
      if (gen !== rowGen.current) return;
      if (button) setRefreshing(false);
      setPaging(false);
    }
  }, [owner, dateRange, venueFilter, statusMode]);

  const reloadCounts = useCallback(async () => {
    if (!owner) return;
    const gen = countGen.current + 1;
    countGen.current = gen;
    const head = await countUnhedgedRfqs(supabase, {
      dateRange,
      venue: venueFilter,
      quoteBeatFill,
      statusMode,
    });
    if (gen !== countGen.current) return;
    setCounts(head);
    if (head && head.missingTable) setMissingTable(true);
  }, [owner, dateRange, venueFilter, quoteBeatFill, statusMode]);

  useEffect(() => { reloadRows(); }, [reloadRows]);
  useEffect(() => { reloadCounts(); }, [reloadCounts]);
  // Manual Refresh only. Do not poll: public.unhedged_rfqs has millions of
  // seen rows and a 20s fetch+count was melting Today (~1.5k filled).

  const rows = useMemo(() => visibleUnhedgedRows(raw, { statusMode }), [raw, statusMode]);

  const bumpFetch = useCallback((heavy) => {
    rowGen.current += 1;
    countGen.current += 1;
    if (heavy) {
      setPaging(true);
      setRaw([]);
      setCounts(null);
    }
  }, []);

  const onDateRangeChange = useCallback((key) => {
    const next = normalizeUnhedgedDateRange(key);
    if (next === dateRange) return;
    bumpFetch(unhedgedDateRangePages(next));
    setDateRange(next);
  }, [dateRange, bumpFetch]);

  const onVenueFilterChange = useCallback((key) => {
    const next = normalizeVenueFilter(key);
    if (next === venueFilter) return;
    const nextMode = defaultStatusModeForVenue(next);
    bumpFetch(unhedgedDateRangePages(dateRange));
    setVenueFilter(next);
    setStatusMode(nextMode);
    if (nextMode === "requests") setQuoteBeatFill(false);
  }, [venueFilter, dateRange, bumpFetch]);

  const onStatusModeChange = useCallback((key) => {
    const next = normalizeStatusMode(key);
    if (next === statusMode) return;
    bumpFetch(unhedgedDateRangePages(dateRange));
    setStatusMode(next);
    if (next === "requests") setQuoteBeatFill(false);
  }, [statusMode, dateRange, bumpFetch]);

  if (!owner) return <div style={{ color: "#6b7280", padding: 40 }}>This tab is private.</div>;

  return (
    <UnhedgedBlotter
      rows={rows}
      fetched={raw.length}
      counts={counts}
      missingTable={missingTable}
      loaded={loaded}
      error={error}
      onRefresh={() => { reloadRows({ button: true }); reloadCounts(); }}
      refreshing={refreshing}
      paging={paging}
      dateRange={dateRange}
      onDateRangeChange={onDateRangeChange}
      venueFilter={venueFilter}
      onVenueFilterChange={onVenueFilterChange}
      statusMode={statusMode}
      onStatusModeChange={onStatusModeChange}
      quoteBeatFill={quoteBeatFill}
      onQuoteBeatFillChange={setQuoteBeatFill}
    />
  );
}
