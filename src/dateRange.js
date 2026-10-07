// Calendar-day filters for Promo Builder and +EV.
// Keep in lockstep with lib/date-range.cjs (the EV-parlay scanner copy).
// "Today" is the America/New_York calendar date. The previous check formatted
// every row with toLocaleString, and +EV calls it once per book per line
// (hundreds of thousands of times). That blocked the main thread for well
// over 10s. Intl.DateTimeFormat plus a per-timestamp cache matches the old
// ET day and finishes the same volume in milliseconds.

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const dayCache = new Map();
let todayCache = { bucket: Number.NaN, key: "" };

function etDayKey(ms) {
  const hit = dayCache.get(ms);
  if (hit) return hit;
  const key = ET_DAY.format(ms);
  if (dayCache.size > 8000) dayCache.clear();
  dayCache.set(ms, key);
  return key;
}

function etTodayKey(nowMs) {
  const bucket = Math.floor(nowMs / 1000);
  if (todayCache.bucket === bucket) return todayCache.key;
  const key = etDayKey(nowMs);
  todayCache = { bucket, key };
  return key;
}

export function isWithinDateRange(commence_time, range, now = new Date()) {
  if (range === "any" || range == null || range === "") return true;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const ctMs = commence_time instanceof Date ? commence_time.getTime() : new Date(commence_time).getTime();
  if (range === "24h") return Number.isFinite(ctMs) && ctMs <= nowMs + DAY_MS;
  if (range === "7d") return Number.isFinite(ctMs) && ctMs <= nowMs + 7 * DAY_MS;
  if (range === "today") {
    if (!Number.isFinite(ctMs) || !Number.isFinite(nowMs)) return false;
    return etDayKey(ctMs) === etTodayKey(nowMs);
  }
  return true;
}

// Drop started / out-of-range rows once, before the per-book scan.
export function upcomingInRange(rows, now, dateRange, sportFilter) {
  if (!rows || !rows.length) return [];
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i];
    const ctMs = new Date(g.commence_time).getTime();
    if (Number.isFinite(ctMs) && ctMs <= nowMs) continue;
    if (!isWithinDateRange(g.commence_time, dateRange, nowDate)) continue;
    if (sportFilter && !sportFilter.includes(g.sport)) continue;
    out.push(g);
  }
  return out;
}
