// Unhedged RFQ blotter — read-only quotes/fills from public.unhedged_rfqs.
// Private tab (same owner gate as Combo Locks / Miss tape). No quoting UI.
// Summary + tape are MLB and NFL moneylines only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  UNHEDGED_LIMIT,
  fetchUnhedgedRfqs,
  filterMlbNflMoneylineRows,
  mapUnhedgedRows,
  summarizeUnhedgedRows,
} from "./unhedgedTape";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

function StatusChip({ status, tone }) {
  const label = status === "would_quote" ? "would_quote" : status;
  const extra = status === "filled" ? " filled" : "";
  return <span className={"chip " + (tone || "") + extra}>{label}</span>;
}

function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue}</span>;
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
        .uh .chip.fill{background:rgba(59,130,246,.15);color:#93c5fd}
        .uh .chip.warn{background:rgba(245,158,11,.15);color:#fcd34d}
        .uh .chip.ok,.uh .chip.filled{background:rgba(16,185,129,.18);color:#6ee7b7}
        .uh .chip.venue-kalshi{background:rgba(6,182,212,.15);color:#67e8f9}
        .uh .chip.venue-poly{background:rgba(91,110,245,.15);color:#a5b4fc}
        .uh .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px}
        .uh .leg .ty{font-size:10px;font-weight:700;text-transform:uppercase;color:#7ea2e0;margin-right:5px}
        .uh .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .uh .muted{color:#6b7280}
        .uh .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:0 0 12px}
        .uh .tile{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px}
        .uh .tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280}
        .uh .tile .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
        .uh .tile .sub{font-size:11px;color:#8a8f98;margin-top:3px;line-height:1.35}
        .uh table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
        .uh th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .uh td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums;vertical-align:top}
        .uh tr.is-filled td{background:rgba(16,185,129,.07)}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Unhedged RFQs</div>
        <span className="chip">read-only</span>
        <span className="chip">MLB + NFL ML</span>
        {loaded && !missingTable && (
          <span className="chip num">{summary.total} shown</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        MLB and NFL moneyline RFQs the worker saw without a Combo Lock hedge. Filled is anyone on the venue — we are paper. No quoting from this page.
      </div>

      {loaded && !missingTable && (
        <div className="tiles">
          <Tile
            k="Fetched"
            v={summary.fetched}
            sub={`newest ${UNHEDGED_LIMIT}`}
            title="Rows in this newest-first fetch before the MLB/NFL moneyline filter."
          />
          <Tile
            k="Shown"
            v={summary.total}
            sub="MLB + NFL moneylines"
            title="Client-side filter: every leg is an MLB or NFL moneyline."
          />
          <Tile
            k="Would-quote"
            v={summary.wouldQuote}
            sub="our_quote present"
            tone={summary.wouldQuote ? "warn" : undefined}
            title="our_quote_american / would_quote present, even if the worker status is still seen."
          />
          <Tile
            k="Filled"
            v={summary.filled}
            sub="anyone on venue"
            tone={summary.filled ? "pos" : undefined}
            title="status filled — matched by anyone on the venue. We are paper."
          />
          <Tile
            k="Started"
            v={summary.started}
            sub={`${summary.seen} seen`}
            title="Worker status started vs seen (seen with a would-quote is counted as would-quote)."
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
            No MLB or NFL moneyline RFQs in this fetch.
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
                <tr key={r.id} className={r.status === "filled" ? "is-filled" : undefined}>
                  <td className="num muted">{r.timeEt}</td>
                  <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
                  <td>
                    <div>{r.label}</div>
                    {r.legs.length > 1 && (
                      <div style={{ marginTop: 4 }}>
                        {r.legs.map((l, i) => (
                          <span className="leg" key={i}>{l.text}</span>
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
        {loaded && summary.fetched >= UNHEDGED_LIMIT && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Showing MLB and NFL moneylines from the newest {UNHEDGED_LIMIT} fetched (newest first). Older rows are not polled.
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

  const rows = useMemo(
    () => mapUnhedgedRows(filterMlbNflMoneylineRows(raw)),
    [raw],
  );

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
