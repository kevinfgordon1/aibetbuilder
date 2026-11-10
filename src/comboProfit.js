// Cumulative realized profit for Combo Locks History.
// Input is the statement lines History already built for the signed-in user
// (combo_parlays filtered to that user). No queries, no other users' rows.

import { formatStatementDate, lineInDateWindow, statementDateWindow } from "./comboStatement.js";
import { signedDollars } from "./comboLockView.js";

export const PROFIT_CHART_MAX_POINTS = 360;

function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function tsMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function linePnl(line) {
  if (!line || line.settled !== true || line.pnl == null || line.pnl === "") return null;
  const n = typeof line.pnl === "string" ? parseFloat(line.pnl) : Number(line.pnl);
  return Number.isFinite(n) ? n : null;
}

function lineAt(line) {
  return (line && (line.sortAt || line.createdAt || line.at)) || null;
}

/**
 * Running realized P/L for settled locks, oldest settlement first.
 * Date windows match the History "When" filter. Open locks are left out.
 * `total` is the same cents-rounded sum History uses for net profit.
 */
export function cumulativeRealizedProfit(lines, { dateRange = "all", now } = {}) {
  const window = statementDateWindow(dateRange, now);
  const settled = [];
  for (const line of lines || []) {
    const pnl = linePnl(line);
    if (pnl == null) continue;
    if (!lineInDateWindow(line, window)) continue;
    const at = lineAt(line);
    settled.push({ line, pnl, at, ms: tsMs(at) });
  }
  settled.sort((a, b) => {
    const ta = a.ms == null ? 0 : a.ms;
    const tb = b.ms == null ? 0 : b.ms;
    if (ta !== tb) return ta - tb;
    const ia = String((a.line && a.line.id) || "");
    const ib = String((b.line && b.line.id) || "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  let sum = 0;
  const points = settled.map(({ line, pnl, at }) => {
    sum += pnl;
    return {
      id: line.id,
      at,
      pnl: r2(pnl),
      cumulative: r2(sum),
    };
  });
  return {
    points,
    total: points.length ? r2(sum) : 0,
    count: points.length,
    range: window.preset,
  };
}

/** Evenly thin a cumulative series for drawing. Keeps the ends and the high and low. */
export function sampleProfitPoints(points, max = PROFIT_CHART_MAX_POINTS) {
  const list = points || [];
  const cap = Math.floor(Number(max));
  if (list.length <= cap || cap < 2) return list.slice();
  let minI = 0;
  let maxI = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].cumulative < list[minI].cumulative) minI = i;
    if (list[i].cumulative > list[maxI].cumulative) maxI = i;
  }
  const want = new Set([0, list.length - 1, minI, maxI]);
  const room = cap - want.size;
  if (room > 0) {
    const step = (list.length - 1) / (room + 1);
    for (let i = 1; i <= room; i++) want.add(Math.min(list.length - 1, Math.max(0, Math.round(i * step))));
  }
  return [...want].sort((a, b) => a - b).map((i) => list[i]);
}

const RANGE_LABEL = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export const PROFIT_IMAGE_FILENAME = "combo-locks-running-profit.png";

function axisDollars(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "$0";
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  let body;
  if (abs >= 1000000) body = (abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  else if (abs >= 10000) body = Math.round(abs / 1000) + "k";
  else if (abs >= 1000) body = (abs / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  else if (abs >= 100) body = String(Math.round(abs));
  else body = abs.toFixed(abs < 10 ? 2 : 0);
  return sign + "$" + body;
}

/**
 * Screen geometry for the running-profit line. Higher profit is a smaller y.
 * Shared by the on-page SVG and the share image so they match.
 */
export function profitChartLayout(points, box = {}) {
  const width = box.width || 640;
  const height = box.height || 176;
  const padL = box.padL != null ? box.padL : 56;
  const padR = box.padR != null ? box.padR : 16;
  const padT = box.padT != null ? box.padT : 16;
  const padB = box.padB != null ? box.padB : 28;
  const shown = sampleProfitPoints(points);
  if (!shown.length) return null;
  const vals = shown.map((p) => Number(p.cumulative) || 0);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi - lo < 0.01) { lo -= 1; hi += 1; }
  const span = hi - lo || 1;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const yAt = (v) => padT + (1 - (v - lo) / span) * innerH;
  const times = shown.map((p) => tsMs(p && p.at));
  const known = times.filter((t) => t != null);
  const t0 = known.length ? Math.min(...known) : null;
  const t1 = known.length ? Math.max(...known) : null;
  const tSpan = t0 != null && t1 != null ? t1 - t0 : 0;
  const xAt = (p, i) => {
    const ms = tsMs(p && p.at);
    if (!(tSpan > 0) || ms == null) {
      return padL + (shown.length === 1 ? innerW / 2 : (i / Math.max(1, shown.length - 1)) * innerW);
    }
    return padL + ((ms - t0) / tSpan) * innerW;
  };
  const coords = shown.map((p, i) => ({ x: xAt(p, i), y: yAt(Number(p.cumulative) || 0) }));
  const zeroY = yAt(0);
  const hiY = yAt(hi);
  const loY = yAt(lo);
  const near = (a, b) => Math.abs(a - b) < 16;
  const labels = [{ text: axisDollars(hi), x: padL - 8, y: hiY, anchor: "end" }];
  if (!near(zeroY, hiY) && !near(zeroY, loY)) labels.push({ text: "$0", x: padL - 8, y: zeroY, anchor: "end" });
  if (Math.abs(lo) >= 0.005 && !near(loY, hiY) && !near(loY, zeroY)) {
    labels.push({ text: axisDollars(lo), x: padL - 8, y: loY, anchor: "end" });
  }
  return {
    width,
    height,
    padL,
    padR,
    line: [{ x: coords[0].x, y: zeroY }, ...coords],
    zeroY,
    labels,
    firstDate: formatStatementDate(shown[0].at),
    lastDate: formatStatementDate(shown[shown.length - 1].at),
    end: coords[coords.length - 1],
  };
}

/** Plain card for the share image. No account, name, or email fields. */
export function profitImageModel({ total = 0, count = 0, range = "all", points = [], emptyText = "" } = {}) {
  const n = Math.max(0, Number(count) || 0);
  const series = n ? (points || []) : [];
  const first = series.length ? formatStatementDate(series[0].at) : "";
  const last = series.length ? formatStatementDate(series[series.length - 1].at) : "";
  return {
    kicker: "Combo Locks",
    title: "Running profit",
    totalText: n ? signedDollars(total) : "—",
    tone: !n ? "flat" : total > 0 ? "pos" : total < 0 ? "neg" : "flat",
    countText: n ? `${n} settled lock${n === 1 ? "" : "s"}` : "Settled locks only",
    rangeLabel: RANGE_LABEL[range] || RANGE_LABEL.all,
    spanText: first && last && first !== last ? `${first} – ${last}` : (first || ""),
    emptyText: n ? "" : (emptyText || "No settled locks yet."),
    points: series,
    brand: "aibetbuilder.io",
  };
}

/** "share" when the browser can send a PNG file; otherwise the button downloads it. */
export function profitShareDelivery(canShareFiles) {
  return canShareFiles ? "share" : "download";
}

export function profitImageCanShareFiles(file, nav) {
  if (!file || !nav || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export function profitImageCanCopy(nav, ClipboardItemRef) {
  return !!(
    nav && nav.clipboard && typeof nav.clipboard.write === "function"
    && typeof ClipboardItemRef === "function"
  );
}
