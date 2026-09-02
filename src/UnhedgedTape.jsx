// Unhedged RFQ blotter — read-only filled RFQs from public.unhedged_rfqs.
// Private tab (same owner gate as Combo Locks / Miss tape). No quoting UI.
// Filled only: someone else matched on Kalshi/Poly. We did not take these.
// Summary + tape are MLB and NFL moneylines only. Venue and
// would-quote-beat-fill chips are client-side over the filled 1000.
// Legs cell is a per-leg Fair / Kalshi / Poly breakdown — not a cramped chip.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  UNHEDGED_LIMIT,
  fetchUnhedgedRfqs,
  filterUnhedgedAnalytics,
  isTickerBlob,
  summarizeUnhedgedRows,
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

export function UnhedgedBlotter({ rows, fetched, missingTable, loaded, error, onRefresh, refreshing }) {
  const list = rows || [];
  const [venueFilter, setVenueFilter] = useState("all");
  const [quoteBeatFill, setQuoteBeatFill] = useState(false);
  const filtered = useMemo(
    () => filterUnhedgedAnalytics(list, { venue: venueFilter, quoteBeatFill }),
    [list, venueFilter, quoteBeatFill],
  );
  const summary = useMemo(
    () => summarizeUnhedgedRows(filtered, { fetched: fetched == null ? list.length : fetched }),
    [filtered, fetched, list.length],
  );
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
        {loaded && !missingTable && (
          <span className="chip ok num">{summary.filled} filled</span>
        )}
        {onRefresh ? (
          <button
            type="button"
            className="chip btn"
            disabled={!!refreshing || !loaded}
            aria-busy={!!refreshing}
            title="Re-fetch the filled tape. Does not reload the app."
            onClick={onRefresh}
          >
            {unhedgedRefreshLabel(refreshing)}
          </button>
        ) : null}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Filled RFQs someone else matched on Kalshi or Polymarket. We did not take these — paper only. No quoting from this page.
      </div>

      {loaded && !missingTable && (
        <div className="filters" role="group" aria-label="Unhedged RFQ filters">
          <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 2 }}>Venue</span>
          {VENUE_CHIPS.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              className={c.cls}
              active={venueFilter === c.key}
              onClick={() => setVenueFilter(c.key)}
              title={c.key === "all" ? "All venues in this filled fetch" : `Filled ${c.label} only`}
            />
          ))}
          <span className="muted" style={{ margin: "0 4px" }}>·</span>
          <FilterChip
            label="Would-quote beat fill"
            className="warn"
            active={quoteBeatFill}
            onClick={() => setQuoteBeatFill((on) => !on)}
            title="Show only rows where our would-quote is a better buy-side YES than the print (higher American, e.g. +614 vs +452 or −110 vs −150). Rows missing quote or fill never pass."
          />
        </div>
      )}

      {loaded && !missingTable && (
        <div className="tiles">
          <Tile
            k="Filled"
            v={summary.filled}
            sub="someone else matched · we did not take these"
            tone={summary.filled ? "pos" : undefined}
            title="status=filled — matched by anyone on the venue. We are paper."
          />
          <Tile
            k="Would-quote"
            v={summary.withQuote}
            sub="our_quote_american present"
            tone={summary.withQuote ? "warn" : undefined}
            title="5% net-cost wrap — the American we would have filled at. Null is —."
          />
        </div>
      )}

      <div className="card">
        {!loaded ? (
          <div className="empty">Loading…</div>
        ) : missingTable ? (
          <div className="empty">No unhedged RFQ tape yet. The worker has not published this table.</div>
        ) : list.length === 0 ? (
          <div className="empty">
            No filled MLB or NFL moneyline RFQs.
            {error && error.message ? <span className="muted"> ({error.message})</span> : null}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            No filled MLB or NFL moneyline RFQs match these filters.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time ET</th>
                <th>Venue</th>
                <th>Legs</th>
                <th>Amount</th>
                <th>Fill price</th>
                <th>True / fair</th>
                <th>Would-quote</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                return (
                  <tr key={r.id}>
                    <td className="num muted">{r.timeEt}</td>
                    <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
                    <td>
                      <LegBreakdown legs={r.legs} />
                    </td>
                    <td className="num">{r.amountText}</td>
                    <td className="num">{r.fillText}</td>
                    <td className="num fair">{r.fairText}</td>
                    <td className="num">{r.ourText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {loaded && summary.fetched >= UNHEDGED_LIMIT && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Showing filled MLB and NFL moneylines from the last {UNHEDGED_LIMIT} fetched (newest fill first). Older rows are not polled.
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnhedgedTape({ user }) {
  const owner = user && user.email === OWNER_EMAIL;
  const [raw, setRaw] = useState([]);
  const [missingTable, setMissingTable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async ({ button } = {}) => {
    if (!owner) return;
    if (button) setRefreshing(true);
    try {
      const result = await fetchUnhedgedRfqs(supabase, { userId: user && user.id, limit: UNHEDGED_LIMIT });
      setRaw(result.rows);
      setMissingTable(result.missingTable);
      setError(result.error);
      setLoaded(true);
    } finally {
      if (button) setRefreshing(false);
    }
  }, [owner, user]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!owner || missingTable) return undefined;
    const t = setInterval(() => { reload(); }, 20000);
    return () => clearInterval(t);
  }, [reload, owner, missingTable]);

  const rows = useMemo(() => visibleUnhedgedRows(raw), [raw]);

  if (!owner) return <div style={{ color: "#6b7280", padding: 40 }}>This tab is private.</div>;

  return (
    <UnhedgedBlotter
      rows={rows}
      fetched={raw.length}
      missingTable={missingTable}
      loaded={loaded}
      error={error}
      onRefresh={() => { reload({ button: true }); }}
      refreshing={refreshing}
    />
  );
}
