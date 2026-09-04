import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNHEDGED_TABLE,
  UNHEDGED_LIMIT,
  UNHEDGED_PAGE_SIZE,
  UNHEDGED_DEFAULT_DATE_RANGE,
  UNHEDGED_DATE_FILTERS,
  UNHEDGED_DEFAULT_STATUS_MODE,
  UNHEDGED_REQUEST_DATE_COLS,
  americanFromProb,
  applyUnhedgedStatusFilter,
  defaultStatusModeForVenue,
  resolveUnhedgedStatusMode,
  statusModeForVenue,
  coerceAmerican,
  fetchUnhedgedRfqs,
  countUnhedgedRfqs,
  mergeUnhedgedSummary,
  resolveUnhedgedLimit,
  unhedgedRefreshLabel,
  unhedgedDateRangePages,
  unhedgedVenueOrFilter,
  filterUnhedgedAnalytics,
  filterUnhedgedRowsByQuoteBeat,
  filterUnhedgedRowsByVenue,
  formatAmerican,
  formatAmount,
  formatCashSize,
  formatEtTime,
  timeMs,
  formatScanAmerican,
  formatBreakdownAmerican,
  formatLegBreakdownLine,
  formatUnhedgedLeg,
  formatUnhedgedLegName,
  formatVenue,
  legBestOpponentAmerican,
  legBreakdownLines,
  legKalshiAmerican,
  legPolyAmerican,
  fairAmerican,
  filterFilledUnhedgedRows,
  filterPregameUnhedgedRows,
  filterRequestUnhedgedRows,
  filterUnhedgedRowsByStatusMode,
  isFilledUnhedgedRow,
  isRequestUnhedgedRow,
  isLiveSkipReason,
  isLiveUnhedgedRow,
  isPregameUnhedgedRow,
  legAlreadyStarted,
  normalizeSkipReason,
  isMissingStatusColumn,
  legFairAmerican,
  isMissingFilledAtColumn,
  isMissingUpdatedAtColumn,
  isMissingCreatedAtColumn,
  isMissingTableError,
  isMissingUserIdColumn,
  isMissingVenueColumn,
  isMissingQuoteAmericanColumn,
  isMissingFillAmericanColumn,
  UNHEDGED_COUNT_SELECT_OPTS,
  UNHEDGED_COUNT_SELECT,
  UNHEDGED_BEAT_FILL_COLS,
  UNHEDGED_BLOTTER_SELECT,
  UNHEDGED_BLOTTER_COLUMNS,
  UNHEDGED_DATE_COLS,
  UNHEDGED_DATE_FALLBACK_COLS,
  UNHEDGED_AUTO_REFRESH_MS,
  UNHEDGED_LIGHT_DATE_KEYS,
  UNHEDGED_HEAVY_DATE_KEYS,
  applyUnhedgedDateWindow,
  unhedgedDateTs,
  unhedgedStatusValues,
  unhedgedShouldAutoRefresh,
  rowTime,
  unhedgedActivityTs,
  unhedgedDisplayTs,
  unhedgedDateColsForMode,
  unhedgedDateWindow,
  unhedgedDateOrFilter,
  unhedgedDateRangeLabel,
  rowInUnhedgedDateWindow,
  filterUnhedgedRowsByDateWindow,
  normalizeUnhedgedDateRange,
  formatUnhedgedSport,
  formatEtEventDate,
  parseAecGameSlug,
  parseTickerEventStamp,
  parseUnhedgedEventStamp,
  etYmd,
  etLocalToUtc,
  etDayBounds,
  sortUnhedgedRows,
  isTickerBlob,
  filterMlbNflMoneylineRows,
  isMlbNflMoneylineRow,
  mapUnhedgedRow,
  mapUnhedgedRows,
  normalizeStatus,
  normalizeStatusMode,
  normalizeVenueFilter,
  ourQuoteAmerican,
  rowStatus,
  resolveTeamToken,
  summarizeUnhedgedRows,
  teamDisplayName,
  visibleUnhedgedRows,
  wouldQuoteBeatsFill,
} from "./unhedgedTape.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// ── American conversion (same convention as the rest of the desk) ──
assert.equal(americanFromProb(0.08), 1150);
assert.equal(americanFromProb(0.2), 400);
assert.equal(americanFromProb(0.6), -150);
assert.equal(americanFromProb(0), null);
assert.equal(formatAmerican(1150), "+1150");
assert.equal(formatAmerican(-150), "-150");
assert.equal(coerceAmerican("+900"), 900);
assert.equal(coerceAmerican(-110), -110);
assert.equal(coerceAmerican(0.2), 400);
assert.equal(coerceAmerican(""), null);
assert.equal(coerceAmerican(null), null);

// ── ET clock ──
assert.equal(formatEtTime("2026-09-02T16:30:00.000Z"), "Sep 2, 12:30 PM ET");
assert.equal(formatEtTime(null), "—");
assert.equal(formatEtTime(""), "—");

// TIME ET / activity clock: latest of filled_at / updated_at / created_at.
// Nulls ignored. Do not invent a fill or Date.now().
assert.equal(rowTime({
  filled_at: "2026-09-02T17:56:00.000Z",
  updated_at: "2026-09-02T18:16:00.000Z",
  created_at: "2026-09-02T17:00:00.000Z",
}), "2026-09-02T18:16:00.000Z");
assert.equal(unhedgedActivityTs({
  filled_at: "2026-09-02T17:56:00.000Z",
  updated_at: "2026-09-02T18:16:00.000Z",
  created_at: "2026-09-02T17:00:00.000Z",
}), "2026-09-02T18:16:00.000Z");
assert.equal(rowTime({
  filled_at: null,
  updated_at: "2026-09-02T18:16:00.000Z",
  created_at: "2026-09-02T18:10:00.000Z",
}), "2026-09-02T18:16:00.000Z");
assert.equal(rowTime({ created_at: "2026-09-02T18:10:00.000Z" }), "2026-09-02T18:10:00.000Z");
assert.equal(unhedgedActivityTs({
  filled_at: null,
  updated_at: "2026-09-02T18:16:00.000Z",
  created_at: "2026-09-02T18:10:00.000Z",
}), "2026-09-02T18:16:00.000Z");
assert.equal(rowTime({ filled_at: "2026-09-03T03:11:00.000Z" }), "2026-09-03T03:11:00.000Z");
assert.equal(unhedgedActivityTs({ filled_at: "2026-09-03T03:11:00.000Z" }), "2026-09-03T03:11:00.000Z");
assert.equal(formatEtTime("2026-09-03T03:11:00.000Z"), "Sep 2, 11:11 PM ET");
assert.equal(unhedgedActivityTs({
  filledAt: "2026-09-03T03:11:00.000Z",
  updatedAt: "2026-09-03T18:30:00.000Z",
}), "2026-09-03T18:30:00.000Z");
assert.equal(unhedgedActivityTs({
  filled_at: "2026-09-03T19:00:00.000Z",
  updated_at: "2026-09-03T18:30:00.000Z",
}), "2026-09-03T19:00:00.000Z");
assert.equal(unhedgedActivityTs(null), null);
assert.equal(unhedgedActivityTs({}), null);
assert.equal(unhedgedDisplayTs({
  status: "seen",
  created_at: "2026-09-03T16:00:00.000Z",
  updated_at: "2026-09-03T18:30:00.000Z",
}), "2026-09-03T16:00:00.000Z");
assert.equal(unhedgedDisplayTs({
  status: "would_quote",
  createdAt: "2026-09-03T16:00:00.000Z",
  updatedAt: "2026-09-03T18:30:00.000Z",
}), "2026-09-03T16:00:00.000Z");
assert.equal(unhedgedDisplayTs({
  status: "filled",
  filled_at: "2026-09-03T03:11:00.000Z",
  updated_at: "2026-09-03T18:30:00.000Z",
}), "2026-09-03T18:30:00.000Z");
assert.equal(formatEtTime(unhedgedDisplayTs({
  status: "seen",
  created_at: "2026-09-03T16:00:00.000Z",
})), "Sep 3, 12:00 PM ET");
{
  const withFill = mapUnhedgedRow({
    filled_at: "2026-09-02T17:56:00.000Z",
    updated_at: "2026-09-02T18:16:00.000Z",
    created_at: "2026-09-02T17:00:00.000Z",
    status: "filled",
  });
  assert.equal(withFill.timeEt, "Sep 2, 2:16 PM ET");
  assert.equal(withFill.at, "2026-09-02T18:16:00.000Z");
  assert.equal(withFill.filledAt, "2026-09-02T17:56:00.000Z");
  assert.equal(withFill.updatedAt, "2026-09-02T18:16:00.000Z");
  const noFill = mapUnhedgedRow({
    filled_at: null,
    updated_at: "2026-09-02T18:16:00.000Z",
    created_at: "2026-09-02T18:10:00.000Z",
    status: "filled",
  });
  assert.equal(noFill.timeEt, "Sep 2, 2:16 PM ET");
  assert.equal(noFill.filledAt, null);
  assert.equal(noFill.updatedAt, "2026-09-02T18:16:00.000Z");
  const createdOnly = mapUnhedgedRow({
    created_at: "2026-09-02T18:10:00.000Z",
    status: "filled",
  });
  assert.equal(createdOnly.timeEt, "Sep 2, 2:10 PM ET");
  assert.equal(createdOnly.filledAt, null);
  const fillOnly = mapUnhedgedRow({
    filled_at: "2026-09-03T03:11:00.000Z",
    status: "filled",
  });
  assert.equal(fillOnly.timeEt, "Sep 2, 11:11 PM ET");
  assert.equal(fillOnly.filledAt, "2026-09-03T03:11:00.000Z");
}

// ── Venue ──
assert.equal(formatVenue("kalshi"), "Kalshi");
assert.equal(formatVenue("polymarket"), "Polymarket");
assert.equal(formatVenue("poly"), "Polymarket");
assert.equal(formatVenue(null), "—");

// ── Status aliases ──
assert.equal(normalizeStatus("would-quote"), "would_quote");
assert.equal(normalizeStatus("posted"), "quoted");
assert.equal(normalizeStatus("executed"), "filled");
assert.equal(normalizeStatus("received"), "seen");
assert.equal(rowStatus({ status: "quoted" }), "quoted");
assert.equal(rowStatus({ fill_american: -120 }), "filled");
assert.equal(rowStatus({ fair_american: 250 }), "seen");
assert.equal(rowStatus({ our_fair_american: 250 }), "seen");
assert.equal(rowStatus({}), "seen");
assert.equal(normalizeStatus("started"), "started");
assert.equal(rowStatus({ status: "started" }), "started");
assert.equal(rowStatus({ status: "seen", our_quote_american: 178 }), "would_quote");
assert.equal(rowStatus({ status: "seen" }), "seen");
assert.equal(rowStatus({ status: "filled", our_quote_american: 178 }), "filled");
assert.equal(rowStatus({ fill_yes_price: 0.21 }), "filled");

// ── Row mapping: worker-shaped row ──
{
  const row = mapUnhedgedRow({
    id: "r1",
    created_at: "2026-09-02T16:30:00.000Z",
    venue: "kalshi",
    label: "NYY / BOS",
    legs: [{ type: "ml", label: "NYY" }, { type: "ml", label: "BOS" }],
    contracts: 40,
    rfq_american: 900,
    would_quote_american: 850,
    status: "quoted",
    fill_american: null,
  });
  assert.equal(row.timeEt, "Sep 2, 12:30 PM ET");
  assert.equal(row.venue, "Kalshi");
  assert.equal(row.venueKey, "kalshi");
  assert.equal(row.label, "Yanks ML · Red Sox ML");
  assert.equal(row.legs.length, 2);
  assert.equal(row.legs[0].text, "Yanks ML");
  assert.equal(row.legs[1].text, "Red Sox ML");
  assert.equal(row.contractsText, "40");
  assert.equal(row.theirText, "+900");
  assert.equal(row.ourText, "+850");
  assert.equal(row.status, "quoted");
  assert.equal(row.statusTone, "fill");
  assert.equal(row.fillText, "—");
}

// ── YES price → American when no *_american column ──
{
  const row = mapUnhedgedRow({
    rfq_id: "abc",
    venue: "Polymarket",
    yes_price: 0.2,
    fair: 0.23,
    contracts_fp: "12.5",
    status: "filled",
    fill_price: 0.21,
    legs: ["NYY ML", "BOS ML"],
  });
  assert.equal(row.id, "abc");
  assert.equal(row.venue, "Polymarket");
  assert.equal(row.theirAmerican, 400);
  assert.equal(row.ourAmerican, null);
  assert.equal(row.ourText, "—");
  assert.equal(row.fairAmerican, null);
  assert.equal(row.fairText, "—");
  assert.equal(row.fillAmerican, 376);
  assert.equal(row.contractsText, "12.5");
  assert.equal(row.amountText, "12.5");
  assert.equal(row.status, "filled");
  assert.equal(row.label, "Yanks ML · Red Sox ML");
}

// ── NO price → YES American ──
{
  const row = mapUnhedgedRow({ no_price: 0.9, label: "solo" });
  assert.equal(row.theirAmerican, 900);
  assert.equal(row.theirText, "+900");
}

