// Cumulative realized profit for Combo Locks History.
// Input is the statement lines History already built for the signed-in user
// (combo_parlays filtered to that user). No queries, no other users' rows.

import { formatStatementDate, lineInDateWindow, normalizeStatementDateRange, statementDateWindow, STATEMENT_TZ } from "./comboStatement.js";
import { signedDollars } from "./comboLockView.js";

export const PROFIT_CHART_MAX_POINTS = 2500;
export const PROFIT_CHART_HEIGHT = 128;

// On-screen sizes in CSS pixels. The SVG uses non-scaling-stroke so a wide
// chart (the Combo Locks page is often ~900px) stays this thin.
export const PROFIT_STROKE_PX = 1.5;
export const EV_STROKE_PX = 1.25;
export const EV_DASH_PX = [2, 2];
export const PROFIT_DOT_PX = 2.25;
export const EV_DOT_PX = 2;

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

function lineExpectedPnl(line) {
  if (!line || line.expectedPnl == null || line.expectedPnl === "") return null;
  const n = typeof line.expectedPnl === "string" ? parseFloat(line.expectedPnl) : Number(line.expectedPnl);
  return Number.isFinite(n) ? n : null;
}

function lineAt(line) {
  return (line && (line.sortAt || line.createdAt || line.at)) || null;
}

/**
 * Running realized P/L for settled locks, oldest settlement first.
 * Date windows match the History "When" filter. Open locks are left out.
 * `total` is the same cents-rounded sum History uses for net profit.
 * `hasEv` is true when at least one visible settled lock has fair-odds EV.
 * Locks without fair odds still appear on the EV line, using their realized
 * P/L as the contribution so both lines stay on the same settlements.
 * `evKnown` is how many locks used real fair-odds EV.
 */
export function cumulativeRealizedProfit(lines, { dateRange = "all", now } = {}) {
  const window = statementDateWindow(dateRange, now);
  const settled = [];
  for (const line of lines || []) {
    const pnl = linePnl(line);
    if (pnl == null) continue;
    if (!lineInDateWindow(line, window)) continue;
    const at = lineAt(line);
    settled.push({ line, pnl, ev: lineExpectedPnl(line), at, ms: tsMs(at) });
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
  let evSum = 0;
  let evKnown = 0;
  const points = settled.map(({ line, pnl, ev, at }) => {
    sum += pnl;
    const evValue = ev == null ? null : r2(ev);
    if (evValue != null) evKnown += 1;
    // Missing fair odds: use realized P/L so the EV line stays aligned with profit.
    evSum += evValue != null ? evValue : pnl;
    return {
      id: line.id,
      at,
      pnl: r2(pnl),
      cumulative: r2(sum),
      ev: evValue,
      evFromRealized: evValue == null,
      cumulativeEv: r2(evSum),
    };
  });
  const hasEv = evKnown > 0;
  if (!hasEv) {
    for (const point of points) point.cumulativeEv = null;
  }
  const count = points.length;
  const evLegend = !hasEv ? "" : (evKnown === count ? "EV" : `EV (${evKnown} of ${count} locks)`);
  const evNote = hasEv && evKnown < count
    ? "Locks without fair odds use their realized P/L so the lines stay comparable."
    : "";
  return {
    points,
    total: count ? r2(sum) : 0,
    evTotal: hasEv ? r2(evSum) : null,
    hasEv,
    evKnown,
    evLegend,
    evNote,
    count,
    range: window.preset,
  };
}

/**
 * Keep every settlement unless the series is huge. When thinning, each bucket
 * keeps its min and max (in time order) so spikes and drops stay visible.
 * This is not a smoother — local extremes are preserved, not averaged.
 */
export function sampleProfitPoints(points, max = PROFIT_CHART_MAX_POINTS) {
  const list = points || [];
  const cap = Math.floor(Number(max));
  if (list.length <= cap || cap < 2) return list.slice();
  const buckets = Math.max(1, Math.floor(cap / 2));
  const want = new Set([0, list.length - 1]);
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * list.length) / buckets);
    const end = Math.floor(((b + 1) * list.length) / buckets) - 1;
    if (end < start) continue;
    let minI = start;
    let maxI = start;
    for (let i = start + 1; i <= end; i++) {
      if (list[i].cumulative < list[minI].cumulative) minI = i;
      if (list[i].cumulative > list[maxI].cumulative) maxI = i;
    }
    want.add(minI);
    want.add(maxI);
  }
  return [...want].sort((a, b) => a - b).map((i) => list[i]);
}

