// Expandable drill-down under one "Open positions" card: the individual fills
// that make up that blended position, with a subtotal reconciled to the card.
// Fills load on demand (GET /api/live-trading-desk?positionFills=<slug>) only
// while the panel is open, so the 12s desk poll does not get heavier.
import React, { useEffect, useRef, useState } from "react";
import { reconcilePosition } from "./liveDeskPositionFills";

const mono = "'JetBrains Mono', monospace";

function txt(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

const th = { textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 8px 6px 0", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "6px 8px 6px 0", verticalAlign: "top", borderTop: "1px solid rgba(255,255,255,0.06)" };

function Tag({ children, tone }) {
  const tones = {
    green: ["rgba(16,185,129,0.12)", "rgba(16,185,129,0.4)", "#6ee7b7"],
    gray: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.12)", "#9ca3af"],
    blue: ["rgba(59,130,246,0.12)", "rgba(59,130,246,0.35)", "#93c5fd"],
  };
  const [bg, bd, fg] = tones[tone] || tones.gray;
  return <span style={{ display: "inline-block", marginLeft: 4, padding: "0 5px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: bg, border: "1px solid " + bd, color: fg, whiteSpace: "nowrap" }}>{children}</span>;
}

/**
 * @param {{ row: object, panelId: string, loadFills: (row) => Promise<{fills, eof, reachedOpen, pages, fetched}>, refreshKey?: any }} props
 */
export default function LiveDeskPositionFills({ row, panelId, loadFills, refreshKey }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const seq = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    Promise.resolve()
      .then(() => loadFills(row))
      .then((data) => { if (id === seq.current) setState({ loading: false, error: "", data }); })
      .catch((err) => { if (id === seq.current) setState((s) => ({ loading: false, error: (err && err.message) || "Fills did not load.", data: s.data })); });
    // Refetch when the position itself changes (new fill landed) or on Retry.
  }, [row && row.slug, row && row.instrumentNet, row && row.cost, nonce, refreshKey]);

  const data = state.data;
  const rec = data ? reconcilePosition(row, data.fills, { complete: !!data.eof }) : null;
  const unit = rec && rec.team ? rec.team : "";

  return (
    <div id={panelId} role="region" aria-label={"Fills for " + txt(row.team, "position")} style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {state.loading && !data && <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading fills…</div>}
      {state.error && (
        <div style={{ fontSize: 12, color: "#fcd34d" }}>
          {state.error}{" "}
          <button type="button" onClick={() => setNonce((n) => n + 1)} style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>Retry</button>
        </div>
      )}
      {rec && (
        <>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
            {rec.rows.length} fill{rec.rows.length === 1 ? "" : "s"} make up this position{unit ? " (" + unit + ")" : ""}
            {rec.olderClosedCount ? " · " + rec.olderClosedCount + " older fill" + (rec.olderClosedCount === 1 ? "" : "s") + " were closed out before it opened" : ""}
            {state.loading ? " · refreshing…" : ""}
          </div>
          {rec.rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={th}>Time (ET)</th>
                    <th style={th}>Side</th>
                    <th style={{ ...th, textAlign: "right" }}>Contracts</th>
                    <th style={{ ...th, textAlign: "right" }}>Cost</th>
                    <th style={{ ...th, textAlign: "right" }}>Fill</th>
                    <th style={th}>Role</th>
                    <th style={th}>Order id</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.rows.map((f, i) => {
                    const p = f.protect && typeof f.protect === "object" ? f.protect : null;
                    return (
                      <React.Fragment key={txt(f.id) || "pf-" + i}>
                        <tr>
                          <td style={{ ...td, whiteSpace: "nowrap", color: "#d1d5db" }}>{txt(f.timeEt, "—")}</td>
                          <td style={td}>
                            <span style={{ fontWeight: 700, color: "#e5e7eb" }}>{f.sideUnknown ? "Side unknown" : txt(f.sideLabel, "—")}</span>
                            {p && <Tag tone="green">Bet Protect</Tag>}
                            {!p && f.source === "desk" && <Tag tone="blue">Desk</Tag>}
                            {f.source === "combo" && <Tag>Combo</Tag>}
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono, color: f.effect < 0 ? "#fca5a5" : "#e5e7eb" }} title={f.effect < 0 ? "Reduces this position" : "Adds to this position"}>{f.effect < 0 ? "−" : (f.effect > 0 ? "+" : "")}{txt(f.contractsLabel, "—")}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                            {txt(f.costLabel, "—")}
                            {f.costKind === "proceeds" && <div style={{ fontSize: 9, color: "#6b7280" }}>proceeds</div>}
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 800, color: p ? "#6ee7b7" : "#f9fafb" }}>{txt(f.fillAmerican, "—")}</td>
                          <td style={{ ...td, color: "#9ca3af" }}>{txt(f.role, "—")}</td>
                          <td style={{ ...td, fontFamily: mono, fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>{txt(f.orderId, "—")}</td>
                        </tr>
                        {p && (
                          <tr>
                            <td />
                            <td colSpan={6} style={{ padding: "0 0 6px 0" }}>
                              <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", color: "#a7f3d0", fontSize: 11, fontFamily: mono }}>
                                {txt(p.line)}{txt(p.improvementLabel) ? " · " + p.improvementLabel : ""}
                              </span>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...td, fontWeight: 800, color: "#f9fafb" }}>Subtotal</td>
                    <td style={{ ...td, color: "#9ca3af" }}>
                      {rec.adds.count} fill{rec.adds.count === 1 ? "" : "s"} add +{rec.adds.contracts}
                      {rec.reduces.count ? " · " + rec.reduces.count + " reduce" + (rec.reduces.count === 1 ? "s" : "") + " −" + rec.reduces.contracts : ""}
                      <div style={{ fontSize: 10, color: "#6b7280" }}>cost replayed at average cost (reductions remove cost pro rata)</div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 800 }}>{rec.subtotal.contractsLabel}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 800 }}>{rec.subtotal.costLabel}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 800 }}>{rec.subtotal.avgAmerican || "—"}</td>
                    <td colSpan={2} style={{ ...td, fontSize: 11, color: rec.reconciled ? "#6ee7b7" : "#fcd34d", fontWeight: 700 }}>
                      {rec.reconciled ? "✓ matches card" : (rec.partial ? "partial" : "check")}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ ...td, color: "#6b7280" }}>Card</td>
                    <td style={{ ...td, color: "#6b7280" }}>blended average</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#9ca3af" }}>{txt(rec.card.contracts, "—")}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#9ca3af" }}>{rec.card.costLabel || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#9ca3af" }}>{rec.card.avgAmerican || "—"}</td>
                    <td colSpan={2} style={td} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {rec.note && <div style={{ marginTop: 6, fontSize: 11, color: "#fcd34d" }}>{rec.note}</div>}
          {data && !data.eof && rec.partial && data.pages >= (data.maxPages || 0) && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>Fetched {data.fetched} fills ({data.pages} pages, newest first).</div>
          )}
        </>
      )}
    </div>
  );
}