// ── Newest first ──
{
  const mapped = mapUnhedgedRows([
    { id: "old", created_at: "2026-09-01T12:00:00.000Z", label: "old" },
    { id: "new", created_at: "2026-09-02T12:00:00.000Z", label: "new" },
  ]);
  assert.equal(mapped[0].id, "new");
  assert.equal(mapped[1].id, "old");
}

// ── Client sort: filled first by filled_at, then created_at ──
{
  const mapped = mapUnhedgedRows([
    { id: "seen-new", status: "seen", created_at: "2026-09-02T16:00:00.000Z" },
    {
      id: "fill-later",
      status: "filled",
      fill_american: -110,
      created_at: "2026-09-02T08:00:00.000Z",
      filled_at: "2026-09-02T16:26:00.000Z",
    },
    {
      id: "fill-earlier",
      status: "filled",
      fill_american: 200,
      created_at: "2026-09-02T07:00:00.000Z",
      filled_at: "2026-09-02T16:24:00.000Z",
    },
  ]);
  assert.equal(mapped[0].id, "fill-later");
  assert.equal(mapped[1].id, "fill-earlier");
  assert.equal(mapped[2].id, "seen-new");
  assert.equal(mapped[0].filledAt, "2026-09-02T16:26:00.000Z");
  const resorted = sortUnhedgedRows(mapped.slice().reverse());
  assert.deepEqual(resorted.map((r) => r.id), ["fill-later", "fill-earlier", "seen-new"]);
  const s = summarizeUnhedgedRows(mapped, { fetched: 400 });
  assert.equal(s.fetched, 400);
  assert.equal(s.filled, 2);
  assert.equal(s.seen, 1);
  assert.equal(s.beatFill, 0);
}

// ── Null filled_at + later created_at/updated_at sorts above an older fill stamp ──
{
  const mapped = mapUnhedgedRows([
    {
      id: "stale-156",
      status: "filled",
      fill_american: -110,
      filled_at: "2026-09-02T17:56:00.000Z",
      updated_at: "2026-09-02T17:56:00.000Z",
      created_at: "2026-09-02T17:50:00.000Z",
    },
    {
      id: "stale-157",
      status: "filled",
      fill_american: 200,
      filled_at: "2026-09-02T17:57:00.000Z",
      created_at: "2026-09-02T17:40:00.000Z",
    },
    {
      id: "new-null-fill",
      status: "filled",
      fill_american: 452,
      filled_at: null,
      updated_at: "2026-09-02T18:16:00.000Z",
      created_at: "2026-09-02T18:16:00.000Z",
    },
    {
      id: "new-created-only",
      status: "filled",
      fill_american: 180,
      filled_at: null,
      created_at: "2026-09-02T18:10:00.000Z",
    },
  ]);
  assert.deepEqual(mapped.map((r) => r.id), ["new-null-fill", "new-created-only", "stale-157", "stale-156"]);
  assert.equal(mapped[0].filledAt, null);
  assert.equal(mapped[0].timeEt, "Sep 2, 2:16 PM ET");
  assert.equal(mapped[1].timeEt, "Sep 2, 2:10 PM ET");
  assert.equal(mapped[2].timeEt, "Sep 2, 1:57 PM ET");
  assert.equal(mapped[3].timeEt, "Sep 2, 1:56 PM ET");
  const resorted = sortUnhedgedRows(mapped.slice().reverse());
  assert.deepEqual(resorted.map((r) => r.id), ["new-null-fill", "new-created-only", "stale-157", "stale-156"]);
}

// ── Stale filled_at + later updated_at sorts/displays as the later stamp ──
{
  const mapped = mapUnhedgedRows([
    {
      id: "seahawks-stale-fill",
      status: "filled",
      fill_american: 4662,
      filled_at: "2026-09-03T03:11:00.000Z",
      updated_at: "2026-09-03T18:30:00.000Z",
      created_at: "2026-09-02T20:00:00.000Z",
    },
    {
      id: "older-update",
      status: "filled",
      fill_american: 200,
      filled_at: "2026-09-03T03:11:00.000Z",
      updated_at: "2026-09-03T17:00:00.000Z",
      created_at: "2026-09-02T19:00:00.000Z",
    },
    {
      id: "fill-only",
      status: "filled",
      fill_american: 180,
      filled_at: "2026-09-03T03:11:00.000Z",
    },
  ]);
  assert.deepEqual(mapped.map((r) => r.id), ["seahawks-stale-fill", "older-update", "fill-only"]);
  assert.equal(mapped[0].filledAt, "2026-09-03T03:11:00.000Z");
  assert.equal(mapped[0].updatedAt, "2026-09-03T18:30:00.000Z");
  assert.equal(mapped[0].at, "2026-09-03T18:30:00.000Z");
  assert.equal(mapped[0].timeEt, "Sep 3, 2:30 PM ET");
  assert.equal(formatEtTime(unhedgedActivityTs(mapped[0])), "Sep 3, 2:30 PM ET");
  assert.equal(mapped[1].timeEt, "Sep 3, 1:00 PM ET");
  assert.equal(mapped[2].timeEt, "Sep 2, 11:11 PM ET");
  assert.equal(formatEtTime(unhedgedActivityTs({
    filled_at: "2026-09-03T03:11:00.000Z",
    updated_at: "2026-09-03T18:30:00.000Z",
  })), "Sep 3, 2:30 PM ET");
  const resorted = sortUnhedgedRows(mapped.slice().reverse());
  assert.deepEqual(resorted.map((r) => r.id), ["seahawks-stale-fill", "older-update", "fill-only"]);
}