/**
 * Index of the sample whose x is nearest to `x`. Samples must be sorted by
 * non-decreasing x (the chart layout is). Binary search, so a 1,144-point
 * series is a handful of comparisons per pointer move.
 */
export function nearestProfitIndex(samples, x) {
  const n = samples ? samples.length : 0;
  const target = Number(x);
  if (!n || !Number.isFinite(target)) return -1;
  let lo = 0;
  let hi = n - 1;
  if (target <= samples[lo].x) return lo;
  if (target >= samples[hi].x) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].x <= target) lo = mid;
    else hi = mid;
  }
  return (target - samples[lo].x) <= (samples[hi].x - target) ? lo : hi;
}

const TIP_WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TIP_CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed dollars for the hover tooltip. Whole amounts drop the cents: "+$54,210". */
export function profitTipDollars(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 0.005) return "+$0";
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const body = whole ? TIP_WHOLE.format(Math.round(abs)) : TIP_CENTS.format(abs);
  return (n < 0 ? "-$" : "+$") + body;
}

/**
 * Tooltip top-left inside a chart box. Prefers just to the right of the
 * anchor, flips to the left when that would clip, then clamps to the margin.
 * All values are pixels in the same space.
 */
export function profitTipBox({ boxW, boxH, anchorX, anchorY, tipW, tipH, gap = 8, margin = 4 } = {}) {
  const w = Math.max(0, Number(boxW) || 0);
  const h = Math.max(0, Number(boxH) || 0);
  const tw = Math.max(0, Number(tipW) || 0);
  const th = Math.max(0, Number(tipH) || 0);
  const m = Math.max(0, Number(margin) || 0);
  const g = Number(gap) || 0;
  const ax = Number(anchorX) || 0;
  const ay = Number(anchorY) || 0;
  let left = ax + g;
  if (left + tw > w - m) left = ax - g - tw;
  const maxL = Math.max(m, w - tw - m);
  left = Math.min(Math.max(m, left), maxL);
  let top = ay - th / 2;
  const maxT = Math.max(m, h - th - m);
  top = Math.min(Math.max(m, top), maxT);
  return {
    left: Math.round(left * 100) / 100,
    top: Math.round(top * 100) / 100,
  };
}

/** Axis-aligned step path: horizontal to the next x, then vertical to the new value. */
export function stepLine(coords, start) {
  const pts = coords || [];
  if (!pts.length) return start ? [start] : [];
  const out = [];
  const first = pts[0];
  if (start) {
    out.push(start);
    if (first.x !== start.x) out.push({ x: first.x, y: start.y });
    if (first.y !== (out[out.length - 1] && out[out.length - 1].y)) out.push({ x: first.x, y: first.y });
  } else {
    out.push(first);
  }
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const p = pts[i];
    if (p.x !== prev.x) out.push({ x: p.x, y: prev.y });
    if (p.y !== out[out.length - 1].y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

const RANGE_LABEL = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export const PROFIT_IMAGE_FILENAME = "combo-locks-running-profit.png";

const ET_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: STATEMENT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ET_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: STATEMENT_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const ET_DATE_YEAR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: STATEMENT_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

function etParts(ms) {
  const parts = ET_PARTS_FMT.formatToParts(new Date(ms));
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : "";
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** UTC instant for an America/New_York wall-clock date and time. */
export function etWallToUtc(year, month, day, hour = 0, minute = 0) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const w = etParts(utc);
    const asIf = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, 0);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = wanted - asIf;
    if (diff === 0) return utc;
    utc += diff;
  }
  return utc;
}

function startOfEtDay(ms) {
  const w = etParts(ms);
  return etWallToUtc(w.year, w.month, w.day, 0, 0);
}

function addEtDays(ms, days) {
  const w = etParts(ms);
  const rolled = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return etWallToUtc(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, rolled.getUTCDate(), 0, 0);
}

function addEtHours(ms, hours) {
  const w = etParts(ms);
  let h = w.hour + hours;
  let dayDelta = 0;
  while (h >= 24) { h -= 24; dayDelta += 1; }
  while (h < 0) { h += 24; dayDelta -= 1; }
  const rolled = new Date(Date.UTC(w.year, w.month - 1, w.day + dayDelta));
  return etWallToUtc(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, rolled.getUTCDate(), h, 0);
}

