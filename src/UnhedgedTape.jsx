// Unhedged RFQ blotter — read-only filled RFQs from public.unhedged_rfqs.
// Private tab (same owner gate as Combo Locks / Miss tape). No quoting UI.
// Filled only: someone else matched on Kalshi/Poly. We did not take these.
// Summary + tape are MLB and NFL moneylines only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  UNHEDGED_LIMIT,
  fetchUnhedgedRfqs,
  isTickerBlob,
  summarizeUnhedgedRows,
  visibleUnhedgedRows,
} from "./unhedgedTape";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue}</span>;
}

function visibleLegChips(legs) {
  return (legs || []).filter((l) => l.text && !isTickerBlob(l.text));
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

export function UnhedgedBlotter({ rows, fetched, missingTable, loaded, error }) {
  const list = rows || [];
  const summary = useMemo(
    () => summarizeUnhedgedRows(list, { fetched: fetched == null ? list.length : fetched }),
    [list, fetched],
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
        .uh .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px}
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
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Filled RFQs someone else matched on Kalshi or Polymarket. We did not take these — paper only. No quoting from this page.
      </div>

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
              {list.map((r) => {
                const chips = visibleLegChips(r.legs);
                return (
                  <tr key={r.id}>
                    <td className="num muted">{r.timeEt}</td>
                    <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
                    <td>
                      <div>{r.label}</div>
                      {chips.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {chips.map((l, i) => (
                            <span className="leg" key={i}>{l.text}</span>
                          ))}
                        </div>
                      )}
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

  const reload = useCallback(async () => {
    if (!owner) return;
    const result = await fetchUnhedgedRfqs(supabase, { userId: user && user.id, limit: UNHEDGED_LIMIT });
    setRaw(result.rows);
    setMissingTable(result.missingTable);
    setError(result.error);
    setLoaded(true);
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
    />
  );
}