// ── Date window: ET today / rolling lookbacks; activity clock membership ──
assert.equal(normalizeUnhedgedDateRange("Today"), "today");
assert.equal(normalizeUnhedgedDateRange("all-time"), "all");
assert.equal(normalizeUnhedgedDateRange("30d"), "month");
assert.equal(normalizeUnhedgedDateRange("nope"), "today");
assert.equal(UNHEDGED_DEFAULT_DATE_RANGE, "today");
assert.equal(UNHEDGED_DEFAULT_STATUS_MODE, "fills");
assert.equal(normalizeStatusMode("Requests"), "requests");
assert.equal(normalizeStatusMode("seen"), "requests");
assert.equal(normalizeStatusMode("filled"), "fills");
assert.equal(normalizeStatusMode("all"), "fills");
assert.equal(normalizeStatusMode("nope"), "fills");
assert.deepEqual(unhedgedStatusValues("fills"), ["filled"]);
assert.deepEqual(unhedgedStatusValues("requests"), ["seen"]);
assert.deepEqual(unhedgedStatusValues("all"), ["filled"]);
assert.deepEqual(unhedgedDateColsForMode("fills"), ["filled_at"]);
assert.deepEqual(unhedgedDateColsForMode("requests"), ["created_at"]);
assert.deepEqual(UNHEDGED_REQUEST_DATE_COLS, ["created_at"]);
assert.equal(statusModeForVenue("polymarket"), "requests");
assert.equal(statusModeForVenue("poly"), "requests");
assert.equal(statusModeForVenue("all"), "fills");
assert.equal(statusModeForVenue("kalshi"), "fills");
assert.equal(statusModeForVenue(""), "fills");
assert.equal(defaultStatusModeForVenue("polymarket"), "requests");
assert.equal(defaultStatusModeForVenue("kalshi"), "fills");
assert.equal(resolveUnhedgedStatusMode({ venue: "polymarket" }), "requests");
assert.equal(resolveUnhedgedStatusMode({ venue: "all" }), "fills");
assert.equal(resolveUnhedgedStatusMode({ venue: "kalshi" }), "fills");
assert.equal(resolveUnhedgedStatusMode({ venue: "polymarket", statusMode: "fills" }), "fills");
{
  const seenEq = { eqs: [], eq(col, val) { this.eqs.push({ col, val }); return this; } };
  applyUnhedgedStatusFilter(seenEq, "requests");
  assert.deepEqual(seenEq.eqs, [{ col: "status", val: "seen" }]);
  const fillEq = { eqs: [], eq(col, val) { this.eqs.push({ col, val }); return this; } };
  applyUnhedgedStatusFilter(fillEq, "fills");
  assert.deepEqual(fillEq.eqs, [{ col: "status", val: "filled" }]);
}
assert.equal(unhedgedDateRangeLabel("month"), "Month");
assert.deepEqual(UNHEDGED_DATE_FILTERS.map((f) => f.key), ["today", "24h", "7d", "month", "all"]);
assert.deepEqual(UNHEDGED_LIGHT_DATE_KEYS, ["today", "24h", "7d"]);
assert.deepEqual(UNHEDGED_HEAVY_DATE_KEYS, ["month", "all"]);
assert.equal(unhedgedDateRangePages("today"), false);
assert.equal(unhedgedDateRangePages("24h"), false);
assert.equal(unhedgedDateRangePages("7d"), false);
assert.equal(unhedgedDateRangePages("month"), true);
assert.equal(unhedgedDateRangePages("all"), true);
assert.equal(unhedgedDateRangePages("30d"), true);
assert.match(unhedgedVenueOrFilter("kalshi"), /venue\.ilike\.kalshi/);
assert.match(unhedgedVenueOrFilter("polymarket"), /venue\.eq\.poly/);
assert.equal(unhedgedVenueOrFilter("all"), null);
assert.deepEqual(UNHEDGED_COUNT_SELECT_OPTS, { count: "exact", head: true });
assert.equal(UNHEDGED_COUNT_SELECT, "id");
assert.equal(UNHEDGED_BEAT_FILL_COLS, "our_quote_american,fill_american");
assert.deepEqual(UNHEDGED_DATE_COLS, ["filled_at"]);
assert.deepEqual(UNHEDGED_DATE_FALLBACK_COLS, ["updated_at", "created_at"]);
assert.equal(UNHEDGED_AUTO_REFRESH_MS, 0);
assert.equal(unhedgedShouldAutoRefresh("visible"), false);
assert.equal(unhedgedShouldAutoRefresh("visible", 20_000), false);
assert.equal(unhedgedShouldAutoRefresh("visible", 90_000), true);
assert.equal(unhedgedShouldAutoRefresh("hidden", 90_000), false);
assert.equal(UNHEDGED_BLOTTER_SELECT.includes("*"), false);
assert.ok(UNHEDGED_BLOTTER_COLUMNS.includes("legs"));
assert.ok(UNHEDGED_BLOTTER_COLUMNS.includes("filled_at"));
assert.ok(UNHEDGED_BLOTTER_COLUMNS.includes("created_at"));
assert.ok(UNHEDGED_BLOTTER_COLUMNS.includes("taker_american"));
assert.ok(!UNHEDGED_BLOTTER_COLUMNS.includes("raw"));
{
  const noonEt = etLocalToUtc("2026-09-03", 14, 40);
  assert.ok(noonEt);
  assert.equal(etYmd(noonEt), "2026-09-03");
  const bounds = etDayBounds(noonEt);
  assert.equal(bounds.ymd, "2026-09-03");
  assert.equal(bounds.start.toISOString(), "2026-09-03T04:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-09-04T04:00:00.000Z");
  const winter = etLocalToUtc("2026-01-15", 0, 0);
  assert.equal(winter.toISOString(), "2026-01-15T05:00:00.000Z");
  const today = unhedgedDateWindow("today", noonEt);
  assert.equal(today.preset, "today");
  assert.equal(today.from, "2026-09-03T04:00:00.000Z");
  assert.equal(today.to, "2026-09-04T04:00:00.000Z");
  const rolling = unhedgedDateWindow("24h", noonEt);
  assert.equal(rolling.to, null);
  assert.equal(timeMs(rolling.from), noonEt.getTime() - 24 * 60 * 60 * 1000);
  const week = unhedgedDateWindow("7d", noonEt);
  assert.equal(timeMs(week.from), noonEt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const month = unhedgedDateWindow("month", noonEt);
  assert.equal(timeMs(month.from), noonEt.getTime() - 30 * 24 * 60 * 60 * 1000);
  const all = unhedgedDateWindow("all", noonEt);
  assert.equal(all.from, null);
  assert.equal(all.to, null);
  const orToday = unhedgedDateOrFilter(today);
  assert.match(orToday, /filled_at\.gte\.2026-09-03T04:00:00.000Z/);
  assert.match(orToday, /filled_at\.lt\.2026-09-04T04:00:00.000Z/);
  assert.doesNotMatch(orToday, /updated_at/);
  assert.doesNotMatch(orToday, /created_at/);
  assert.equal(unhedgedDateOrFilter(all), null);
  const or24h = unhedgedDateOrFilter(rolling, ["filled_at", "updated_at"]);
  assert.match(or24h, /filled_at\.gte\./);
  assert.match(or24h, /updated_at\.gte\./);
  assert.doesNotMatch(or24h, /\.lt\./);
  const chain = {
    gtes: [],
    lts: [],
    ors: [],
    gte(col, val) { this.gtes.push({ col, val }); return this; },
    lt(col, val) { this.lts.push({ col, val }); return this; },
    or(filter) { this.ors.push(filter); return this; },
  };
  applyUnhedgedDateWindow(chain, today, ["filled_at"]);
  assert.deepEqual(chain.gtes, [{ col: "filled_at", val: today.from }]);
  assert.deepEqual(chain.lts, [{ col: "filled_at", val: today.to }]);
  assert.deepEqual(chain.ors, []);
  const fallback = { gtes: [], lts: [], ors: [], gte() { return this; }, lt() { return this; }, or(f) { this.ors.push(f); return this; } };
  applyUnhedgedDateWindow(fallback, today, ["updated_at", "created_at"]);
  assert.equal(fallback.ors.length, 1);
  assert.match(fallback.ors[0], /updated_at\.gte\./);
  assert.match(fallback.ors[0], /created_at\.gte\./);
}
{
  const today = unhedgedDateWindow("today", etLocalToUtc("2026-09-03", 14, 40));
  const staleFillTodayWrite = {
    id: "stale",
    status: "filled",
    filled_at: "2026-09-03T03:11:00.000Z",
    updated_at: "2026-09-03T18:30:00.000Z",
  };
  const oldFill = {
    id: "old",
    status: "filled",
    filled_at: "2026-09-02T16:00:00.000Z",
    updated_at: "2026-09-02T16:00:00.000Z",
  };
  const fillOnlyYesterday = {
    id: "fill-only",
    status: "filled",
    filled_at: "2026-09-03T03:11:00.000Z",
  };
  assert.equal(unhedgedDateTs(staleFillTodayWrite), "2026-09-03T03:11:00.000Z");
  assert.equal(rowInUnhedgedDateWindow(staleFillTodayWrite, today), false);
  assert.equal(rowInUnhedgedDateWindow(oldFill, today), false);
  assert.equal(rowInUnhedgedDateWindow(fillOnlyYesterday, today), false);
  assert.equal(rowInUnhedgedDateWindow({
    id: "today-fill",
    status: "filled",
    filled_at: "2026-09-03T16:00:00.000Z",
  }, today), true);
  assert.equal(rowInUnhedgedDateWindow({
    id: "null-fill-today-write",
    status: "filled",
    filled_at: null,
    updated_at: "2026-09-03T18:30:00.000Z",
  }, today), true);
  assert.equal(rowInUnhedgedDateWindow({ id: "no-ts", status: "filled" }, today), true);
  assert.deepEqual(
    filterUnhedgedRowsByDateWindow([staleFillTodayWrite, oldFill, fillOnlyYesterday], today).map((r) => r.id),
    [],
  );
  const week = unhedgedDateWindow("7d", etLocalToUtc("2026-09-03", 14, 40));
  assert.equal(rowInUnhedgedDateWindow(oldFill, week), true);
  const seenToday = {
    id: "seen-today",
    status: "seen",
    created_at: "2026-09-03T16:00:00.000Z",
    filled_at: null,
  };
  const seenYesterday = {
    id: "seen-old",
    status: "seen",
    created_at: "2026-09-02T16:00:00.000Z",
    filled_at: null,
  };
  assert.equal(unhedgedDateTs(seenToday, "requests"), "2026-09-03T16:00:00.000Z");
  assert.equal(rowInUnhedgedDateWindow(seenToday, today, "requests"), true);
  assert.equal(rowInUnhedgedDateWindow(seenYesterday, today, "requests"), false);
  assert.equal(rowInUnhedgedDateWindow(seenToday, today, "fills"), true); // no filled_at → fallback
  assert.deepEqual(
    filterUnhedgedRowsByDateWindow([seenToday, seenYesterday], today, "requests").map((r) => r.id),
    ["seen-today"],
  );
}

// ── Worker columns: our_quote / taker_american (status still seen) ──
{
  const row = mapUnhedgedRow({
    id: "w1",
    venue: "kalshi",
    status: "seen",
    our_quote_american: 178,
    our_fair_american: 201,
    taker_american: 190,
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl", side: "yes", teams: ["atl", "was"] }],
  });
  assert.equal(row.status, "would_quote");
  assert.equal(row.statusTone, "warn");
  assert.equal(row.ourAmerican, 178);
  assert.equal(row.ourText, "+178");
  assert.equal(row.fairAmerican, 201);
  assert.equal(row.fairText, "+201");
  assert.equal(row.theirAmerican, 190);
  assert.equal(row.fillText, "—");
  assert.equal(row.legs[0].text, "Braves ML");
  assert.equal(row.label, "Braves ML");
}

{
  const row = mapUnhedgedRow({
    id: "w2",
    status: "filled",
    fill_yes_price: 0.22,
  });
  assert.equal(row.status, "filled");
  assert.equal(row.statusTone, "ok");
  assert.equal(row.fillAmerican, 355);
  assert.equal(row.fillText, "+355");
}

// ── Filled row maps contracts, cash_size, fill, fair, would-quote (no invent) ──
assert.equal(formatCashSize(25), "$25");
assert.equal(formatCashSize(12.5), "$12.50");
assert.equal(formatAmount(40, 25), "40 · $25");
assert.equal(formatAmount(40, null), "40");
assert.equal(formatAmount(null, 12.5), "$12.50");
assert.equal(formatAmount(null, null), "—");
assert.equal(ourQuoteAmerican({ our_quote_american: 178, our_fair_american: 201 }), 178);
assert.equal(fairAmerican({ our_quote_american: 178, our_fair_american: 201 }), 201);
assert.equal(ourQuoteAmerican({ our_fair_american: 201 }), null);
assert.equal(fairAmerican({ our_quote_american: 178 }), null);
{
  const row = mapUnhedgedRow({
    id: "fill-map",
    status: "filled",
    venue: "kalshi",
    filled_at: "2026-09-02T16:26:00.000Z",
    created_at: "2026-09-02T08:00:00.000Z",
    contracts: 40,
    cash_size: 12.5,
    fill_american: -110,
    our_fair_american: 201,
    our_quote_american: 178,
    legs: [{ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", fair_american: 145 }],
  });
  assert.equal(row.status, "filled");
  assert.equal(row.contracts, 40);
  assert.equal(row.cashSize, 12.5);
  assert.equal(row.amountText, "40 · $12.50");
  assert.equal(row.fillAmerican, -110);
  assert.equal(row.fillText, "-110");
  assert.equal(row.fairAmerican, 201);
  assert.equal(row.fairText, "+201");
  assert.equal(row.ourAmerican, 178);
  assert.equal(row.ourText, "+178");
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.legs[0].name, "Rockies ML");
  assert.equal(row.legs[0].fairText, "+145");
  assert.notEqual(row.fairText, row.fillText);
  assert.notEqual(row.fairText, row.ourText);
}

// ── Spoken parlay names from Kalshi tickers (COL + yes → Rockies ML) ──
assert.equal(isTickerBlob("KXMLBGAME-26SEP021510BALCOL-COL"), true);
assert.equal(isTickerBlob("KXNFLGAME-26SEP09NEKC-KC"), true);
assert.equal(isTickerBlob("KXMVE-SOMETHING"), true);
assert.equal(isTickerBlob("Rockies ML"), false);
assert.equal(isTickerBlob("Nats ML · Rangers ML"), false);
assert.equal(teamDisplayName("COL", "mlb"), "Rockies");
assert.equal(teamDisplayName("WSH", "mlb"), "Nats");
assert.equal(teamDisplayName("WAS", "mlb"), "Nats");
assert.equal(teamDisplayName("NYY", "mlb"), "Yanks");
assert.equal(teamDisplayName("KC", "mlb"), "Royals");
assert.equal(teamDisplayName("KC", "nfl"), "Chiefs");
assert.equal(teamDisplayName("PHI", "nfl"), "Eagles");
assert.equal(teamDisplayName("rockies", "mlb"), "Rockies");
assert.equal(teamDisplayName("orioles", "mlb"), "Orioles");
assert.equal(teamDisplayName("red-sox", "mlb"), "Red Sox");
assert.equal(teamDisplayName("white-sox", "mlb"), "White Sox");
assert.equal(teamDisplayName("nats", "mlb"), "Nats");
assert.equal(teamDisplayName("yankees", "mlb"), "Yanks");
assert.equal(teamDisplayName("chiefs", "nfl"), "Chiefs");
assert.equal(teamDisplayName("eagles", "nfl"), "Eagles");
assert.equal(teamDisplayName("49ers", "nfl"), "Niners");
assert.equal(resolveTeamToken("COL", "mlb"), "COL");
assert.equal(resolveTeamToken("rockies", "mlb"), "COL");
assert.equal(resolveTeamToken("kc", "nfl"), "KC");
assert.equal(resolveTeamToken("aec-mlb-bal-col-2026-09-02-col", "mlb"), "COL");
assert.equal(resolveTeamToken("aec-mlb-bal-col-2026-09-02-rockies", "mlb"), "COL");
assert.equal(resolveTeamToken("aec-mlb-mia-kc-2026-09-03", "mlb"), "MIA");
assert.deepEqual(parseAecGameSlug("aec-mlb-mia-kc-2026-09-03"), {
  league: "mlb",
  team1: "mia",
  team2: "kc",
  ymd: "2026-09-03",
  pick: "",
});
assert.deepEqual(parseAecGameSlug("aec-mlb-bal-col-2026-09-02-rockies"), {
  league: "mlb",
  team1: "bal",
  team2: "col",
  ymd: "2026-09-02",
  pick: "rockies",
});
assert.equal(parseAecGameSlug("KXMLBGAME-26SEP021510BALCOL-COL"), null);
assert.equal(
  formatUnhedgedLeg({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(formatUnhedgedSport("mlb"), "MLB");
assert.equal(formatUnhedgedSport("nfl"), "NFL");
assert.equal(formatUnhedgedSport(""), "");
assert.equal(parseTickerEventStamp("KXMLBGAME-26SEP021510BALCOL-COL").ymd, "2026-09-02");
assert.equal(formatEtEventDate("KXMLBGAME-26SEP021510BALCOL-COL"), "Sep 2, 3:10 PM ET");
assert.equal(formatEtEventDate("KXNFLGAME-26SEP09NEKC-KC"), "Sep 9");
assert.equal(formatEtEventDate("aec-mlb-bal-col-2026-09-02-col"), "Sep 2");
assert.equal(formatEtEventDate("aec-nfl-ne-sea-2026-09-09"), "Sep 9");
assert.equal(formatEtEventDate("2026-09-02"), "Sep 2");
assert.equal(formatEtEventDate(null), "—");
assert.equal(parseUnhedgedEventStamp("2026-09-02").hasTime, false);
assert.equal(
  formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "yes",
    league: "mlb",
    fair_american: 145,
  }),
  "Rockies ML +145",
);
assert.equal(formatScanAmerican(-118), "\u2212118");
assert.equal(legFairAmerican({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes" }), null);
assert.equal(legFairAmerican({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", fair_american: 145 }), 145);

{
  const row = mapUnhedgedRow({
    id: "col-yes",
    venue: "kalshi",
    ticker: "KXMVE-COMBO-SHOULD-HIDE",
    legs: [{
      ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
      symbol: "KXMLBGAME-26SEP021510BALCOL-COL",
      side: "yes",
      league: "mlb",
      selection: "COL",
      teams: ["BAL", "COL"],
      date: "2026-09-02",
    }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.legs[0].sport, "MLB");
  assert.equal(row.legs[0].eventText, "Sep 2");
  assert.equal(row.label, "Rockies ML");
  assert.doesNotMatch(row.label, /KXMLB|KXMVE|BALCOL/);
  assert.doesNotMatch(row.legs[0].text, /KXMLB|BALCOL|COL-/);
}

{
  const noOpp = formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "no",
    league: "mlb",
    teams: ["BAL", "COL"],
  });
  assert.equal(noOpp, "Orioles ML");
  const noSolo = formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "no",
    league: "mlb",
  });
  assert.equal(noSolo, "Rockies lose");
}

{
  const row = mapUnhedgedRow({
    ticker: "KXMVE-HIDE-ME",
    label: "KXMLBGAME-26SEP021510WSHTEX-WSH",
    legs: [
      { ticker: "KXMLBGAME-26SEP021510WSHTEX-WSH", side: "yes", league: "mlb", selection: "wsh", teams: ["wsh", "tex"] },
      { ticker: "KXMLBGAME-26SEP021510TEXHOU-TEX", side: "yes", league: "mlb", selection: "tex" },
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", selection: "col" },
    ],
  });
  assert.equal(row.label, "Nats ML · Rangers ML · Rockies ML");
  assert.deepEqual(row.legs.map((l) => l.text), ["Nats ML", "Rangers ML", "Rockies ML"]);
  for (const chip of row.legs) {
    assert.equal(isTickerBlob(chip.text), false);
    assert.doesNotMatch(chip.text, /KXMLB|KXNFL|KXMVE/);
  }
}

{
  const row = mapUnhedgedRow({
    legs: [{ ticker: "KXNFLGAME-26SEP09NEKC-KC", side: "yes", league: "nfl", selection: "kc", teams: ["ne", "kc"] }],
  });
  assert.equal(row.legs[0].text, "Chiefs ML");
  assert.equal(row.label, "Chiefs ML");
}

{
  const row = mapUnhedgedRow({
    legs: [{ ticker: "KXNFLGAME-26SEP09PHIKC-PHI", side: "no", league: "nfl", teams: ["phi", "kc"] }],
  });
  assert.equal(row.legs[0].text, "Chiefs ML");
}

// ── Polymarket worker legs: symbol/slug, no ticker; last token is the pick ──
assert.equal(isTickerBlob("aec-mlb-bal-col-2026-09-02-col"), true);
assert.equal(isTickerBlob("aec-mlb-bal-col-2026-09-02-rockies"), true);
assert.equal(isTickerBlob("aec-nfl-phi-kc-2026-09-09-chiefs"), true);
assert.equal(
  formatUnhedgedLegName({ symbol: "aec-mlb-bal-col-2026-09-02-col", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLegName({ symbol: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({ symbol: "aec-mlb-bal-col-2026-09-02-col", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({ slug: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "yes",
    league: "mlb",
  }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02",
    selection: "rockies",
    side: "yes",
    league: "mlb",
  }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bos-cws-2026-09-02-red-sox",
    side: "yes",
    league: "mlb",
  }),
  "Red Sox ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bos-cws-2026-09-02-white-sox",
    side: "yes",
    league: "mlb",
  }),
  "White Sox ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-wsh-nyy-2026-09-02-nats",
    side: "yes",
    league: "mlb",
  }),
  "Nats ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-wsh-nyy-2026-09-02-yankees",
    side: "yes",
    league: "mlb",
  }),
  "Yanks ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-kc-2026-09-09-chiefs",
    side: "yes",
    league: "nfl",
  }),
  "Chiefs ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-kc-2026-09-09-kc",
    side: "yes",
    league: "nfl",
  }),
  "Chiefs ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-sf-2026-09-09-eagles",
    side: "yes",
    league: "nfl",
  }),
  "Eagles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-sf-2026-09-09-49ers",
    side: "yes",
    league: "nfl",
  }),
  "Niners ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
    teams: ["orioles", "rockies"],
  }),
  "Orioles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
    teams: ["bal", "col"],
  }),
  "Orioles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
  }),
  "Orioles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "yes",
    league: "mlb",
    fair_american: 145,
  }),
  "Rockies ML +145",
);