function addEtMonths(ms, months) {
  const w = etParts(ms);
  const rolled = new Date(Date.UTC(w.year, w.month - 1 + months, 1));
  return etWallToUtc(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, 1, 0, 0);
}

function formatEtHour(ms) {
  const parts = ET_HOUR_FMT.formatToParts(new Date(ms));
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : "";
  };
  const hour = get("hour");
  const minute = get("minute");
  const ap = (get("dayPeriod") || "").replace(/\./g, "").toUpperCase();
  if (minute === "00") return `${hour} ${ap}`;
  return `${hour}:${minute} ${ap}`;
}

function formatEtDate(ms, { year = false } = {}) {
  if (year) return ET_DATE_YEAR_FMT.format(new Date(ms));
  return formatStatementDate(ms);
}

function yearSpan(t0, t1) {
  return etParts(t0).year !== etParts(t1).year;
}

function pickStep(span, candidates, target = 6) {
  let best = candidates[0];
  let bestScore = Infinity;
  for (const step of candidates) {
    if (!(step > 0)) continue;
    const n = Math.floor(span / step) + 1;
    const overflow = n < 5 ? (5 - n) : n > 8 ? (n - 8) : 0;
    const score = overflow * 10 + Math.abs(n - target);
    if (score < bestScore) {
      bestScore = score;
      best = step;
    }
  }
  return best;
}

function buildHourTicks(t0, t1) {
  const hours = Math.max(1, (t1 - t0) / 3600000);
  const step = pickStep(hours, [1, 2, 3, 4, 6, 8, 12]);
  const w = etParts(t0);
  const snapped = Math.floor(w.hour / step) * step;
  let t = etWallToUtc(w.year, w.month, w.day, snapped, 0);
  if (t < t0 - 1000) t = addEtHours(t, step);
  const ticks = [];
  for (let i = 0; i < 48 && t <= t1 + 1000; i++) {
    ticks.push({ ms: t, text: formatEtHour(t) });
    t = addEtHours(t, step);
  }
  return ticks;
}

function buildDayTicks(t0, t1, stepDays, withYear) {
  let t = startOfEtDay(t0);
  if (t < t0 - 1000) t = addEtDays(t, 1);
  const ticks = [];
  for (let i = 0; i < 80 && t <= t1 + 12 * 3600000; i++) {
    ticks.push({ ms: t, text: formatEtDate(t, { year: withYear }) });
    t = addEtDays(t, stepDays);
  }
  return ticks;
}

function buildMonthTicks(t0, t1, stepMonths, withYear) {
  const w = etParts(t0);
  let t = etWallToUtc(w.year, w.month, 1, 0, 0);
  if (t < t0 - 1000) t = addEtMonths(t, stepMonths);
  const ticks = [];
  for (let i = 0; i < 48 && t <= t1 + 12 * 3600000; i++) {
    ticks.push({ ms: t, text: formatEtDate(t, { year: withYear }) });
    t = addEtMonths(t, stepMonths);
  }
  return ticks;
}

export function profitChartXTicks(t0, t1, range = "all") {
  if (t0 == null || t1 == null) return [];
  if (!(t1 > t0)) {
    const preset = normalizeStatementDateRange(range);
    const text = preset === "today" ? formatEtHour(t0) : formatEtDate(t0);
    return [{ ms: t0, text }];
  }
  const preset = normalizeStatementDateRange(range);
  const spanHours = (t1 - t0) / 3600000;
  const spanDays = (t1 - t0) / 86400000;
  const withYear = yearSpan(t0, t1);
  if (preset === "today" || spanHours <= 36) return buildHourTicks(t0, t1);
  if (preset === "7d" || spanDays <= 10) return buildDayTicks(t0, t1, 1, withYear);
  if (preset === "30d" || spanDays <= 45) return buildDayTicks(t0, t1, pickStep(spanDays, [2, 3, 4, 5, 7]), withYear);
  if (spanDays <= 210) return buildDayTicks(t0, t1, pickStep(spanDays, [7, 10, 14, 15, 21, 30]), withYear);
  return buildMonthTicks(t0, t1, pickStep(spanDays / 30.4, [1, 2, 3, 4, 6]), withYear);
}

