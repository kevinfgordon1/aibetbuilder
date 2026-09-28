// Filled orders list for the private Live Trading Desk. One row per fill,
// newest first. Rows come from GET /api/live-trading-desk (board.fills),
// which the desk already polls every 12s while the tab is visible.
import React from "react";

const mono = "'JetBrains Mono', monospace";

function txt(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

const th = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  padding: "8px 10px 8px 0",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const td = {
  fontSize: 13,
  padding: "10px 10px 10px 0",
  verticalAlign: "top",
  borderTop: "1px solid rgba(255,255,255,0.06)",
};

function Badge({ children, tone }) {
  const tones = {
    green: { bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.4)", fg: "#6ee7b7" },
    amber: { bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.4)", fg: "#fcd34d" },
    gray: { bg: "rgba(255,255,255,0.04)", bd: "rgba(255,255,255,0.12)", fg: "#9ca3af" },
    blue: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.35)", fg: "#93c5fd" },
  };
  const t = tones[tone] || tones.gray;
  return (
    <span style={{ display: "inline-block", marginLeft: 6, padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: t.bg, border: "1px solid " + t.bd, color: t.fg, whiteSpace: "nowrap", verticalAlign: "middle" }}>{children}</span>
  );
}

export default function LiveDeskFilledOrders({ fills, stale, failed, note, style }) {
  const rows = (Array.isArray(fills) ? fills : []).filter((row) => row && typeof row === "object");
  const protectCount = rows.filter((row) => row.protect && typeof row.protect === "object").length;
  return (
    <section style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>
          Filled orders{stale ? " · stale" : ""}
          <span style={{ color: "#6b7280", fontWeight: 600 }}> · {rows.length} fill{rows.length === 1 ? "" : "s"}{protectCount ? " · " + protectCount + " via Bet Protect" : ""}</span>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>Every individual fill, newest first · American odds · times ET · updates every 12s while open</div>
      </div>
      {note && <div style={{ marginTop: 8, fontSize: 12, color: "#fcd34d" }}>{note}</div>}
      {stale && <div style={{ color: "#fcd34d", fontSize: 12, marginTop: 8 }}>Last loaded fills, marked stale until Polymarket accepts a refresh.</div>}
      {rows.length === 0 && (
        <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>{failed ? "Fills did not load. Retrying on the next refresh." : "No fills yet."}</div>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr>
                <th style={th}>Time (ET)</th>
                <th style={th}>Game</th>
                <th style={th}>Market</th>
                <th style={th}>Side</th>
                <th style={{ ...th, textAlign: "right" }}>Contracts</th>
                <th style={{ ...th, textAlign: "right" }}>Cost</th>
                <th style={{ ...th, textAlign: "right" }}>Fill</th>
                <th style={th}>Venue</th>
                <th style={th}>Order id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const p = row.protect && typeof row.protect === "object" ? row.protect : null;
                const key = typeof row.id === "string" && row.id ? row.id : "fill-" + index;
                return (
                  <React.Fragment key={key}>
                    <tr>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "#d1d5db" }}>{txt(row.timeEt, "—")}</td>
                      <td style={td}>{txt(row.game, "—")}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{txt(row.market, "—")}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 700 }}>{txt(row.sideLabel, "—")}</span>
                        {row.partial && <Badge tone="amber">partial{txt(row.orderProgress) ? " · " + row.orderProgress : ""}</Badge>}
                        {p && <Badge tone="green">Bet Protect</Badge>}
                        {!p && row.source === "desk" && <Badge tone="blue">Desk · Protect armed</Badge>}
                        {row.source === "combo" && <Badge tone="gray">Combo</Badge>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{txt(row.contractsLabel, "—")}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                        {txt(row.costLabel, "—")}
                        {row.costKind === "proceeds" && <div style={{ fontSize: 10, color: "#6b7280" }}>proceeds</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 800, color: p ? "#6ee7b7" : "#f9fafb" }}>
                        {txt(row.fillAmerican, "—")}
                        {!p && txt(row.limitAmerican) && row.limitAmerican !== row.fillAmerican && (
                          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>limit {row.limitAmerican}</div>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "#9ca3af" }}>{txt(row.venue, "Polymarket US")}{txt(row.role) ? <div style={{ fontSize: 10, color: "#6b7280" }}>{row.role}</div> : null}</td>
                      <td style={{ ...td, fontFamily: mono, fontSize: 11, color: "#9ca3af", wordBreak: "break-all" }}>{txt(row.orderId, "—")}</td>
                    </tr>
                    {p && (
                      <tr>
                        <td style={{ padding: "0 0 10px 0" }} />
                        <td colSpan={8} style={{ padding: "0 0 10px 0" }}>
                          <div style={{ display: "inline-block", padding: "6px 10px", borderRadius: 8, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", color: "#a7f3d0", fontSize: 12, fontFamily: mono }}>
                            {txt(p.line)}
                            {txt(p.improvementLabel) ? <span style={{ color: "#6ee7b7", fontWeight: 800 }}>{" · " + p.improvementLabel}</span> : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
