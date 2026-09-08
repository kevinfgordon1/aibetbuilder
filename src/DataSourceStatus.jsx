// Small shared "data source unhealthy" chrome — banner, chip, Updated stamp.
// Healthy path renders nothing extra so Promo / Odds / +EV look unchanged.

import { describeCacheFreshness } from "./dataSourceHealth.js";

const WARN_BG = "rgba(245,158,11,.12)";
const WARN_BORDER = "rgba(245,158,11,.35)";
const WARN_FG = "#fcd34d";

export function DataSourceBanner({ status, style }) {
  if (!status || !status.show) return null;
  return (
    <div
      data-guard-allow="true"
      role="status"
      style={{
        margin: "12px 0 0",
        padding: "10px 14px",
        borderRadius: 10,
        background: WARN_BG,
        border: `1px solid ${WARN_BORDER}`,
        color: WARN_FG,
        fontSize: 13,
        lineHeight: 1.45,
        ...style,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: status.message ? 4 : 0 }}>{status.title}</div>
      {status.message ? <div style={{ color: "#fde68a", fontWeight: 500 }}>{status.message}</div> : null}
    </div>
  );
}

export function DataSourceChip({ status, label, className, style }) {
  const text = label || (status && status.show ? status.chip : null);
  if (!text) return null;
  return (
    <span
      className={className}
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: WARN_BG,
        border: `1px solid ${WARN_BORDER}`,
        color: WARN_FG,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </span>
  );
}

export function OddsUpdatedStamp({ freshness, fetchedAt, now, lastRefreshFailed, lastRefreshError, style }) {
  const info = freshness || describeCacheFreshness({
    fetchedAt,
    now,
    lastRefreshFailed,
    lastRefreshError,
  });
  if (!info || !info.show) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 11, color: info.warn ? WARN_FG : "#4b5563", fontWeight: info.warn ? 600 : 400 }}>
          {info.label}
          {info.stale ? " · stale" : ""}
          {info.failed ? " · last refresh failed" : ""}
        </div>
        {info.chip ? <DataSourceChip label={info.chip} /> : null}
      </div>
      {info.hint ? (
        <div style={{ fontSize: 10, color: WARN_FG, maxWidth: 320, lineHeight: 1.35, textAlign: "right" }}>
          {info.hint}
        </div>
      ) : null}
    </div>
  );
}