export function profitChartTimeDomain(points, { range = "all", now } = {}) {
  const times = (points || []).map((p) => tsMs(p && p.at)).filter((t) => t != null);
  const data0 = times.length ? Math.min(...times) : null;
  const data1 = times.length ? Math.max(...times) : null;
  const at = now instanceof Date ? now : now != null ? new Date(now) : new Date();
  const atMs = at.getTime();
  const preset = normalizeStatementDateRange(range);
  if (preset === "today") {
    const start = startOfEtDay(atMs);
    const end = Math.max(atMs, data1 || start);
    return { t0: start, t1: end > start ? end : start + 1 };
  }
  if (preset === "7d" || preset === "30d") {
    const days = preset === "7d" ? 7 : 30;
    const start = atMs - days * 24 * 60 * 60 * 1000;
    const end = Math.max(atMs, data1 || start);
    return { t0: start, t1: end > start ? end : start + 1 };
  }
  if (data0 == null) return { t0: null, t1: null };
  return { t0: data0, t1: data1 == null || data1 === data0 ? data0 : data1 };
}

/** Axis dollar labels: $0, $10k, $20k, -$10k. No leading + (the header already has the total). */
export function axisDollars(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  let body;
  if (abs >= 1000000) body = (abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  else if (abs >= 10000) body = Math.round(abs / 1000) + "k";
  else if (abs >= 1000) body = (abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1).replace(/\.0$/, "") + "k";
  else if (abs >= 100) body = String(Math.round(abs));
  else if (Math.abs(abs - Math.round(abs)) < 0.05) body = String(Math.round(abs));
  else body = abs.toFixed(abs < 10 ? 2 : 0);
  return sign + "$" + body;
}

function niceNum(span, round) {
  const abs = Math.abs(span) || 1;
  const exp = Math.floor(Math.log10(abs));
  const f = abs / Math.pow(10, exp);
  let nf;
  if (round) {
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
  } else {
    if (f <= 1) nf = 1;
    else if (f <= 2) nf = 2;
    else if (f <= 5) nf = 5;
    else nf = 10;
  }
  return nf * Math.pow(10, exp);
}

function roundToStep(v, step) {
  return Math.round(v / step) * step;
}

/** Nice inclusive y-tick values, always including 0 when the range crosses or starts at 0. */
export function profitChartYTicks(lo, hi, target = 6) {
  let a = Number(lo);
  let b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [0];
  if (b < a) { const t = a; a = b; b = t; }
  if (b - a < 0.01) { a -= 1; b += 1; }
  if (a > 0) a = 0;
  if (b < 0) b = 0;
  const rawSpan = b - a || 1;
  const step = niceNum(rawSpan / Math.max(2, target - 1), true);
  const start = Math.floor(a / step) * step;
  const end = Math.ceil(b / step) * step;
  const ticks = [];
  // Guard float dust so 0 is exactly 0.
  for (let v = start, i = 0; v <= end + step / 2 && i < 16; v = start + (++i) * step) {
    const n = Math.abs(v) < step * 1e-9 ? 0 : roundToStep(v, step);
    if (!ticks.length || Math.abs(ticks[ticks.length - 1] - n) > step * 0.4) ticks.push(n);
  }
  if (!ticks.includes(0) && start <= 0 && end >= 0) ticks.push(0);
  ticks.sort((x, y) => x - y);
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1] };
}

/**
 * Screen geometry for the running-profit line. Higher profit is a smaller y.
 * Shared by the on-page SVG and the share image so they match.
 */
