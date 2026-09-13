// Shared P/L Statement dashboard chrome — filters, metric cards, lock rows.
// Used by Profile (P/L statement) and Combo Locks History so both surfaces
// share one design language. Data comes from comboStatement.js.

import React, { useEffect, useMemo, useState } from "react";
import {
  STATEMENT_DATE_FILTERS,
  STATEMENT_DEFAULT_DATE_RANGE,
  STATEMENT_KIND_FILTERS,
  STATEMENT_RESULT_FILTERS,
  applyStatementFilters,
  formatStatementPnl,
  sportLabel,
  statementCsv,
  statementCsvFilename,
  statementSportsPresent,
} from "./comboStatement";

export const STATEMENT_BOARD_CSS = `
  .sb .filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 14px}
  .sb .filters .chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 8px;font:inherit;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#9ca3af;cursor:pointer}
  .sb .filters .chip.on{background:rgba(59,130,246,.2);color:#93c5fd;border-color:rgba(59,130,246,.35)}
  .sb .search{flex:1;min-width:160px;max-width:260px;width:auto;padding:6px 10px;margin:0;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:inherit}
  .sb .btn{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#e8eaed;font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;cursor:pointer}
  .sb .btn:disabled{opacity:.45;cursor:default}
  .sb .muted{color:#6b7280;font-size:13px;line-height:1.5}
  .sb .num{font-variant-numeric:tabular-nums}
  .sb .pos{color:#34d399}.sb .neg{color:#f87171}
  .sb .stmt-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .sb .stmt-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;margin:0}
  .sb .stmt-card .k{font-size:13px}
  .sb .stmt-card .v{font-variant-numeric:tabular-nums;font-weight:800;margin-top:4px}
  .sb table{width:100%;border-collapse:collapse;font-size:13px}
  .sb th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;padding:6px 8px}
  .sb td{padding:8px;border-top:1px solid rgba(255,255,255,0.06);vertical-align:top}
  .sb .stmt-row{cursor:pointer}
  .sb .stmt-row:hover td{background:rgba(255,255,255,0.03)}
  .sb .stmt-row:focus{outline:2px solid rgba(59,130,246,0.45);outline-offset:-2px}
  .sb .stmt-row.open td{background:rgba(147,197,253,.06)}
  .sb .stmt-title{font-weight:600;color:#e8eaed}
  .sb .stmt-sub{font-size:12px;margin-top:3px;line-height:1.4}
  .sb .link{background:none;border:none;color:#67e8f9;font:inherit;font-weight:600;cursor:pointer;padding:0}
  .sb .stmt-detail td{border-top:none;padding:0 8px 14px}
  .sb .stmt-detail-inner{padding:10px 4px 4px;border-top:1px solid rgba(255,255,255,0.06)}
`;

function FilterLabel({ children }) {
  return (
    <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 2 }}>{children}</span>
  );
}

function FilterDot() {
  return <span className="muted" style={{ margin: "0 4px" }}>·</span>;
}

export function downloadStatementCsv(lines) {
  if (!lines || !lines.length) return false;
  const blob = new Blob([statementCsv(lines)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = statementCsvFilename();
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function useStatementView(statement) {
  const [dateRange, setDateRange] = useState(STATEMENT_DEFAULT_DATE_RANGE);
  const [kindFilter, setKindFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput), 150);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const sportsPresent = useMemo(
    () => statementSportsPresent(statement && statement.lines),
    [statement],
  );

  useEffect(() => {
    if (sportFilter !== "all" && sportsPresent.length && !sportsPresent.includes(sportFilter)) {
      setSportFilter("all");
    }
  }, [sportFilter, sportsPresent]);

  const filtered = useMemo(
    () => applyStatementFilters(statement, {
      dateRange,
      kind: kindFilter,
      result: resultFilter,
      sport: sportFilter,
      query: searchQuery,
    }),
    [statement, dateRange, kindFilter, resultFilter, sportFilter, searchQuery],
  );

  return {
    dateRange,
    setDateRange,
    kindFilter,
    setKindFilter,
    resultFilter,
    setResultFilter,
    sportFilter,
    setSportFilter,
    searchInput,
    setSearchInput,
    sportsPresent,
    filtered,
  };
}

export function StatementFilters({
  view,
  onExportCsv,
  showCsv = true,
  ariaLabel = "Statement filters",
}) {
  const {
    dateRange,
    setDateRange,
    kindFilter,
    setKindFilter,
    resultFilter,
    setResultFilter,
    sportFilter,
    setSportFilter,
    searchInput,
    setSearchInput,
    sportsPresent,
    filtered,
  } = view;
  return (
    <div className="filters" role="group" aria-label={ariaLabel}>
      <FilterLabel>Time</FilterLabel>
      {STATEMENT_DATE_FILTERS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={"chip" + (dateRange === c.key ? " on" : "")}
          aria-pressed={dateRange === c.key}
          onClick={() => setDateRange(c.key)}
        >{c.label}</button>
      ))}
      <FilterDot />
      <FilterLabel>Kind</FilterLabel>
      {STATEMENT_KIND_FILTERS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={"chip" + (kindFilter === c.key ? " on" : "")}
          aria-pressed={kindFilter === c.key}
          onClick={() => setKindFilter(c.key)}
        >{c.label}</button>
      ))}
      <FilterDot />
      <FilterLabel>Result</FilterLabel>
      {STATEMENT_RESULT_FILTERS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={"chip" + (resultFilter === c.key ? " on" : "")}
          aria-pressed={resultFilter === c.key}
          onClick={() => setResultFilter(c.key)}
        >{c.label}</button>
      ))}
      {sportsPresent.length > 0 && (
        <>
          <FilterDot />
          <FilterLabel>Sport</FilterLabel>
          <button
            type="button"
            className={"chip" + (sportFilter === "all" ? " on" : "")}
            aria-pressed={sportFilter === "all"}
            onClick={() => setSportFilter("all")}
          >All</button>
          {sportsPresent.map((s) => (
            <button
              key={s}
              type="button"
              className={"chip" + (sportFilter === s ? " on" : "")}
              aria-pressed={sportFilter === s}
              onClick={() => setSportFilter(s)}
            >{sportLabel(s)}</button>
          ))}
        </>
      )}
      <input
        className="search"
        type="search"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search locks or teams"
        aria-label="Search locks or teams"
      />
      {showCsv ? (
        <button
          type="button"
          className="btn"
          onClick={onExportCsv}
          disabled={!filtered.lines.length}
          aria-label="Download filtered statement as CSV"
        >CSV</button>
      ) : null}
    </div>
  );
}

