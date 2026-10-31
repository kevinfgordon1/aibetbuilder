import { formatAmericanOdds } from "./trueOddsLine.js";
import { ncaamChampionRows, fmtProfit } from "./ncaamChampion.js";

// NCAAM national champion: best Yes (books + Kalshi + Polymarket US), best opposing price (Kalshi /
// Polymarket US, each with its own fee), inverse-bet fair, EV, and depth as potential profit. American odds.
export default function NcaamChampionView({ entry, selectedBooks, search, books }) {
  const rows = ncaamChampionRows(entry?.teams || [], { selected: selectedBooks, search });
  const label = (key) => (books || []).find((b) => b.key === key)?.label || key;
  const th = { padding: "12px 10px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" };
  const td = { padding: "10px 10px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,0.03)" };
  const sub = { display: "block", fontSize: 10, color: "#6b7280", fontWeight: 500, marginTop: 2 };
  return (
    <div data-testid="ncaam-champion-view" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <th style={{ ...th, textAlign: "left", padding: "12px 16px" }}>NCAAM Champion</th>
            <th style={{ ...th, color: "#10b981" }}>Best Yes</th>
            <th style={th}>Yes depth</th>
            <th style={{ ...th, color: "#ef4444" }}>Best opposing</th>
            <th style={th}>Opp. depth</th>
            <th style={th}>Fair (inverse)</th>
            <th style={th}>EV</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#4b5563", fontSize: 14 }}>No NCAAM champion odds posted yet{search ? ` for "${search}"` : ""}.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 600, color: "#e8eaed", padding: "10px 16px" }}>{r.name}</td>
              <td style={{ ...td, color: "#10b981", fontWeight: 700 }}>{formatAmericanOdds(r.yes)}<span style={sub}>{r.yesBooks.map(label).join(", ")}</span></td>
              <td style={td}>{fmtProfit(r.yesProfit)}</td>
              <td style={{ ...td, color: r.no == null ? "#2d3748" : "#f87171", fontWeight: 700 }}>{formatAmericanOdds(r.no)}<span style={sub}>{r.noBooks.map(label).join(", ")}</span></td>
              <td style={td}>{fmtProfit(r.noProfit)}</td>
              <td style={{ ...td, color: "#9ca3af" }}>{formatAmericanOdds(r.fairAmerican)}</td>
              <td style={{ ...td, fontWeight: 700, color: r.evPct == null ? "#2d3748" : r.evPct > 0 ? "#10b981" : "#9ca3af" }}>{r.evPct == null ? "—" : `${r.evPct > 0 ? "+" : ""}${r.evPct.toFixed(1)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "8px 16px", fontSize: 11, color: "#6b7280" }}>
        Opposing price = best "will not win" on Kalshi or Polymarket US, fees in. Fair = 1 − its implied probability. Depth = potential profit at the top-of-book price.
      </div>
    </div>
  );
}