export function profitChartLayout(points, box = {}) {
  const width = box.width || 640;
  const height = box.height || PROFIT_CHART_HEIGHT;
  const padL = box.padL != null ? box.padL : 48;
  const padR = box.padR != null ? box.padR : 14;
  const padT = box.padT != null ? box.padT : 10;
  const padB = box.padB != null ? box.padB : 22;
  const range = box.range || "all";
  const now = box.now;
  const shown = sampleProfitPoints(points);
  if (!shown.length) return null;
  const hasEv = shown.every((p) => p && p.cumulativeEv != null && Number.isFinite(Number(p.cumulativeEv)));
  const vals = shown.map((p) => Number(p.cumulative) || 0);
  if (hasEv) {
    for (const p of shown) vals.push(Number(p.cumulativeEv) || 0);
  }
  let rawLo = Math.min(0, ...vals);
  let rawHi = Math.max(0, ...vals);
  if (rawHi - rawLo < 0.01) { rawLo -= 1; rawHi += 1; }
  const yScale = profitChartYTicks(rawLo, rawHi, 6);
  const lo = yScale.lo;
  const hi = yScale.hi;
  const span = hi - lo || 1;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const yAt = (v) => padT + (1 - (v - lo) / span) * innerH;
  const domain = profitChartTimeDomain(shown, { range, now });
  const t0 = domain.t0;
  const t1 = domain.t1;
  const tSpan = t0 != null && t1 != null ? t1 - t0 : 0;
  const xAt = (p, i) => {
    const ms = tsMs(p && p.at);
    if (!(tSpan > 0) || ms == null) {
      return padL + (shown.length === 1 ? innerW / 2 : (i / Math.max(1, shown.length - 1)) * innerW);
    }
    const x = padL + ((ms - t0) / tSpan) * innerW;
    return Math.min(padL + innerW, Math.max(padL, x));
  };
  const coords = shown.map((p, i) => ({ x: xAt(p, i), y: yAt(Number(p.cumulative) || 0) }));
  const evCoords = hasEv ? shown.map((p, i) => ({ x: xAt(p, i), y: yAt(Number(p.cumulativeEv) || 0) })) : [];
  const zeroY = yAt(0);
  const startX = tSpan > 0 ? padL : coords[0].x;
  const origin = { x: startX, y: zeroY };
  const line = stepLine(coords, origin);
  const evLine = hasEv ? stepLine(evCoords, origin) : [];
  const samples = shown.map((p, i) => ({
    x: coords[i].x,
    y: coords[i].y,
    evY: hasEv ? evCoords[i].y : null,
    at: p.at,
    cumulative: Number(p.cumulative) || 0,
    cumulativeEv: hasEv ? (Number(p.cumulativeEv) || 0) : null,
  }));
  const yTicks = yScale.ticks.map((value) => ({
    value,
    text: axisDollars(value),
    y: yAt(value),
    zero: value === 0,
  }));
  const rawX = tSpan > 0 ? profitChartXTicks(t0, t1, range) : [];
  const minXGap = 36;
  const xTicks = [];
  for (const tick of rawX) {
    const x = padL + ((tick.ms - t0) / tSpan) * innerW;
    if (x < padL - 8 || x > padL + innerW + 8) continue;
    if (xTicks.length && Math.abs(x - xTicks[xTicks.length - 1].x) < minXGap) continue;
    const nearLeft = x - padL < 8;
    const nearRight = (padL + innerW) - x < 8;
    xTicks.push({
      text: tick.text,
      x,
      y: height - 6,
      anchor: nearLeft ? "start" : nearRight ? "end" : "middle",
    });
  }
  if (!xTicks.length) {
    const firstDate = formatStatementDate(shown[0].at);
    const lastDate = formatStatementDate(shown[shown.length - 1].at);
    if (firstDate) xTicks.push({ text: firstDate, x: padL, y: height - 6, anchor: "start" });
    if (lastDate && lastDate !== firstDate) xTicks.push({ text: lastDate, x: padL + innerW, y: height - 6, anchor: "end" });
  }
  const axisY = height - padB;
  const xTick = Math.max(3, Math.min(14, padB * 0.2));
  return {
    width,
    height,
    padL,
    padR,
    padT,
    padB,
    axisY,
    xTick,
    line,
    evLine,
    samples,
    hasEv,
    zeroY,
    yTicks,
    xTicks,
    // Kept for older callers / aria text.
    labels: yTicks.map((t) => ({ text: t.text, x: padL - 8, y: t.y, anchor: "end" })),
    firstDate: formatStatementDate(shown[0].at),
    lastDate: formatStatementDate(shown[shown.length - 1].at),
    end: coords[coords.length - 1],
    evEnd: hasEv ? evCoords[evCoords.length - 1] : null,
  };
}

/** Plain card for the share image. No account, name, or email fields. */
export function profitImageModel({ total = 0, count = 0, range = "all", points = [], emptyText = "", evTotal = null, hasEv = false, evKnown = 0, evLegend = "", evNote = "" } = {}) {
  const n = Math.max(0, Number(count) || 0);
  const series = n ? (points || []) : [];
  const first = series.length ? formatStatementDate(series[0].at) : "";
  const last = series.length ? formatStatementDate(series[series.length - 1].at) : "";
  const evOn = !!(hasEv && n && series.some((p) => p && p.cumulativeEv != null));
  const known = Math.max(0, Number(evKnown) || 0);
  const legend = evOn ? (evLegend || (known && known < n ? `EV (${known} of ${n} locks)` : "EV")) : "";
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
    hasEv: evOn,
    evLegend: legend,
    evNote: evOn ? (evNote || "") : "",
    evTotalText: evOn && evTotal != null ? signedDollars(evTotal) : "",
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