// Persisted Poly worker legs: game slug, no pick suffix, selection is the
// date day ("03"). teams[] is alpha-sorted and must not pick the long team.
{
  const yesLeg = {
    symbol: "aec-mlb-mia-kc-2026-09-03",
    selection: "03",
    teams: ["kc", "mia"],
    side: "yes",
    league: "mlb",
  };
  const noLeg = { ...yesLeg, side: "no" };
  assert.equal(formatUnhedgedLegName(yesLeg), "Marlins ML");
  assert.equal(formatUnhedgedLegName(noLeg), "Royals ML");
  assert.equal(formatUnhedgedLeg(yesLeg), "Marlins ML");
  assert.equal(formatUnhedgedLeg(noLeg), "Royals ML");
  assert.equal(
    formatUnhedgedLegName({
      symbol: "aec-mlb-mia-kc-2026-09-03",
      side: "yes",
      league: "mlb",
    }),
    "Marlins ML",
  );
  assert.equal(
    formatUnhedgedLegName({
      slug: "aec-mlb-mia-kc-2026-09-03",
      selection: 3,
      side: "no",
      league: "mlb",
      teams: ["kc", "mia"],
    }),
    "Royals ML",
  );
  assert.equal(
    formatUnhedgedLegName({
      ticker: "aec-mlb-mia-kc-2026-09-03",
      selection: "03",
      side: "yes",
      league: "mlb",
    }),
    "Marlins ML",
  );
}

{
  const row = mapUnhedgedRow({
    id: "poly-mia-kc-day",
    venue: "polymarket",
    legs: [{
      symbol: "aec-mlb-mia-kc-2026-09-03",
      side: "yes",
      league: "mlb",
      selection: "03",
      teams: ["kc", "mia"],
    }, {
      symbol: "aec-mlb-mia-kc-2026-09-03",
      side: "no",
      league: "mlb",
      selection: "03",
      teams: ["kc", "mia"],
    }],
  });
  assert.equal(row.venue, "Polymarket");
  assert.deepEqual(row.legs.map((l) => l.text), ["Marlins ML", "Royals ML"]);
  assert.equal(row.label, "Marlins ML · Royals ML");
  assert.doesNotMatch(row.label, /03|aec-mlb|mia-kc/);
}

{
  const row = mapUnhedgedRow({
    id: "poly-col",
    venue: "polymarket",
    legs: [{
      symbol: "aec-mlb-bal-col-2026-09-02-col",
      side: "yes",
      league: "mlb",
      selection: "col",
      teams: ["bal", "col"],
      fair_american: 145,
    }],
  });
  assert.equal(row.venue, "Polymarket");
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.legs[0].fairText, "+145");
  assert.equal(row.label, "Rockies ML");
  assert.doesNotMatch(row.label, /aec-mlb|KXMLB|BALCOL/);
}

{
  const row = mapUnhedgedRow({
    id: "poly-rockies",
    venue: "poly",
    legs: [{
      symbol: "aec-mlb-bal-col-2026-09-02-rockies",
      side: "yes",
      league: "mlb",
      selection: "rockies",
      teams: ["orioles", "rockies"],
    }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.label, "Rockies ML");
}

{
  const row = mapUnhedgedRow({
    venue: "polymarket",
    our_fair_american: 400,
    legs: [
      { symbol: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb", selection: "rockies", fair_american: 145 },
      { symbol: "aec-nfl-phi-kc-2026-09-09-chiefs", side: "yes", league: "nfl", selection: "chiefs", fair_american: -118 },
    ],
  });
  assert.equal(row.label, "Rockies ML · Chiefs ML");
  assert.deepEqual(row.legs.map((l) => l.text), ["Rockies ML", "Chiefs ML"]);
  assert.deepEqual(row.legs.map((l) => l.fairText), ["+145", "\u2212118"]);
  assert.equal(row.ourText, "—");
  assert.equal(row.fairText, "+400");
}

// ── Per-leg fair (worker fields only; row our_fair_american is the parlay) ──
{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    our_quote_american: 380,
    ticker: "KXMVE-PARLAY",
    legs: [
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", fair_american: 145 },
      { ticker: "KXMLBGAME-26SEP021510BOSNYY-BOS", side: "yes", league: "mlb", our_fair_american: -118 },
      { ticker: "KXMLBGAME-26SEP021510PITMIL-PIT", side: "yes", league: "mlb", true_american: -133 },
    ],
  });
  assert.equal(row.label, "Rockies ML · Red Sox ML · Pirates ML");
  assert.deepEqual(row.legs.map((l) => l.text), ["Rockies ML", "Red Sox ML", "Pirates ML"]);
  assert.deepEqual(row.legs.map((l) => l.fairText), ["+145", "\u2212118", "\u2212133"]);
  assert.equal(row.ourAmerican, 380);
  assert.equal(row.ourText, "+380");
  assert.equal(row.fairAmerican, 400);
  assert.equal(row.fairText, "+400");
  for (const chip of row.legs) {
    assert.doesNotMatch(chip.text, /KXMLB|KXMVE|\+400|\+380|\+145|145/);
    assert.notEqual(chip.fairText, "+400");
  }
}

{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    legs: [{ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb" }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.label, "Rockies ML");
  assert.equal(row.ourText, "—");
  assert.equal(row.fairText, "+400");
  assert.equal(row.legs[0].fairText, "—");
  assert.doesNotMatch(row.legs[0].text, /\+400|\+145|145/);
}

// ── Per-leg breakdown: one line per leg; missing venue odds are —; no row-fair reuse ──
assert.equal(formatBreakdownAmerican(-118), "\u2212118");
assert.equal(formatBreakdownAmerican(145), "+145");
assert.equal(formatBreakdownAmerican(null), "—");
assert.equal(legKalshiAmerican({ kalshi_opponent_american: -110 }), -110);
assert.equal(legKalshiAmerican({ kalshi_american: 145 }), 145);
assert.equal(legKalshiAmerican({ quotes: { kalshi: { opponent_american: -115 } } }), -115);
assert.equal(legKalshiAmerican({ quotes: [{ venue: "kalshi", opponent_american: -108 }] }), -108);
assert.equal(legKalshiAmerican({ fair_american: 145 }), null);
assert.equal(legPolyAmerican({ poly_opponent_american: 130 }), 130);
assert.equal(legPolyAmerican({ polymarket_opponent_american: -120 }), -120);
assert.equal(legPolyAmerican({ poly_american: 105 }), 105);
assert.equal(legPolyAmerican({ quotes: { polymarket: { american: 122 } } }), 122);
assert.equal(legPolyAmerican({ kalshi_opponent_american: -110 }), null);
assert.equal(legBestOpponentAmerican({ best_opponent_american: 125 }), 125);
assert.equal(legBestOpponentAmerican({}), null);
{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    our_quote_american: 380,
    legs: [
      {
        ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
        side: "yes",
        league: "mlb",
        fair_american: 145,
        kalshi_opponent_american: -110,
      },
      {
        ticker: "KXMLBGAME-26SEP021510BOSNYY-BOS",
        side: "yes",
        league: "mlb",
        our_fair_american: -118,
        poly_opponent_american: 130,
      },
      {
        ticker: "KXMLBGAME-26SEP021510PITMIL-PIT",
        side: "yes",
        league: "mlb",
        true_american: -133,
        quotes: { kalshi: { opponent_american: -105 }, polymarket: { opponent_american: 140 } },
        best_opponent_american: 140,
      },
    ],
  });
  assert.equal(row.legs.length, 3);
  assert.deepEqual(row.legs.map((l) => l.name), ["Rockies ML", "Red Sox ML", "Pirates ML"]);
  assert.deepEqual(legBreakdownLines(row), [
    "Rockies ML | MLB | Sep 2, 3:10 PM ET | +145 | \u2212110 | —",
    "Red Sox ML | MLB | Sep 2, 3:10 PM ET | \u2212118 | — | +130",
    "Pirates ML | MLB | Sep 2, 3:10 PM ET | \u2212133 | \u2212105 | +140 | +140",
  ]);
  assert.equal(row.legs[0].sport, "MLB");
  assert.equal(row.legs[0].eventText, "Sep 2, 3:10 PM ET");
  assert.equal(row.legs[0].kalshiText, "\u2212110");
  assert.equal(row.legs[0].polyText, "—");
  assert.equal(row.legs[1].kalshiText, "—");
  assert.equal(row.legs[1].polyText, "+130");
  assert.equal(row.fairText, "+400");
  for (const leg of row.legs) {
    assert.notEqual(leg.fairText, "+400");
    assert.doesNotMatch(leg.name, /\+400|\+380/);
    assert.doesNotMatch(formatLegBreakdownLine(leg), /\+400|\+380/);
  }
}
{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    legs: [
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb" },
      { ticker: "KXMLBGAME-26SEP021510BOSNYY-BOS", side: "yes", league: "mlb" },
    ],
  });
  assert.equal(row.legs.length, 2);
  assert.deepEqual(legBreakdownLines(row), [
    "Rockies ML | MLB | Sep 2, 3:10 PM ET | — | — | —",
    "Red Sox ML | MLB | Sep 2, 3:10 PM ET | — | — | —",
  ]);
  assert.equal(row.fairText, "+400");
  assert.equal(row.legs.every((l) => l.fairText === "—"), true);
}
{
  const raw = {
    our_fair_american: 400,
    legs: [
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", fair_american: 145 },
      { ticker: "KXMLBGAME-26SEP021510BOSNYY-BOS", side: "yes", league: "mlb", fair_american: -118 },
    ],
  };
  assert.deepEqual(legBreakdownLines(raw), [
    "Rockies ML | MLB | Sep 2, 3:10 PM ET | +145 | — | —",
    "Red Sox ML | MLB | Sep 2, 3:10 PM ET | \u2212118 | — | —",
  ]);
}

