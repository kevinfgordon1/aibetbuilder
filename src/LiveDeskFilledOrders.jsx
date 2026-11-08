// Filled orders for the private Live Trading Desk. One summary per order id,
// newest first, with each execution behind a keyboard-accessible disclosure.
// Rows come from GET /api/live-trading-desk (board.fills).
import React, { useState } from "react";
import { filterFills, readFillsFilter, writeFillsFilter } from "./liveDeskPositionFills";
import { groupFillsByOrder } from "./liveDeskFillGroups";

function safeStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch (_) { return null; }
}

const mono = "'JetBrains Mono', monospace";

function txt(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function Badge({ children, tone }) {
  const tones = {
    green: { bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.4)", fg: "#6ee7b7" },
    amber: { bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.4)", fg: "#fcd34d" },
    gray: { bg: "rgba(255,255,255,0.04)", bd: "rgba(255,255,255,0.12)", fg: "#9ca3af" },
    blue: { bg: "rgba(212,175,55,0.12)", bd: "rgba(212,175,55,0.35)", fg: "#f5d76e" },
  };
  const t = tones[tone] || tones.gray;
  return (
    <span style={{ display: "inline-block", marginLeft: 6, padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: t.bg, border: "1px solid " + t.bd, color: t.fg, whiteSpace: "nowrap", verticalAlign: "middle" }}>{children}</span>
  );
}

function statusBadge(group) {
  if (group.status === "full") return <Badge tone="green">Filled{group.progress ? " · " + group.progress : ""}</Badge>;
  if (group.status === "partial") return <Badge tone="amber">Partial{group.progress ? " · " + group.progress : ""}</Badge>;
  if (group.status === "canceled") return <Badge tone="gray">Canceled{group.progress ? " · " + group.progress : ""}</Badge>;
  if (group.status === "expired") return <Badge tone="gray">Expired{group.progress ? " · " + group.progress : ""}</Badge>;
  return null;
}

export default function LiveDeskFilledOrders({ fills, stale, failed, note, style }) {
  const allRows = (Array.isArray(fills) ? fills : []).filter((row) => row && typeof row === "object");
  const [mode, setMode] = useState(() => readFillsFilter(safeStorage()));
  const [open, setOpen] = useState(() => new Set());
  const pickMode = (next) => {
    setMode(next);
    writeFillsFilter(safeStorage(), next);
  };
  const toggle = (key) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const rows = filterFills(allRows, mode);
  const groups = groupFillsByOrder(rows);
  const deskGroups = groupFillsByOrder(filterFills(allRows, "desk"));
  const allGroups = groupFillsByOrder(allRows);
  const protectCount = groups.filter((group) => group.protect).length;
  return (
    <section style={style}>
      <style>{`
        .desk-fill-summary {
          display: grid;
          grid-template-columns: 16px minmax(140px, 1.6fr) minmax(120px, 1fr) 72px 72px 88px minmax(88px, 0.7fr);
          gap: 8px 10px;
          align-items: center;
          width: 100%;
          text-align: left;
          background: transparent;
          color: inherit;
          border: 0;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 0;
          cursor: pointer;
          font: inherit;
        }
        .desk-fill-summary:focus-visible { outline: 2px solid #d4af37; outline-offset: 2px; }
        .desk-fill-exec {
          display: grid;
          grid-template-columns: minmax(140px, 1.4fr) 72px 72px 88px 72px;
          gap: 8px 10px;
          padding: 6px 0 6px 26px;
          font-size: 12px;
          color: #d1d5db;
        }
        @media (max-width: 800px) {
          .desk-fill-summary { grid-template-columns: 16px 1fr 1fr; }
          .desk-fill-summary .desk-fill-wide { grid-column: 2 / -1; }
          .desk-fill-exec { grid-template-columns: 1fr 1fr; padding-left: 16px; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>
          Filled orders{stale ? " · stale" : ""}
          <span style={{ color: "#6b7280", fontWeight: 600 }}> · {groups.length} order{groups.length === 1 ? "" : "s"}{protectCount ? " · " + protectCount + " via Bet Protect" : ""}</span>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>One row per order, newest first · open a row for each execution · American odds · times ET</div>
      </div>
      <div role="group" aria-label="Filter filled orders" style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[["desk", "Desk only", deskGroups.length], ["all", "All", allGroups.length]].map(([id, label, count]) => {
          const on = mode === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => pickMode(id)}
              title={id === "desk" ? "Fills tagged Desk (orders rested from this desk, incl. Bet Protect)" : "Every fill, incl. Combo Locks hedge fills tagged Combo"}
              style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", background: on ? "rgba(212,175,55,0.18)" : "rgba(255,255,255,0.04)", border: "1px solid " + (on ? "rgba(212,175,55,0.5)" : "rgba(255,255,255,0.12)"), color: on ? "#bfdbfe" : "#9ca3af" }}
            >{label} <span style={{ opacity: 0.7 }}>{count}</span></button>
          );
        })}
      </div>
      {note && <div style={{ marginTop: 8, fontSize: 12, color: "#fcd34d" }}>{note}</div>}
      {stale && <div style={{ color: "#fcd34d", fontSize: 12, marginTop: 8 }}>Last loaded fills, marked stale until Polymarket accepts a refresh.</div>}
      {groups.length === 0 && (
        <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>{failed ? "Fills did not load. Retrying on the next refresh." : (mode === "desk" && allRows.length ? "No desk fills in the latest " + allRows.length + ". Tap All to see Combo and other fills." : "No fills yet.")}</div>
      )}
      <div style={{ marginTop: groups.length ? 4 : 0 }}>
        {groups.map((group) => {
          const expanded = open.has(group.key);
          const panelId = "desk-fill-exec-" + group.key.replace(/[^a-zA-Z0-9_-]/g, "-");
          const p = group.protect;
          return (
            <article key={group.key}>
              <button
                type="button"
                className="desk-fill-summary"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(group.key)}
              >
                <span aria-hidden="true" style={{ color: "#9ca3af", fontSize: 12 }}>{expanded ? "▾" : "▸"}</span>
                <span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{txt(group.sideLabel, "—")}</span>
                  {statusBadge(group)}
                  {p && <Badge tone="green">Bet Protect</Badge>}
                  {!p && group.source === "desk" && <Badge tone="blue">Desk</Badge>}
                  {group.source === "combo" && <Badge tone="gray">Combo</Badge>}
                  <span style={{ display: "block", color: "#9ca3af", fontSize: 12, marginTop: 2 }}>{txt(group.game, "—")} · {txt(group.market, "—")}</span>
                </span>
                <span className="desk-fill-wide" style={{ color: "#d1d5db", fontSize: 12, whiteSpace: "nowrap" }}>{txt(group.timeEt, "—")}</span>
                <span style={{ textAlign: "right", fontFamily: mono, fontSize: 13 }}>{txt(group.contractsLabel, "—")}</span>
                <span style={{ textAlign: "right", fontFamily: mono, fontWeight: 800, fontSize: 13, color: p ? "#6ee7b7" : "#f9fafb" }}>{txt(group.avgAmerican, "—")}</span>
                <span style={{ textAlign: "right", fontFamily: mono, fontSize: 13 }}>
                  {txt(group.costLabel, "—")}
                  {group.feesLabel ? <span style={{ display: "block", fontSize: 10, color: "#6b7280", fontWeight: 600 }}>fees {group.feesLabel}</span> : null}
                  {group.costKind === "proceeds" && <span style={{ display: "block", fontSize: 10, color: "#6b7280" }}>proceeds</span>}
                </span>
                <span className="desk-fill-wide" style={{ fontFamily: mono, fontSize: 11, color: "#9ca3af" }} title={txt(group.orderId, "")}>{txt(group.compactOrderId, "—")}</span>
              </button>
              {expanded && (
                <div id={panelId} role="region" aria-label={"Executions for " + (group.orderId || "order")}>
                  {(p || group.replacedBy || group.replaces) && (
                    <div style={{ margin: "0 0 6px 26px", fontSize: 12, color: "#a7f3d0", fontFamily: mono }}>
                      {p ? txt(p.line) : ""}
                      {p && txt(p.improvementLabel) ? " · " + txt(p.improvementLabel) : ""}
                      {group.replacedBy ? (p ? " · " : "") + "Re-rested as " + group.replacedBy : ""}
                      {group.replaces ? " · Re-rest of " + group.replaces : ""}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1.4fr) 72px 72px 88px 72px", gap: "0 10px", padding: "0 0 4px 26px", fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: 0.4, textTransform: "uppercase" }} className="desk-fill-exec">
                    <span>Time (ET)</span><span style={{ textAlign: "right" }}>Size</span><span style={{ textAlign: "right" }}>Price</span><span style={{ textAlign: "right" }}>Cost</span><span style={{ textAlign: "right" }}>Fee</span>
                  </div>
                  {group.executions.map((exec) => (
                    <div key={exec.id || exec.time} className="desk-fill-exec" style={{ fontFamily: mono, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <span>{txt(exec.timeEt, "—")}</span>
                      <span style={{ textAlign: "right" }}>{txt(exec.contractsLabel, "—")}</span>
                      <span style={{ textAlign: "right" }}>{txt(exec.fillAmerican, "—")}</span>
                      <span style={{ textAlign: "right" }}>{txt(exec.costLabel, "—")}</span>
                      <span style={{ textAlign: "right", color: "#9ca3af" }}>{txt(exec.feeLabel, "—")}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
