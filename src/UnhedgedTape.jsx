// Unhedged RFQ blotter — read-only quotes/fills from public.unhedged_rfqs.
// Private tab (same owner gate as Combo Locks / Miss tape). No quoting UI.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  UNHEDGED_LIMIT,
  fetchUnhedgedRfqs,
  mapUnhedgedRows,
} from "./unhedgedTape";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function StatusChip({ status, tone }) {
  const label = status === "would_quote" ? "would_quote" : status;
  return <span className={"chip " + (tone || "")}>{label}</span>;
}

function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue}</span>;
}

export function UnhedgedBlotter({ rows, missingTable, loaded, error }) {
  const list = rows || [];
  return (
    <div className="uh">
      <style>{`
        .uh{color:#e8eaed}
        .uh .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px}
        .uh .num{font-variant-numeric:tabular-nums}
        .uh .chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:#c3c6cc}
        .uh .chip.fill{background:rgba(59,130,246,.15);color:#93c5fd}
        .uh .chip.warn{background:rgba(245,158,11,.15);color:#fcd34d}
        .uh .chip.ok{background:rgba(16,185,129,.15);color:#6ee7b7}
        .uh .chip.venue-kalshi{background:rgba(6,182,212,.15);color:#67e8f9}
        .uh .chip.venue-poly{background:rgba(91,110,245,.15);color:#a5b4fc}
        .uh .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px}
        .uh .leg .ty{font-size:10px;font-weight:700;text-transform:uppercase;color:#7ea2e0;margin-right:5px}
        .uh .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .uh .muted{color:#6b7280}
        .uh table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
        .uh th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .uh td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums;vertical-align:top}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Unhedged RFQs</div>
        <span className="chip">read-only</span>
        {loaded && !missingTable && (
          <span className="chip num">{list.length} row{list.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Quotes and fills the worker saw without a Combo Lock hedge. No quoting from this page.
      </div>

      <div className="card">
        {!loaded ? (
          <div className="empty">Loading…</div>
        ) : missingTable ? (
          <div className="empty">No unhedged RFQ tape yet. The worker has not published this table.</div>
        ) : list.length === 0 ? (
          <div className="empty">
            No unhedged RFQs.
            {error && error.message ? <span className="muted"> ({error.message})</span> : null}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time ET</th>
                <th>Venue</th>
                <th>Legs</th>
                <th>Contracts</th>
                <th>RFQ</th>
                <th>Would-quote</th>
                <th>Status</th>
                <th>Fill</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="num muted">{r.timeEt}</td>
                  <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
                  <td>
                    <div>{r.label}</div>
                    {r.legs.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {r.legs.map((l, i) => (
                          <span className="leg" key={i}>{l.type ? <span className="ty">{l.type}</span> : null}{l.text}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="num">{r.contractsText}</td>
                  <td className="num">{r.theirText}</td>
                  <td className="num">{r.ourText}</td>
                  <td><StatusChip status={r.status} tone={r.statusTone} /></td>
                  <td className="num">{r.fillText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loaded && list.length >= UNHEDGED_LIMIT && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Showing last {UNHEDGED_LIMIT} (newest first). Older rows are not polled.
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

  const rows = useMemo(() => mapUnhedgedRows(raw), [raw]);

  if (!owner) return <div style={{ color: "#6b7280", padding: 40 }}>This tab is private.</div>;

  return (
    <UnhedgedBlotter
      rows={rows}
      missingTable={missingTable}
      loaded={loaded}
      error={error}
    />
  );
}