// ── MLB / NFL moneyline filter (hide ncaaf; spreads out) ──
{
  const mlb = {
    id: "mlb",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const nfl = {
    id: "nfl",
    legs: [{ league: "nfl", symbol: "aec-nfl-ne-sea-2026-09-09", selection: "sea" }],
  };
  const mixed = {
    id: "mix",
    legs: [
      { league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL" },
      { league: "nfl", ticker: "KXNFLGAME-26SEP09NESEA-SEA" },
    ],
  };
  const ncaaf = {
    id: "ncaaf",
    legs: [{ league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" }],
  };
  const mixedNcaaf = {
    id: "mix-ncaaf",
    legs: [
      { league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL" },
      { league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" },
    ],
  };
  const spread = {
    id: "spread",
    legs: [{ league: "mlb", type: "spread", ticker: "KXMLBSPREAD-26SEP02NYYBOS" }],
  };
  assert.equal(isMlbNflMoneylineRow(mlb), true);
  assert.equal(isMlbNflMoneylineRow(nfl), true);
  assert.equal(isMlbNflMoneylineRow(mixed), true);
  assert.equal(isMlbNflMoneylineRow(ncaaf), false);
  assert.equal(isMlbNflMoneylineRow(mixedNcaaf), false);
  assert.equal(isMlbNflMoneylineRow(spread), false);
  assert.equal(isMlbNflMoneylineRow({ id: "empty", legs: [] }), false);
  const kept = filterMlbNflMoneylineRows([mlb, nfl, mixed, ncaaf, mixedNcaaf, spread]);
  assert.deepEqual(kept.map((r) => r.id), ["mlb", "nfl", "mix"]);
}

// ── Summary counts mapped statuses over the filtered list; no invented fills ──
{
  const mapped = mapUnhedgedRows([
    { id: "a", status: "seen", our_quote_american: 150, created_at: "2026-09-02T12:00:00.000Z" },
    { id: "b", status: "seen", created_at: "2026-09-02T11:00:00.000Z" },
    { id: "c", status: "started", created_at: "2026-09-02T10:00:00.000Z" },
    { id: "d", status: "filled", fill_american: -110, created_at: "2026-09-02T09:00:00.000Z" },
  ]);
  const s = summarizeUnhedgedRows(mapped, { fetched: 400 });
  assert.equal(s.fetched, 400);
  assert.equal(s.total, 4);
  assert.equal(s.wouldQuote, 1);
  assert.equal(s.seen, 1);
  assert.equal(s.started, 1);
  assert.equal(s.filled, 1);
  assert.equal(s.quoted, 0);
  assert.equal(s.withQuote, 1);
  assert.equal(mapped[0].id, "d");
  assert.equal(mapped[1].id, "a");
}

// ── Seen / started / would_quote are not shown; NCAAF filled stays hidden ──
{
  const seen = {
    id: "seen",
    status: "seen",
    created_at: "2026-09-02T16:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const started = {
    id: "started",
    status: "started",
    created_at: "2026-09-02T15:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const would = {
    id: "would",
    status: "would_quote",
    our_quote_american: 150,
    created_at: "2026-09-02T14:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const filledMlb = {
    id: "filled-mlb",
    status: "filled",
    fill_american: -110,
    our_fair_american: 201,
    our_quote_american: 178,
    contracts: 40,
    cash_size: 25,
    filled_at: "2026-09-02T16:26:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const filledNcaaf = {
    id: "filled-ncaaf",
    status: "filled",
    fill_american: 200,
    filled_at: "2026-09-02T16:30:00.000Z",
    legs: [{ league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" }],
  };
  assert.equal(isFilledUnhedgedRow(seen), false);
  assert.equal(isFilledUnhedgedRow(started), false);
  assert.equal(isFilledUnhedgedRow(would), false);
  assert.equal(isFilledUnhedgedRow(filledMlb), true);
  assert.deepEqual(filterFilledUnhedgedRows([seen, started, would, filledMlb, filledNcaaf]).map((r) => r.id), ["filled-mlb", "filled-ncaaf"]);
  const shown = visibleUnhedgedRows([seen, started, would, filledMlb, filledNcaaf]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "filled-mlb");
  assert.equal(shown[0].fillAmerican, -110);
  assert.equal(shown[0].fairAmerican, 201);
  assert.equal(shown[0].ourAmerican, 178);
  assert.equal(shown[0].amountText, "40 · $25");
  assert.equal(shown.some((r) => r.id === "seen" || r.status === "seen"), false);
  assert.equal(isRequestUnhedgedRow(seen), true);
  assert.equal(isRequestUnhedgedRow(would), true);
  assert.equal(isRequestUnhedgedRow(started), false);
  assert.equal(isRequestUnhedgedRow(filledMlb), false);
  assert.deepEqual(filterRequestUnhedgedRows([seen, started, would, filledMlb]).map((r) => r.id), ["seen", "would"]);
  assert.deepEqual(filterUnhedgedRowsByStatusMode([seen, started, would, filledMlb], "fills").map((r) => r.id), ["filled-mlb"]);
  assert.deepEqual(filterUnhedgedRowsByStatusMode([seen, started, would, filledMlb], "requests").map((r) => r.id), ["seen", "would"]);
  const requestShown = visibleUnhedgedRows([seen, started, would, filledMlb, filledNcaaf], { venue: "polymarket" });
  assert.deepEqual(requestShown.map((r) => r.id), ["seen", "would"]);
  assert.equal(requestShown.every((r) => r.fillText === "—"), true);
  assert.equal(requestShown.find((r) => r.id === "would").ourAmerican, 150);
  const kalshiShown = visibleUnhedgedRows([seen, started, would, filledMlb, filledNcaaf], { venue: "kalshi" });
  assert.deepEqual(kalshiShown.map((r) => r.id), ["filled-mlb"]);
  const allVenueShown = visibleUnhedgedRows([seen, started, would, filledMlb, filledNcaaf], { venue: "all" });
  assert.deepEqual(allVenueShown.map((r) => r.id), ["filled-mlb"]);
}

// ── Live / in-game filled RFQs stay off the tape (not even paper) ──
assert.equal(normalizeSkipReason("game_started"), "game_started");
assert.equal(normalizeSkipReason("game-started"), "game_started");
assert.equal(normalizeSkipReason("started"), "started");
assert.equal(normalizeSkipReason("in_progress"), "started");
assert.equal(normalizeSkipReason(""), null);
assert.equal(isLiveSkipReason("game_started"), true);
assert.equal(isLiveSkipReason("started"), true);
assert.equal(isLiveSkipReason(null), false);
assert.equal(isLiveSkipReason("oversized"), false);
assert.equal(legAlreadyStarted({ league: "mlb", ticker: "KXMLBGAME-26SEP021940DETMIN-DET" }), false);
assert.equal(legAlreadyStarted({ already_started: true }), true);
assert.equal(legAlreadyStarted({ started: "game_started" }), true);
assert.equal(legAlreadyStarted({ started: false }), false);
assert.equal(legAlreadyStarted({ game_started: true }), true);
{
  const pregame = {
    id: "pregame-mlb",
    status: "filled",
    fill_american: -110,
    our_fair_american: 201,
    our_quote_american: 178,
    filled_at: "2026-09-02T16:26:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const tigersLive = {
    id: "tigers-live",
    status: "filled",
    skip_reason: "game_started",
    fill_american: 291,
    our_fair_american: 304,
    our_quote_american: 270,
    filled_at: "2026-09-03T01:57:00.000Z",
    legs: [{
      league: "mlb",
      ticker: "KXMLBGAME-26SEP021940DETMIN-DET",
      selection: "det",
      fair_american: -1192,
    }, {
      league: "mlb",
      ticker: "KXMLBGAME-26SEP021940MIAKC-MIA",
      selection: "mia",
    }],
  };
  const startedStatus = {
    id: "started-status",
    status: "started",
    skip_reason: "game_started",
    filled_at: "2026-09-03T01:57:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021940DETMIN-DET", selection: "det" }],
  };
  const startedAlias = {
    id: "started-alias",
    status: "filled",
    skip_reason: "started",
    fill_american: -1192,
    filled_at: "2026-09-03T01:57:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021940DETMIN-DET", selection: "det" }],
  };
  const legStarted = {
    id: "leg-started",
    status: "filled",
    fill_american: -105,
    filled_at: "2026-09-03T01:56:00.000Z",
    legs: [{
      league: "mlb",
      ticker: "KXMLBGAME-26SEP021940DETMIN-DET",
      selection: "det",
      already_started: true,
    }],
  };
  assert.equal(formatEtTime(tigersLive.filled_at), "Sep 2, 9:57 PM ET");
  assert.equal(isLiveUnhedgedRow(tigersLive), true);
  assert.equal(isPregameUnhedgedRow(tigersLive), false);
  assert.equal(isFilledUnhedgedRow(tigersLive), true);
  assert.equal(isLiveUnhedgedRow(pregame), false);
  assert.equal(isPregameUnhedgedRow(pregame), true);
  assert.equal(isLiveUnhedgedRow(startedStatus), true);
  assert.equal(isLiveUnhedgedRow(startedAlias), true);
  assert.equal(isLiveUnhedgedRow(legStarted), true);
  assert.deepEqual(
    filterPregameUnhedgedRows([pregame, tigersLive, startedStatus, startedAlias, legStarted]).map((r) => r.id),
    ["pregame-mlb"],
  );
  const shown = visibleUnhedgedRows([pregame, tigersLive, startedStatus, startedAlias, legStarted]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "pregame-mlb");
  assert.equal(shown.some((r) => r.id === "tigers-live"), false);
  assert.equal(shown.some((r) => (r.label || "").includes("Tigers")), false);
  assert.equal(shown.some((r) => String(r.fairText || "").includes("1192") || r.fairAmerican === -1192), false);
  assert.equal(shown.some((r) => (r.legs || []).some((l) => l.fairAmerican === -1192)), false);
}

// ── Venue filter (client chips; fetch stays filled-only 1000) ──
assert.equal(normalizeVenueFilter("all"), "all");
assert.equal(normalizeVenueFilter("Kalshi"), "kalshi");
assert.equal(normalizeVenueFilter("poly"), "polymarket");
assert.equal(normalizeVenueFilter(""), "all");
{
  const kalshi = {
    id: "k",
    status: "filled",
    venue: "kalshi",
    fill_american: 452,
    our_quote_american: 614,
    filled_at: "2026-09-02T16:26:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const poly = {
    id: "p",
    status: "filled",
    venue: "polymarket",
    fill_american: -150,
    our_quote_american: -110,
    filled_at: "2026-09-02T16:24:00.000Z",
    legs: [{ league: "nfl", symbol: "aec-nfl-ne-sea-2026-09-09", selection: "sea" }],
  };
  const shown = visibleUnhedgedRows([kalshi, poly]);
  assert.deepEqual(shown.map((r) => r.id), ["k", "p"]);
  assert.deepEqual(filterUnhedgedRowsByVenue(shown, "all").map((r) => r.id), ["k", "p"]);
  assert.deepEqual(filterUnhedgedRowsByVenue(shown, "kalshi").map((r) => r.id), ["k"]);
  assert.deepEqual(filterUnhedgedRowsByVenue(shown, "polymarket").map((r) => r.id), ["p"]);
  assert.deepEqual(filterUnhedgedRowsByVenue(shown, "Kalshi").map((r) => r.id), ["k"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { venue: "all" }).map((r) => r.id), ["k", "p"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { venue: "kalshi" }).map((r) => r.id), ["k"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { venue: "polymarket" }).map((r) => r.id), ["p"]);
}

// ── Would-quote beat fill: our_quote_american > fill_american; never invent ──
assert.equal(wouldQuoteBeatsFill({ our_quote_american: 614, fill_american: 452 }), true);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: -110, fill_american: -150 }), true);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: 452, fill_american: 614 }), false);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: -150, fill_american: -110 }), false);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: 452, fill_american: 452 }), false);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: 614 }), false);
assert.equal(wouldQuoteBeatsFill({ fill_american: 452 }), false);
assert.equal(wouldQuoteBeatsFill({ our_fair_american: 700, fill_american: 452 }), false);
assert.equal(wouldQuoteBeatsFill({ our_quote_american: 614, fill_yes_price: 0.181 }), true);
assert.equal(wouldQuoteBeatsFill({ would_quote_american: 614, fill_american: 452 }), true);
assert.equal(wouldQuoteBeatsFill({ ourAmerican: 614, fillAmerican: 452 }), true);
assert.equal(wouldQuoteBeatsFill({ ourAmerican: 452, fillAmerican: 614 }), false);
assert.equal(wouldQuoteBeatsFill({ ourAmerican: null, fillAmerican: 452, our_quote_american: 900 }), false);
assert.equal(wouldQuoteBeatsFill({}), false);
assert.equal(wouldQuoteBeatsFill({ status: "seen", our_quote_american: 614 }), false);
assert.equal(wouldQuoteBeatsFill({ status: "seen", our_quote_american: 614, fill_american: null }), false);
{
  const beatPlus = {
    id: "beat-plus",
    status: "filled",
    venue: "kalshi",
    our_quote_american: 614,
    fill_american: 452,
    filled_at: "2026-09-02T16:26:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const beatMinus = {
    id: "beat-minus",
    status: "filled",
    venue: "polymarket",
    our_quote_american: -110,
    fill_american: -150,
    filled_at: "2026-09-02T16:25:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const worse = {
    id: "worse",
    status: "filled",
    venue: "kalshi",
    our_quote_american: 400,
    fill_american: 452,
    filled_at: "2026-09-02T16:24:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const noQuote = {
    id: "no-quote",
    status: "filled",
    venue: "kalshi",
    fill_american: 452,
    filled_at: "2026-09-02T16:23:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const noFill = {
    id: "no-fill",
    status: "filled",
    venue: "kalshi",
    our_quote_american: 614,
    filled_at: "2026-09-02T16:22:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const shown = visibleUnhedgedRows([beatPlus, beatMinus, worse, noQuote, noFill]);
  assert.deepEqual(shown.map((r) => r.id), ["beat-plus", "beat-minus", "worse", "no-quote", "no-fill"]);
  assert.deepEqual(filterUnhedgedRowsByQuoteBeat(shown, false).map((r) => r.id), shown.map((r) => r.id));
  assert.deepEqual(filterUnhedgedRowsByQuoteBeat(shown, true).map((r) => r.id), ["beat-plus", "beat-minus"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { quoteBeatFill: true }).map((r) => r.id), ["beat-plus", "beat-minus"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { venue: "kalshi", quoteBeatFill: true }).map((r) => r.id), ["beat-plus"]);
  assert.deepEqual(filterUnhedgedAnalytics(shown, { venue: "polymarket", quoteBeatFill: true }).map((r) => r.id), ["beat-minus"]);
  assert.equal(shown.filter(wouldQuoteBeatsFill).some((r) => r.ourAmerican == null || r.fillAmerican == null), false);
}

// ── Missing table / missing user_id column ──
assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingTableError({ code: "42P01", message: 'relation "unhedged_rfqs" does not exist' }), true);
assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), true);
assert.equal(isMissingUserIdColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), true);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.venue does not exist' }), false);
assert.equal(isMissingFilledAtColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingFilledAtColumn({ code: "42703", message: 'column unhedged_rfqs.filled_at does not exist' }), true);
assert.equal(isMissingFilledAtColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), false);
assert.equal(isMissingUpdatedAtColumn({ code: "PGRST204", message: "Could not find the 'updated_at' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingUpdatedAtColumn({ code: "42703", message: 'column unhedged_rfqs.updated_at does not exist' }), true);
assert.equal(isMissingUpdatedAtColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column" }), false);
assert.equal(isMissingCreatedAtColumn({ code: "PGRST204", message: "Could not find the 'created_at' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingCreatedAtColumn({ code: "42703", message: 'column unhedged_rfqs.created_at does not exist' }), true);
assert.equal(isMissingCreatedAtColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column" }), false);
assert.equal(isMissingStatusColumn({ code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingStatusColumn({ code: "42703", message: 'column unhedged_rfqs.status does not exist' }), true);
assert.equal(isMissingStatusColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), false);
assert.equal(isMissingStatusColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column" }), false);
assert.equal(isMissingStatusColumn({ code: "PGRST204", message: "Could not find the 'updated_at' column" }), false);
assert.equal(isMissingVenueColumn({ code: "PGRST204", message: "Could not find the 'venue' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingVenueColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), false);
assert.equal(isMissingQuoteAmericanColumn({ code: "42703", message: 'column unhedged_rfqs.our_quote_american does not exist' }), true);
assert.equal(isMissingFillAmericanColumn({ code: "PGRST204", message: "Could not find the 'fill_american' column" }), true);
assert.equal(isMissingFillAmericanColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), false);

function createSequenceClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, select: null, eq: null, eqs: [], order: null, orders: [], limit: null, ops: [] };
      calls.push(state);
      const idx = calls.length - 1;
      const chain = {
        select(cols, opts) { state.select = cols; state.selectOpts = opts || null; state.ops.push("select"); return chain; },
        not(col, op, val) { state.nots = (state.nots || []).concat({ col, op, val }); state.ops.push("not"); return chain; },
        eq(col, val) {
          const entry = { col, val };
          state.eq = entry;
          state.eqs.push(entry);
          state.ops.push("eq");
          return chain;
        },
        order(col, opts) {
          const entry = { col, opts };
          state.order = entry;
          state.orders.push(entry);
          state.ops.push("order");
          return chain;
        },
        in(col, vals) { state.in = { col, vals }; state.ins = (state.ins || []).concat({ col, vals }); state.ops.push("in"); return chain; },
        or(filter) { state.or = filter; state.ors = (state.ors || []).concat(filter); state.ops.push("or"); return chain; },
        gte(col, val) { state.gtes = (state.gtes || []).concat({ col, val }); state.ops.push("gte"); return chain; },
        lt(col, val) { state.lts = (state.lts || []).concat({ col, val }); state.ops.push("lt"); return chain; },
        range(from, to) { state.range = { from, to }; state.ranges = (state.ranges || []).concat({ from, to }); state.ops.push("range"); return chain; },
        limit(n) { state.limit = n; state.ops.push("limit"); return chain; },
        then(resolve, reject) {
          const r = responses[Math.min(idx, responses.length - 1)];
          return Promise.resolve(r).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function orderIndexes(call) {
  const at = [];
  (call.ops || []).forEach((op, i) => { if (op === "order") at.push(i); });
  return at;
}

function assertFilledAtThenCreatedBeforeLimit(call) {
  assert.deepEqual(call.orders, [
    { col: "filled_at", opts: { ascending: false, nullsFirst: false } },
    { col: "created_at", opts: { ascending: false } },
  ]);
  const orderAt = orderIndexes(call);
  const limitAt = call.ops.indexOf("limit");
  assert.equal(orderAt.length, 2, "expected .order(filled_at) then .order(created_at)");
  assert.ok(orderAt[0] < orderAt[1], "expected filled_at order before created_at order");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt[1] < limitAt, "expected both .order() calls before .limit()");
}

function assertUpdatedThenCreatedBeforeLimit(call) {
  assert.deepEqual(call.orders, [
    { col: "updated_at", opts: { ascending: false, nullsFirst: false } },
    { col: "created_at", opts: { ascending: false } },
  ]);
  const orderAt = orderIndexes(call);
  const limitAt = call.ops.indexOf("limit");
  assert.equal(orderAt.length, 2, "expected .order(updated_at) then .order(created_at)");
  assert.ok(orderAt[0] < orderAt[1], "expected updated_at order before created_at order");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt[1] < limitAt, "expected both .order() calls before .limit()");
}

function assertFilledAtWindow(call, from, to) {
  assert.ok((call.gtes || []).some((g) => g.col === "filled_at" && (!from || g.val === from)), "expected filled_at.gte");
  if (to) {
    assert.ok((call.lts || []).some((g) => g.col === "filled_at" && g.val === to), "expected filled_at.lt");
  }
  assert.equal((call.ors || []).some((f) => /updated_at|created_at/.test(f || "")), false);
}

function hasEq(call, col, val) {
  return (call.eqs || []).some((e) => e.col === col && e.val === val);
}

function assertStatusFilledEq(call) {
  assert.equal(hasEq(call, "status", "filled"), true, "expected .eq('status', 'filled')");
}

function assertStatusSeenEq(call) {
  assert.equal(hasEq(call, "status", "seen"), true, "expected .eq('status', 'seen')");
}

function assertCreatedAtWindow(call, from, to) {
  assert.ok((call.gtes || []).some((g) => g.col === "created_at" && (!from || g.val === from)), "expected created_at.gte");
  if (to) {
    assert.ok((call.lts || []).some((g) => g.col === "created_at" && g.val === to), "expected created_at.lt");
  }
  assert.equal((call.gtes || []).some((g) => g.col === "filled_at"), false);
}

function assertNoStatusEq(call) {
  assert.equal((call.eqs || []).some((e) => e.col === "status"), false, "expected no status filter");
}

function assertCreatedAtOnlyBeforeLimit(call) {
  assert.deepEqual(call.orders, [
    { col: "created_at", opts: { ascending: false } },
  ]);
  const orderAt = call.ops.indexOf("order");
  const limitAt = call.ops.indexOf("limit");
  assert.ok(orderAt >= 0, "expected .order()");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt < limitAt, "expected .order() before .limit()");
}

// ── Slim blotter select is not scoped by user_id (worker rows are NULL / unset) ──
{
  const rows = [{ id: "1", user_id: null, status: "filled", fill_american: -110 }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", limit: 50 });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls[0].table, UNHEDGED_TABLE);
  assert.equal(client.calls[0].select, UNHEDGED_BLOTTER_SELECT);
  assert.doesNotMatch(client.calls[0].select, /\*/);
  assert.equal(hasEq(client.calls[0], "user_id", "u1"), false);
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assertStatusFilledEq(client.calls[0]);
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "venue"), false);
  assert.equal(client.calls[0].limit, 50);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
}

// ── Passing userId still returns worker rows with no / null user_id ──
{
  const rows = [{ id: "2", status: "filled", fill_american: 200 }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "kevin-id" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(client.calls[0].limit, UNHEDGED_LIMIT);
  assert.equal(UNHEDGED_LIMIT, 1000);
  assert.equal(resolveUnhedgedLimit(), 1000);
  assert.equal(resolveUnhedgedLimit(null), 1000);
  assert.equal(resolveUnhedgedLimit(50), 50);
  assert.equal(resolveUnhedgedLimit(5000), 1000);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
}

// ── Refresh re-fetches the same filled query (limit 1000, newest activity first) ──
{
  const first = [{ id: "old", status: "filled", fill_american: -110 }];
  const second = [{ id: "new", status: "filled", fill_american: 200 }];
  const client = createSequenceClient([
    { data: first, error: null },
    { data: second, error: null },
  ]);
  const a = await fetchUnhedgedRfqs(client, { userId: "u1" });
  const b = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.deepEqual(a.rows.map((r) => r.id), ["old"]);
  assert.deepEqual(b.rows.map((r) => r.id), ["new"]);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].limit, 1000);
  assert.equal(client.calls[1].limit, 1000);
  assertStatusFilledEq(client.calls[0]);
  assertStatusFilledEq(client.calls[1]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[1]);
  assert.equal(unhedgedRefreshLabel(false), "Refresh");
  assert.equal(unhedgedRefreshLabel(true), "Refreshing…");
}

// ── Seen rows from the wire are dropped even if the query leaked them ──
{
  const mixed = [
    { id: "seen", status: "seen" },
    { id: "started", status: "started" },
    { id: "would", status: "would_quote", our_quote_american: 150 },
    { id: "filled", status: "filled", fill_american: -110 },
  ];
  const client = createSequenceClient([{ data: mixed, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assertStatusFilledEq(client.calls[0]);
  assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
}

// ── Polymarket venue: status=seen, created_at window, keep priced seen rows ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const today = unhedgedDateWindow("today", now);
  const mixed = [
    {
      id: "seen-priced",
      status: "seen",
      venue: "polymarket",
      our_quote_american: 178,
      our_fair_american: 201,
      taker_american: 190,
      created_at: "2026-09-03T16:00:00.000Z",
      filled_at: null,
      legs: [{ league: "mlb", symbol: "aec-mlb-bal-col-2026-09-02-col", selection: "col" }],
    },
    {
      id: "seen-plain",
      status: "seen",
      venue: "polymarket",
      created_at: "2026-09-03T15:00:00.000Z",
      filled_at: null,
      legs: [{ league: "mlb", symbol: "aec-mlb-bal-col-2026-09-02-col", selection: "col" }],
    },
    { id: "filled", status: "filled", fill_american: -110, filled_at: "2026-09-03T16:00:00.000Z" },
    { id: "started", status: "started", created_at: "2026-09-03T16:30:00.000Z" },
  ];
  const client = createSequenceClient([{ data: mixed, error: null }]);
  const result = await fetchUnhedgedRfqs(client, {
    dateRange: "today",
    now,
    venue: "polymarket",
  });
  assertStatusSeenEq(client.calls[0]);
  assert.equal(hasEq(client.calls[0], "status", "filled"), false);
  assertCreatedAtWindow(client.calls[0], today.from, today.to);
  assert.ok((client.calls[0].ors || [client.calls[0].or]).some((f) => /venue\./.test(f || "")));
  assertCreatedAtOnlyBeforeLimit(client.calls[0]);
  assert.deepEqual(result.rows.map((r) => r.id), ["seen-priced", "seen-plain"]);
  const shown = visibleUnhedgedRows(result.rows, { venue: "polymarket" });
  assert.equal(shown.length, 2);
  assert.equal(shown[0].ourAmerican, 178);
  assert.equal(shown[0].fairAmerican, 201);
  assert.equal(shown[0].theirAmerican, 190);
  assert.equal(shown[0].fillText, "—");
  assert.equal(shown[0].timeEt, "Sep 3, 12:00 PM ET");
  assert.equal(shown[1].ourText, "—");
  assert.equal(shown[1].fillText, "—");
}

// ── All / Kalshi venue stay status=filled (Kalshi tape) ──
{
  const mixed = [
    { id: "seen", status: "seen", created_at: "2026-09-03T16:00:00.000Z" },
    { id: "filled", status: "filled", fill_american: -110, filled_at: "2026-09-03T16:00:00.000Z" },
    { id: "started", status: "started", created_at: "2026-09-03T16:30:00.000Z" },
  ];
  for (const venue of ["all", "kalshi"]) {
    const client = createSequenceClient([{ data: mixed, error: null }]);
    const result = await fetchUnhedgedRfqs(client, { dateRange: "all", venue });
    assertStatusFilledEq(client.calls[0]);
    assert.equal(hasEq(client.calls[0], "status", "seen"), false);
    assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
  }
}

// ── Live filled rows from the wire are dropped (skip_reason / started leg) ──
{
  const mixed = [
    {
      id: "tigers-live",
      status: "filled",
      skip_reason: "game_started",
      fill_american: 291,
      our_fair_american: 304,
      filled_at: "2026-09-03T01:57:00.000Z",
      legs: [{
        league: "mlb",
        ticker: "KXMLBGAME-26SEP021940DETMIN-DET",
        selection: "det",
        fair_american: -1192,
      }],
    },
    {
      id: "leg-started",
      status: "filled",
      fill_american: -105,
      filled_at: "2026-09-03T01:56:00.000Z",
      legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021940DETMIN-DET", already_started: true }],
    },
    { id: "filled", status: "filled", fill_american: -110 },
  ];
  const client = createSequenceClient([{ data: mixed, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assertStatusFilledEq(client.calls[0]);
  assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
}

// ── user_id is never queried, so a leftover user_id-column error still retries ──
{
  const rows = [{ id: "3", venue: "kalshi", status: "filled", fill_american: 180 }];
  const client = createSequenceClient([
    { data: null, error: { code: "42703", message: 'column unhedged_rfqs.user_id does not exist' } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  // First call never eq user_id. A leftover schema error is classified and
  // retried; both attempts stay unscoped.
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assertStatusFilledEq(client.calls[0]);
  assert.equal((client.calls[1].eqs || []).some((e) => e.col === "user_id"), false);
  assertStatusFilledEq(client.calls[1]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[1]);
}

// ── updated_at missing (PGRST204) → drop it from the slim select; still order filled_at ──
{
  const rows = [{ id: "4", status: "filled", fill_american: -110 }];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'updated_at' column of 'unhedged_rfqs' in the schema cache" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 2);
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assert.equal((client.calls[1].eqs || []).some((e) => e.col === "user_id"), false);
  assertStatusFilledEq(client.calls[0]);
  assertStatusFilledEq(client.calls[1]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[1]);
  assert.match(client.calls[0].select, /updated_at/);
  assert.doesNotMatch(client.calls[1].select, /updated_at/);
}

// ── updated_at missing then leftover user_id error → filled_at order, unscoped ──
{
  const rows = [{ id: "5", status: "filled", fill_american: -105 }];
  const client = createSequenceClient([
    { data: null, error: { code: "42703", message: 'column unhedged_rfqs.updated_at does not exist' } },
    { data: null, error: { code: "PGRST204", message: "Could not find the 'user_id' column" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 3);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[1]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[2]);
  for (const call of client.calls) {
    assert.equal((call.eqs || []).some((e) => e.col === "user_id"), false);
  }
  assertStatusFilledEq(client.calls[2]);
}

// ── status filter missing → retry without it, client-filter filled ──
{
  const mixed = [
    { id: "seen", status: "seen" },
    { id: "filled", status: "filled", fill_american: 220 },
  ];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" } },
    { data: mixed, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
  assert.equal(client.calls.length, 2);
  assertStatusFilledEq(client.calls[0]);
  assertNoStatusEq(client.calls[1]);
  assert.equal((client.calls[1].eqs || []).some((e) => e.col === "user_id"), false);
  assertFilledAtThenCreatedBeforeLimit(client.calls[0]);
  assertFilledAtThenCreatedBeforeLimit(client.calls[1]);
}

// ── Missing table is an empty blotter, not a throw ──
{
  const client = createSequenceClient([{
    data: null,
    error: { code: "PGRST205", message: "Could not find the table 'public.unhedged_rfqs' in the schema cache" },
  }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, true);
  assert.deepEqual(result.rows, []);
}

{
  const client = createSequenceClient([]);
  client.from = () => { throw { code: "42P01", message: 'relation "unhedged_rfqs" does not exist' }; };
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, true);
  assert.deepEqual(result.rows, []);
}

// ── Other errors stay empty but not "missing table" ──
{
  const client = createSequenceClient([{ data: null, error: { code: "42501", message: "permission denied" } }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.code, "42501");
}

// ── Date window is server-side: today uses filled_at gte/lt (not a 3-col OR) ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const today = unhedgedDateWindow("today", now);
  const rows = [{ id: "1", user_id: "u1", status: "filled", fill_american: -110, filled_at: "2026-09-03T18:30:00.000Z" }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", dateRange: "today", now });
  assert.deepEqual(result.rows.map((r) => r.id), ["1"]);
  assertFilledAtWindow(client.calls[0], today.from, today.to);
  assert.equal(client.calls[0].or, undefined);
  assert.equal(client.calls[0].range.from, 0);
  assert.equal(client.calls[0].range.to, UNHEDGED_PAGE_SIZE - 1);
  assert.equal(client.calls[0].limit, UNHEDGED_PAGE_SIZE);
  assert.equal(client.calls.length, 1);
}

// ── All time: no date OR, paginate past 1000 ──
{
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `p1-${i}`, status: "filled", fill_american: -110 }));
  const page2 = Array.from({ length: 37 }, (_, i) => ({ id: `p2-${i}`, status: "filled", fill_american: 200 }));
  const client = createSequenceClient([
    { data: page1, error: null },
    { data: page2, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", dateRange: "all" });
  assert.equal(result.rows.length, 1037);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].or, undefined);
  assert.equal(client.calls[1].or, undefined);
  assert.deepEqual(client.calls[0].range, { from: 0, to: 999 });
  assert.deepEqual(client.calls[1].range, { from: 1000, to: 1999 });
  assert.equal(result.rows[0].id, "p1-0");
  assert.equal(result.rows[1000].id, "p2-0");
  assert.equal(result.paged, true);
  assert.equal(result.truncated, false);
}

// ── Today / 24h / 7d stay one page even when the first page is full ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  for (const range of ["today", "24h", "7d"]) {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `${range}-${i}`,
      status: "filled",
      fill_american: -110,
      updated_at: "2026-09-03T18:00:00.000Z",
    }));
    const page2 = [{ id: `${range}-extra`, status: "filled", fill_american: 200, updated_at: "2026-09-03T17:00:00.000Z" }];
    const client = createSequenceClient([
      { data: page1, error: null },
      { data: page2, error: null },
    ]);
    const result = await fetchUnhedgedRfqs(client, { userId: "u1", dateRange: range, now });
    assert.equal(result.rows.length, 1000, `${range} should not walk a second page`);
    assert.equal(client.calls.length, 1, `${range} must not page Month/All-time style`);
    assert.equal(result.truncated, true);
    assert.equal(result.paged, false);
  }
}

// ── Month window paginates the full set (not a 1000-cap global trim) ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    id: `m1-${i}`,
    status: "filled",
    fill_american: 180,
    updated_at: "2026-09-01T12:00:00.000Z",
  }));
  const page2 = [{ id: "m2-0", status: "filled", fill_american: 190, updated_at: "2026-08-20T12:00:00.000Z" }];
  const client = createSequenceClient([
    { data: page1, error: null },
    { data: page2, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", dateRange: "month", now });
  assert.equal(result.rows.length, 1001);
  assert.equal(client.calls.length, 2);
  assert.ok((client.calls[0].gtes || []).some((g) => g.col === "filled_at"));
  assert.equal((client.calls[0].lts || []).some((g) => g.col === "filled_at"), false);
  assert.equal(client.calls[0].or, undefined);
  assert.deepEqual(client.calls[1].range, { from: 1000, to: 1999 });
  assert.equal(result.paged, true);
  assert.equal(result.truncated, false);
}

// ── Client date window prefers filled_at; stale fill + later write is not Today ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const mixed = [
    { id: "today-fill", status: "filled", fill_american: 4662, filled_at: "2026-09-03T16:00:00.000Z", updated_at: "2026-09-03T18:30:00.000Z" },
    { id: "stale-fill-today-write", status: "filled", fill_american: 200, filled_at: "2026-09-03T03:11:00.000Z", updated_at: "2026-09-03T18:30:00.000Z" },
    { id: "old-fill", status: "filled", fill_american: 180, filled_at: "2026-09-02T16:00:00.000Z", updated_at: "2026-09-02T16:00:00.000Z" },
  ];
  const client = createSequenceClient([{ data: mixed, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", dateRange: "today", now });
  assert.deepEqual(result.rows.map((r) => r.id), ["today-fill"]);
}

// ── Worker rows (null user_id) are visible; Today prefers filled_at ──
// Combo-worker buildUnhedgedRow / fill patches do not set user_id. Today is
// ET midnight–midnight. Server filter is filled_at gte/lt (cheap index).
// A stale filled_at (early tape / RFQ create) plus a later updated_at is
// not Today — we do not OR updated_at on every load.
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const today = unhedgedDateWindow("today", now);
  const workerToday = {
    id: "worker-today",
    user_id: null,
    status: "filled",
    venue: "kalshi",
    fill_american: 4662,
    filled_at: "2026-09-03T16:00:00.000Z",
    updated_at: "2026-09-03T18:30:00.000Z",
  };
  const workerStaleOnly = {
    id: "worker-stale",
    user_id: null,
    status: "filled",
    venue: "kalshi",
    fill_american: 180,
    filled_at: "2026-09-03T03:11:00.000Z",
  };
  const workerOld = {
    id: "worker-old",
    user_id: null,
    status: "filled",
    venue: "kalshi",
    fill_american: 200,
    filled_at: "2026-09-02T16:00:00.000Z",
    created_at: "2026-09-02T16:00:00.000Z",
  };
  assert.equal(rowInUnhedgedDateWindow(workerToday, today), true);
  assert.equal(rowInUnhedgedDateWindow(workerStaleOnly, today), false);
  assert.equal(rowInUnhedgedDateWindow(workerOld, today), false);

  const fetchClient = createSequenceClient([{ data: [workerToday, workerStaleOnly, workerOld], error: null }]);
  const fetched = await fetchUnhedgedRfqs(fetchClient, { userId: "owner-id", dateRange: "today", now });
  assert.deepEqual(fetched.rows.map((r) => r.id), ["worker-today"]);
  assert.equal((fetchClient.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assertFilledAtWindow(fetchClient.calls[0], today.from, today.to);

  const allClient = createSequenceClient([{ data: [workerToday, workerStaleOnly, workerOld], error: null }]);
  const allTime = await fetchUnhedgedRfqs(allClient, { userId: "owner-id", dateRange: "all" });
  assert.deepEqual(allTime.rows.map((r) => r.id).sort(), ["worker-old", "worker-stale", "worker-today"]);
  assert.equal((allClient.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assert.equal(allClient.calls[0].or, undefined);

  const countClient = createSequenceClient([
    { data: null, count: 3, error: null },
    { data: null, count: 2, error: null },
    { data: [{ our_quote_american: 614, fill_american: 452 }], error: null },
  ]);
  const counted = await countUnhedgedRfqs(countClient, { userId: "owner-id", dateRange: "all" });
  assert.equal(counted.filled, 3);
  assert.equal((countClient.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assert.equal((countClient.calls[0].ors || []).some((f) => /filled_at\./.test(f)), false);
}

// ── Missing updated_at: drop it from the slim select; Today stays filled_at ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const today = unhedgedDateWindow("today", now);
  const rows = [{
    id: "created-today",
    user_id: null,
    status: "filled",
    fill_american: -110,
    created_at: "2026-09-03T18:00:00.000Z",
    filled_at: "2026-09-03T16:00:00.000Z",
  }];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'updated_at' column of 'unhedged_rfqs' in the schema cache" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { dateRange: "today", now });
  assert.deepEqual(result.rows.map((r) => r.id), ["created-today"]);
  assert.equal(client.calls.length, 2);
  assertFilledAtWindow(client.calls[0], today.from, today.to);
  assertFilledAtWindow(client.calls[1], today.from, today.to);
  assert.match(client.calls[0].select, /updated_at/);
  assert.doesNotMatch(client.calls[1].select, /updated_at/);
  assert.equal((client.calls[1].eqs || []).some((e) => e.col === "user_id"), false);
}

// ── Missing filled_at: fall back to updated_at / created_at OR ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const rows = [{
    id: "updated-today",
    status: "filled",
    fill_american: -110,
    updated_at: "2026-09-03T18:00:00.000Z",
  }];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'filled_at' column of 'unhedged_rfqs' in the schema cache" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { dateRange: "today", now });
  assert.deepEqual(result.rows.map((r) => r.id), ["updated-today"]);
  assert.equal(client.calls.length, 2);
  assert.ok((client.calls[0].gtes || []).some((g) => g.col === "filled_at"));
  assert.match(client.calls[1].or, /updated_at\.gte\./);
  assert.match(client.calls[1].or, /created_at\.gte\./);
  assert.equal((client.calls[1].gtes || []).some((g) => g.col === "filled_at"), false);
  assertUpdatedThenCreatedBeforeLimit(client.calls[1]);
}

// ── Head counts: FILLED / Would-quote use count/head; beat-fill is slim cols ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const client = createSequenceClient([
    { data: null, count: 12, error: null },
    { data: null, count: 7, error: null },
    { data: [
      { our_quote_american: 614, fill_american: 452 },
      { our_quote_american: 400, fill_american: 452 },
    ], error: null },
  ]);
  const result = await countUnhedgedRfqs(client, { userId: "u1", dateRange: "today", now });
  assert.equal(result.filled, 12);
  assert.equal(result.requests, 0);
  assert.equal(result.withQuote, 7);
  assert.equal(result.beatFill, 1);
  assert.equal(result.missingTable, false);
  assert.equal(client.calls.length, 3);
  assert.equal(client.calls[0].select, UNHEDGED_COUNT_SELECT);
  assert.doesNotMatch(client.calls[0].select, /\*/);
  assert.deepEqual(client.calls[0].selectOpts, UNHEDGED_COUNT_SELECT_OPTS);
  assert.deepEqual(client.calls[1].selectOpts, UNHEDGED_COUNT_SELECT_OPTS);
  assert.equal(client.calls[0].range, undefined);
  assert.equal(client.calls[0].limit, null);
  assert.equal(client.calls[0].order, null);
  assertStatusFilledEq(client.calls[0]);
  assertStatusFilledEq(client.calls[1]);
  assertStatusFilledEq(client.calls[2]);
  assert.equal((client.calls[0].eqs || []).some((e) => e.col === "user_id"), false);
  assert.ok((client.calls[0].gtes || []).some((g) => g.col === "filled_at"));
  assert.equal((client.calls[0].ors || []).some((f) => /updated_at|created_at/.test(f || "")), false);
  assert.equal((client.calls[1].nots || []).some((n) => n.col === "our_quote_american" && n.op === "is" && n.val == null), true);
  assert.equal(client.calls[2].select, UNHEDGED_BEAT_FILL_COLS);
  assert.equal(client.calls[2].selectOpts, null);
  assert.equal((client.calls[2].nots || []).some((n) => n.col === "our_quote_american"), true);
  assert.equal((client.calls[2].nots || []).some((n) => n.col === "fill_american"), true);
}

// ── Head counts honor venue; All time has no date OR ──
{
  const client = createSequenceClient([
    { data: null, count: 4, error: null },
    { data: null, count: 3, error: null },
    { data: [{ our_quote_american: 614, fill_american: 452 }], error: null },
  ]);
  const result = await countUnhedgedRfqs(client, { userId: "u1", dateRange: "all", venue: "kalshi" });
  assert.equal(result.filled, 4);
  assert.equal(result.withQuote, 3);
  assert.equal(result.beatFill, 1);
  assert.ok((client.calls[0].ors || [client.calls[0].or]).some((f) => /venue\./.test(f || "")));
  assert.equal((client.calls[0].ors || []).some((f) => /filled_at\./.test(f)), false);
}

// ── Beat-fill chip: FILLED / Would-quote reuse the beat-fill slim count ──
{
  const client = createSequenceClient([
    { data: [
      { our_quote_american: 614, fill_american: 452 },
      { our_quote_american: 400, fill_american: 452 },
    ], error: null },
  ]);
  const result = await countUnhedgedRfqs(client, { userId: "u1", dateRange: "all", quoteBeatFill: true });
  assert.equal(result.filled, 1);
  assert.equal(result.withQuote, 1);
  assert.equal(result.beatFill, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].select, UNHEDGED_BEAT_FILL_COLS);
  assert.equal(client.calls[0].selectOpts, null);
}

// ── Month beat-fill slim-pages; FILLED stays a head count (no * download) ──
{
  const slim1 = Array.from({ length: 1000 }, (_, i) => ({
    our_quote_american: i === 0 ? 614 : 400,
    fill_american: 452,
  }));
  const slim2 = [{ our_quote_american: 900, fill_american: 100 }];
  const client = createSequenceClient([
    { data: null, count: 1001, error: null },
    { data: null, count: 1001, error: null },
    { data: slim1, error: null },
    { data: slim2, error: null },
  ]);
  const result = await countUnhedgedRfqs(client, { userId: "u1", dateRange: "month" });
  assert.equal(result.filled, 1001);
  assert.equal(result.beatFill, 2);
  assert.equal(client.calls.length, 4);
  assert.equal(client.calls[0].select, UNHEDGED_COUNT_SELECT);
  assert.deepEqual(client.calls[0].selectOpts, UNHEDGED_COUNT_SELECT_OPTS);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(client.calls[2].select, UNHEDGED_BEAT_FILL_COLS);
  assertStatusFilledEq(client.calls[2]);
  assert.deepEqual(client.calls[3].range, { from: 1000, to: 1999 });
}

// ── Head counts never drop status=filled (would count millions of seen) ──
{
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" } },
  ]);
  const result = await countUnhedgedRfqs(client, { dateRange: "all" });
  assert.equal(result.filled, null);
  assert.equal(client.calls.length, 1);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(client.calls[0].select, UNHEDGED_COUNT_SELECT);
}

// ── Requests head counts use status=seen + created_at; beat-fill is 0 ──
{
  const now = etLocalToUtc("2026-09-03", 14, 40);
  const today = unhedgedDateWindow("today", now);
  const client = createSequenceClient([
    { data: null, count: 22, error: null },
    { data: null, count: 8, error: null },
  ]);
  const result = await countUnhedgedRfqs(client, {
    dateRange: "today",
    now,
    venue: "polymarket",
  });
  assert.equal(result.filled, 0);
  assert.equal(result.requests, 22);
  assert.equal(result.withQuote, 8);
  assert.equal(result.beatFill, 0);
  assert.equal(client.calls.length, 2);
  assertStatusSeenEq(client.calls[0]);
  assertStatusSeenEq(client.calls[1]);
  assertCreatedAtWindow(client.calls[0], today.from, today.to);
  assert.ok((client.calls[0].ors || [client.calls[0].or]).some((f) => /venue\./.test(f || "")));
  assert.equal(client.calls[0].select, UNHEDGED_COUNT_SELECT);
  assert.deepEqual(client.calls[0].selectOpts, UNHEDGED_COUNT_SELECT_OPTS);
}

// ── Requests + beat-fill chip: all tiles 0 (no fill price) ──
{
  const client = createSequenceClient([
    { data: [{ our_quote_american: 614, fill_american: 452 }], error: null },
  ]);
  const result = await countUnhedgedRfqs(client, {
    dateRange: "all",
    venue: "polymarket",
    quoteBeatFill: true,
  });
  assert.equal(result.filled, 0);
  assert.equal(result.requests, 0);
  assert.equal(result.withQuote, 0);
  assert.equal(result.beatFill, 0);
  assert.equal(client.calls.length, 0);
}

// ── Head counts never drop status=seen in Requests mode ──
{
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" } },
  ]);
  const result = await countUnhedgedRfqs(client, { dateRange: "all", venue: "polymarket" });
  assert.equal(result.requests, null);
  assert.equal(client.calls.length, 1);
  assertStatusSeenEq(client.calls[0]);
}

// ── mergeUnhedgedSummary prefers head counts ──
{
  const clientSummary = { fetched: 3, total: 3, filled: 3, requests: 0, withQuote: 1, beatFill: 1, seen: 0, started: 0, wouldQuote: 0, quoted: 0 };
  const merged = mergeUnhedgedSummary(clientSummary, { filled: 40, requests: 9, withQuote: 12, beatFill: 5 });
  assert.equal(merged.filled, 40);
  assert.equal(merged.requests, 9);
  assert.equal(merged.withQuote, 12);
  assert.equal(merged.beatFill, 5);
  assert.equal(merged.total, 3);
  const fallback = mergeUnhedgedSummary(clientSummary, null);
  assert.equal(fallback.filled, 3);
  assert.equal(fallback.requests, 0);
}

// ── Beat-fill count is for the date+venue set ──
{
  const shown = visibleUnhedgedRows([
    {
      id: "beat",
      status: "filled",
      venue: "kalshi",
      our_quote_american: 614,
      fill_american: 452,
      filled_at: "2026-09-02T16:26:00.000Z",
      legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
    },
    {
      id: "worse",
      status: "filled",
      venue: "kalshi",
      our_quote_american: 400,
      fill_american: 452,
      filled_at: "2026-09-02T16:24:00.000Z",
      legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
    },
  ]);
  const s = summarizeUnhedgedRows(shown);
  assert.equal(s.filled, 2);
  assert.equal(s.beatFill, 1);
  const beatOnly = filterUnhedgedAnalytics(shown, { quoteBeatFill: true });
  assert.deepEqual(beatOnly.map((r) => r.id), ["beat"]);
  assert.equal(summarizeUnhedgedRows(beatOnly).filled, 1);
}

// ── App.jsx: private tab only; Promo Builder / Combo Locks wiring untouched ──
{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /import UnhedgedTape from "\.\/UnhedgedTape"/);
  assert.match(app, /tabStyle\("unhedged"\)/);
  assert.match(app, />Unhedged RFQs</);
  assert.match(app, /activeTab === "unhedged" && user\?\.email === OWNER_EMAIL && <UnhedgedTape user=\{user\} \/>/);
  assert.match(app, /<button style=\{tabStyle\("combo"\)\} onClick=\{\(\) => setActiveTab\("combo"\)\}>Combo Locks<\/button>/);
  assert.match(app, /<button style=\{tabStyle\("missTape"\)\} onClick=\{\(\) => setActiveTab\("missTape"\)\}>Miss tape<\/button>/);
  assert.match(app, /activeTab === "combo" && user\?\.email === OWNER_EMAIL && <ComboLocks user=\{user\} prefill=\{comboPrefill\} \/>/);
  assert.match(app, /activeTab === "promo"/);
  assert.match(app, />Promo Builder</);
}

// ── Page is read-only and not inside Combo Locks ──
{
  const page = fs.readFileSync(path.join(dir, "UnhedgedTape.jsx"), "utf8");
  assert.match(page, /className="uh"/);
  assert.match(page, /Unhedged RFQs/);
  assert.match(page, /read-only/);
  assert.match(page, /No unhedged RFQ tape yet/);
  assert.match(page, /This tab is private/);
  assert.match(page, /Time ET/);
  assert.match(page, /formatEtTime\(unhedgedDisplayTs\(r\) \|\| unhedgedActivityTs\(r\) \|\| r\.at\)/);
  assert.match(page, /unhedgedDisplayTs/);
  assert.match(page, /unhedgedActivityTs/);
  assert.match(page, />Amount</);
  assert.match(page, /Taker \/ RFQ/);
  assert.match(page, /Fill price/);
  assert.match(page, /True \/ fair/);
  assert.match(page, />Would-quote</);
  assert.doesNotMatch(page, /UNHEDGED_STATUS_FILTERS/);
  assert.doesNotMatch(page, /label: "Fills"/);
  assert.doesNotMatch(page, /label: "Requests"/);
  assert.match(page, /statusModeForVenue/);
  assert.match(page, /open Polymarket requests/);
  assert.match(page, /No seen pregame MLB or NFL moneyline RFQ requests/);
  assert.match(page, /isTickerBlob/);
  assert.match(page, /LegBreakdown/);
  assert.match(page, /className="legs"/);
  assert.match(page, />Fair</);
  assert.match(page, />Kalshi</);
  assert.match(page, />Poly</);
  assert.match(page, /Best opp/);
  assert.match(page, /filled pregame MLB or NFL moneyline/);
  assert.match(page, /We did not take these/);
  assert.match(page, /paper only/);
  assert.match(page, /In-game and started RFQs stay off this tape/);
  assert.match(page, />pregame</);
  assert.match(page, /visibleUnhedgedRows/);
  assert.match(page, /filterUnhedgedAnalytics/);
  assert.match(page, /summarizeUnhedgedRows/);
  assert.match(page, /newest activity first/);
  assert.match(page, /Would-quote beat fill/);
  assert.match(page, /UNHEDGED_DATE_FILTERS/);
  assert.match(page, /dateRange/);
  assert.match(page, /onDateRangeChange/);
  assert.match(page, />Sport</);
  assert.match(page, />Event</);
  assert.match(page, /paged from the server/);
  assert.match(page, /countUnhedgedRfqs/);
  assert.match(page, /mergeUnhedgedSummary/);
  assert.match(page, /unhedgedDateRangePages/);
  assert.match(page, /setPaging/);
  assert.match(page, /head query/);
  assert.doesNotMatch(page, /userId:\s*user/);
  assert.match(page, /Do not pass user\.id/);
  assert.match(page, /label: "All"/);
  assert.match(page, /label: "Kalshi"/);
  assert.match(page, /label: "Polymarket"/);
  assert.match(page, /venueFilter/);
  assert.match(page, /quoteBeatFill/);
  assert.match(page, /unhedgedRefreshLabel/);
  assert.match(page, /onRefresh/);
  assert.match(page, /reloadRows\(\{ button: true \}\)/);
  assert.match(page, /reloadCounts\(\)/);
  assert.match(page, /dateRange,/);
  assert.match(page, /Manual Refresh only/);
  assert.doesNotMatch(page, /setInterval/);
  assert.doesNotMatch(page, /20000/);
  assert.doesNotMatch(page, /Would-quote \/ Fair/);
  assert.doesNotMatch(page, /NCAAF|ncaaf/);
  assert.doesNotMatch(page, /location\.reload|window\.location/);
  assert.doesNotMatch(page, /onSubmit|postQuote|createQuote|type="submit"/);
  assert.doesNotMatch(page, /className="cl"/);
  assert.doesNotMatch(page, /combo_parlays|combo_submissions|combo_fills/);
}

// ── Forbidden Combo Locks files were not edited ──
{
  const forbidden = [
    "ComboLocks.jsx",
    "ComboTape.jsx",
    "comboDesk.js",
    "comboTape.js",
    "comboPrefill.js",
    "comboSettlement.js",
  ];
  for (const name of forbidden) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    assert.doesNotMatch(text, /UnhedgedTape|unhedgedTape|unhedged_rfqs/);
  }
}

// ── Optional index note for (status, filled_at DESC) ──
{
  const src = fs.readFileSync(path.join(dir, "unhedgedTape.js"), "utf8");
  assert.match(src, /unhedged_rfqs_filled_at_idx/);
  assert.match(src, /status, filled_at DESC/);
  const sql = fs.readFileSync(path.join(dir, "..", "sql", "unhedged_rfqs_filled_at_idx.sql"), "utf8");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS unhedged_rfqs_status_filled_at_idx/);
  assert.match(sql, /\(status, filled_at DESC\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS unhedged_rfqs_status_created_at_idx/);
  assert.match(sql, /\(status, created_at DESC\)/);
}

console.log("unhedgedTape.test.js: ok");