export function StatementSummary({ filtered }) {
  return (
    <>
      <div className="stmt-cards">
        <div className="stmt-card">
          <div className="muted k">Realized</div>
          <div className={"v num " + (filtered.realized >= 0 ? "pos" : "neg")} style={{ fontSize: 24 }}>{formatStatementPnl(filtered.realized)}</div>
        </div>
        <div className="stmt-card">
          <div className="muted k">Locked fills</div>
          <div className={"v num " + (filtered.lockedFillPnl >= 0 ? "pos" : "neg")} style={{ fontSize: 20, fontWeight: 700 }}>{formatStatementPnl(filtered.lockedFillPnl)}</div>
          <div className="muted">{filtered.lockedFills} settled</div>
        </div>
        <div className="stmt-card">
          <div className="muted k">Unfilled (risk profile)</div>
          <div className={"v num " + (filtered.unfilledPnl >= 0 ? "pos" : "neg")} style={{ fontSize: 20, fontWeight: 700 }}>{formatStatementPnl(filtered.unfilledPnl)}</div>
          <div className="muted">{filtered.unfilledSettled} settled</div>
        </div>
      </div>
      {filtered.pending > 0 && <div className="muted" style={{ marginBottom: 10 }}>{filtered.pending} still open or awaiting a result.</div>}
    </>
  );
}

function lineActionLabel(line, { isExpanded, actionLabel }) {
  if (typeof actionLabel === "function") return actionLabel(line);
  if (isExpanded && isExpanded(line)) return "Hide lock";
  return actionLabel || "Open lock";
}

export function StatementLines({
  lines,
  onOpenLock,
  isExpanded,
  renderExpanded,
  actionLabel,
  rowTitle,
}) {
  const showAction = typeof onOpenLock === "function";
  const colSpan = showAction ? 3 : 2;
  return (
    <table>
      <thead><tr><th>Lock</th><th>P/L</th>{showAction ? <th></th> : null}</tr></thead>
      <tbody>
        {lines.map((line) => {
          const clickable = showAction;
          const open = !!(isExpanded && isExpanded(line));
          const activate = () => onOpenLock && onOpenLock(line.id, line);
          const title = typeof rowTitle === "function" ? rowTitle(line, open) : rowTitle;
          return (
            <React.Fragment key={line.id}>
              <tr
                id={"lock-" + line.id}
                className={(clickable ? "stmt-row" : "") + (open ? " open" : "")}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? "button" : undefined}
                aria-expanded={clickable ? open : undefined}
                aria-label={clickable ? `${lineActionLabel(line, { isExpanded, actionLabel })} ${line.label}` : undefined}
                title={title}
                onClick={clickable ? activate : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate();
                  }
                } : undefined}
              >
                <td>
                  <div className="stmt-title">{line.label}</div>
                  <div className="muted stmt-sub">{line.dateCopy} · {line.kindLabel} · {line.resultLabel}</div>
                </td>
                <td className={"num " + (line.pnl == null ? "" : line.pnl >= 0 ? "pos" : "neg")}>{formatStatementPnl(line.pnl)}</td>
                {showAction ? (
                  <td>
                    <span className="link">{lineActionLabel(line, { isExpanded, actionLabel })}</span>
                  </td>
                ) : null}
              </tr>
              {open && renderExpanded ? (
                <tr className="stmt-detail">
                  <td colSpan={colSpan}>
                    <div className="stmt-detail-inner">{renderExpanded(line)}</div>
                  </td>
                </tr>
              ) : null}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default function StatementBoard({
  statement,
  view,
  onOpenLock,
  isExpanded,
  renderExpanded,
  actionLabel = "Open lock",
  rowTitle,
  onExportCsv,
  showCsv = true,
  filtersAriaLabel = "Statement filters",
  emptyText = "No lock history yet.",
  noMatchText = "No locks match these filters.",
}) {
  const filtered = view.filtered;
  return (
    <div className="sb">
      <style>{STATEMENT_BOARD_CSS}</style>
      <StatementFilters
        view={view}
        onExportCsv={onExportCsv}
        showCsv={showCsv}
        ariaLabel={filtersAriaLabel}
      />
      <StatementSummary filtered={filtered} />
      {!statement || statement.lines.length === 0 ? (
        <div className="muted">{emptyText}</div>
      ) : filtered.lines.length === 0 ? (
        <div className="muted">{noMatchText}</div>
      ) : (
        <StatementLines
          lines={filtered.lines}
          onOpenLock={onOpenLock}
          isExpanded={isExpanded}
          renderExpanded={renderExpanded}
          actionLabel={actionLabel}
          rowTitle={rowTitle}
        />
      )}
    </div>
  );
}
