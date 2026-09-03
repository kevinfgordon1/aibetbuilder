// Combo miss-tape analytics — beat/delta + miss classification over the same
// polls Combo Locks already uses (combo_parlays / combo_fills / combo_matches /
// quote_outcomes). combo_submissions (quoted / filled / unfilled / declined)
// plus combo_fills are the lock tape; quote_outcomes stay optional (watcher
// may be parked). Does not invent tables or tape columns.
// Lock win/loss copy is official Kalshi combo result only (kalshi_result via
// settlementFromStored) — never inferred from kickoff, clocks, or scores.
//
// Beat math matches combo-worker tape.js: theirNo − ourNo (positive = they paid
// more for NO, so the requester got a cheaper YES). YES American is converted
// from the NO price (1 − NO), never guessed when tape columns are empty.
// Miss-tape display is that YES / parlay American (e.g. 0.90 NO → +900), not cents.
// Miss labels reuse comboDesk skipLabel / tapeNoPrice / tapeMatch.
//
// Skip-then-filled is tape_match=matched on the skip row (match and/or declined
// submission). Those columns are not on main yet — missing tape is "unknown",
// not "unfilled". tape_match=none is the only leftover no-print / unfilled.
//
// Venue is combo_submissions.venue when the worker writes it (kalshi |
// polymarket). Same lock can take both. Else infer from ticker / raw /
// kalshi_created_time. Unlabeled historical rows default to Kalshi — RFQ ids
// are the same UUID shape on both venues.

import {
  remainingFill,
  tapeNoPrice,
  tapeMatch,
  skipLabel,
  outcomesForParlay,
} from "./comboDesk.js";
import { settlementFromStored } from "./comboSettlement.js";

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsMs(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function tapeYesPrice(outcome) {
  if (!outcome) return null;
  const direct = toNum(outcome.tape_yes_price);
  if (direct != null) return direct;
  const tape = outcome.raw && typeof outcome.raw === "object" ? outcome.raw.tape : null;
  if (!tape) return null;
  return toNum(tape.yes_price != null ? tape.yes_price : tape.yesPrice);
}

export function ourNoBid(outcome) {
  if (!outcome) return null;
  const submitted = toNum(outcome.submitted_no_bid);
  if (submitted != null) return submitted;
  return toNum(outcome.no_bid);
}

export function impliedYes(noPrice) {
  const n = toNum(noPrice);
  if (n == null) return null;
  return Math.round((1 - n) * 100) / 100;
}

// Same convention as ComboLocks / comboPrefill / combo-worker engine.
export function americanFromProb(p) {
  const n = toNum(p);
  if (!(n > 0 && n < 1)) return null;
  return n < 0.5
    ? Math.round((100 * (1 - n)) / n)
    : -Math.round((100 * n) / (1 - n));
}

export function formatAmerican(a) {
  if (a == null || !Number.isFinite(a)) return null;
  return a > 0 ? "+" + a : String(a);
}

// combo-worker tape.js: YES = 1 − NO, then American of the YES / parlay side.
export function americanFromNo(noPrice) {
  return americanFromProb(impliedYes(noPrice));
}

export function formatParlayAmerican({ no, yes } = {}) {
  const fromNo = americanFromNo(no);
  if (fromNo != null) return formatAmerican(fromNo);
  return formatAmerican(americanFromProb(yes));
}

// theirNo − ourNo. Positive = they paid more for NO (we were too cheap on NO).
export function outbidDelta(ourNo, theirNo) {
  const ours = toNum(ourNo);
  const theirs = toNum(theirNo);
  if (ours == null || theirs == null) return null;
  return Math.round((theirs - ours) * 100) / 100;
}

export function hasTapePrice(outcome) {
  return tapeNoPrice(outcome) != null || tapeYesPrice(outcome) != null;
}

export function beatFromOutcome(outcome) {
  const ourNo = ourNoBid(outcome);
  const tapedNo = tapeNoPrice(outcome);
  const tapedYes = tapeYesPrice(outcome);
  if (tapedNo == null && tapedYes == null) {
    return {
      known: false,
      dollars: null,
      cents: null,
      ourNo,
      theirNo: null,
      ourAmerican: americanFromProb(impliedYes(ourNo)),
      theirAmerican: null,
    };
  }
  const theirNo = tapedNo != null ? tapedNo : impliedYes(tapedYes);
  const theirYes = tapedYes != null ? tapedYes : impliedYes(tapedNo);
  const ourYes = impliedYes(ourNo);
  const dollars = outbidDelta(ourNo, theirNo);
  return {
    known: dollars != null,
    dollars,
    cents: dollars != null ? Math.round(dollars * 100) : null,
    ourNo,
    theirNo,
    ourYes,
    theirYes,
    ourAmerican: americanFromProb(ourYes),
    theirAmerican: americanFromProb(theirYes),
  };
}

export function formatBeat(beat) {
  if (!beat || !beat.known || beat.cents == null) return null;
  const we = formatAmerican(beat.ourAmerican);
  const they = formatAmerican(beat.theirAmerican);
  if (we && they) return `we ${we} they ${they}`;
  return we || they || null;
}

export function formatBeatTitle(beat) {
  if (!beat || !beat.known || beat.cents == null) return null;
  const cents = `${Math.abs(beat.cents)}¢`;
  if (beat.dollars > 0) return `outbid ${cents}`;
  if (beat.dollars < 0) return `we were longer ${cents}`;
  return "same price";
}

// Live quoting stops at first-game kickoff. Unknown timestamps stay in.
export function isLiveQuotingTs(ts, startsAt) {
  if (!startsAt) return true;
  const kick = tsMs(startsAt);
  if (!kick) return true;
  const t = tsMs(ts);
  if (!t) return true;
  return t < kick;
}

export function rfqEventAt(match, outcome) {
  return (match && match.matched_at)
    || (outcome && (outcome.posted_at || outcome.updated_at))
    || null;
}

export function fillEventAt(fill) {
  return (fill && (fill.kalshi_created_time || fill.recorded_at)) || null;
}

export function fillRfqId(fill) {
  if (!fill) return null;
  return fill.rfq_id || (fill.raw && (fill.raw.rfq_id || (fill.raw.msg && fill.raw.msg.rfq_id))) || null;
}

export function fillRowId(fill) {
  if (!fill) return null;
  return fill.fill_id || fill.id || null;
}

// Same aliases as UnhedgedTape — Kalshi / Polymarket only on this blotter.
export const TAPE_VENUE_FILTERS = ["all", "kalshi", "polymarket"];
const VENUE_FIELD_KEYS = ["venue", "exchange", "source", "book"];
const KALSHI_TICKER = /\bKX(?:MLB|NFL|NCAAF|NBA|NHL|MVE|ATP|PGA)?[A-Z0-9]*\b/i;
const POLY_SLUG = /(?:^|[^a-z0-9])(?:aec[-_]|polymarket|poly[-_])|[a-z]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}/i;

export function tapeVenueKey(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  if (s === "kalshi" || s === "kxi" || s.startsWith("kalshi")) return "kalshi";
  if (s === "polymarket" || s === "poly" || s === "pm" || s.startsWith("polymarket") || s.startsWith("poly")) {
    return "polymarket";
  }
  return "";
}

export function formatTapeVenue(value) {
  const key = tapeVenueKey(value);
  if (key === "kalshi") return "Kalshi";
  if (key === "polymarket") return "Polymarket";
  return "";
}

export function normalizeTapeVenueFilter(value) {
  const key = tapeVenueKey(value);
  if (key === "kalshi" || key === "polymarket") return key;
  return "all";
}

function pickVenueField(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of VENUE_FIELD_KEYS) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

function tickerHint(value) {
  const t = String(value == null ? "" : value).trim();
  if (!t) return "";
  if (KALSHI_TICKER.test(t) || /^KX/i.test(t)) return "kalshi";
  if (POLY_SLUG.test(t) && !KALSHI_TICKER.test(t)) return "polymarket";
  return "";
}

function sourceHint(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  if (s.includes("polymarket") || s.includes("poly-rfq") || s === "poly" || s.startsWith("poly")) return "polymarket";
  if (s === "live-runner" || s.includes("kalshi")) return "kalshi";
  return "";
}

// Prefer a persisted venue column (combo-worker writes kalshi | polymarket).
// Else infer from ticker / raw / kalshi_created_time. Unlabeled historical
// Combo Locks rows are Kalshi — Poly ids are the same UUID shape.
export function inferTapeVenue(row) {
  if (!row || typeof row !== "object") return "";
  const bags = [row, row.raw, row.raw && row.raw.msg, row.raw && row.raw.tape].filter((x) => x && typeof x === "object");
  for (const bag of bags) {
    const key = tapeVenueKey(pickVenueField(bag));
    if (key) return key;
  }
  for (const bag of bags) {
    const fromTicker = tickerHint(
      bag.market_ticker || bag.ticker || bag.combo_ticker || bag.symbol || bag.slug || bag.market_slug,
    );
    if (fromTicker) return fromTicker;
  }
  if (row.kalshi_created_time) return "kalshi";
  for (const bag of bags) {
    const fromSource = sourceHint(bag.source);
    if (fromSource) return fromSource;
  }
  return "";
}

export function inferRfqVenue({ match, outcome, submission, fill, parlay } = {}) {
  const sources = [submission, fill, outcome, match, parlay];
  for (const src of sources) {
    const key = inferTapeVenue(src);
    if (key) return key;
  }
  // Same lock can take Kalshi + Poly RFQs; missing persist is historical Kalshi tape.
  return "kalshi";
}

export function rowMatchesTapeVenue(row, venue) {
  const wanted = normalizeTapeVenueFilter(venue);
  if (wanted === "all") return true;
  return (row && row.venueKey ? row.venueKey : inferTapeVenue(row)) === wanted;
}

export function filterTapeRowsByVenue(rows, venue) {
  return (rows || []).filter((row) => rowMatchesTapeVenue(row, venue));
}

export function filterLockTapeByVenue(tape, venue) {
  if (!tape) return tape;
  const wanted = normalizeTapeVenueFilter(venue);
  if (wanted === "all") return tape;
  const rows = filterTapeRowsByVenue(tape.rows, wanted);
  const todayRows = rows.filter((r) => isSameLocalDay(r.at));
  const live = summarizeRows(rows);
  const today = summarizeRows(todayRows);
  return {
    ...tape,
    rows,
    live,
    today,
    typicalBeat: typicalBeatText(live.beat),
    typicalBeatTitle: typicalBeatTitle(live.beat),
    todayBeat: typicalBeatText(today.beat),
    todayBeatTitle: typicalBeatTitle(today.beat),
  };
}

function normStatus(status) {
  return String(status || "").toLowerCase().replace(/[_-]/g, "");
}

// combo_submissions check constraint: shadow | filled | unfilled | declined.
// Worker maps limitreached → declined before insert. "quoted" / "cancelled"
// are accepted if a later constraint change lands; do not invent columns.
export function isQuotedLostStatus(status) {
  const s = normStatus(status);
  return s === "unfilled" || s === "cancelled" || s === "canceled" || s === "quoted";
}

export function isFilledSubmission(submission) {
  if (!submission) return false;
  return !!submission.order_id;
}

// Posted and still live: quote_id set, no order_id, not a skip, is_live === true.
// combo-worker POSTs status quoted with is_live true; the 20s cancel / rfq_deleted
// path only flips is_live to false and leaves status quoted. That is not open.
export function isOpenQuote(submission) {
  if (!submission || submission.order_id || !submission.quote_id) return false;
  if (isSkipStatus(submission.status)) return false;
  return submission.is_live === true;
}

export function isQuotedLost(submission) {
  if (!submission || isOpenQuote(submission) || isFilledSubmission(submission)) return false;
  const status = normStatus(submission.status);
  if (status === "shadow" || isSkipStatus(status)) return false;
  if (isQuotedLostStatus(status)) return true;
  return status === "filled" && !submission.order_id;
}

export function submissionRank(submission) {
  if (isFilledSubmission(submission)) return 4;
  if (isOpenQuote(submission)) return 3;
  if (isQuotedLost(submission)) return 2;
  if (submission && isSkipStatus(submission.status)) return 1;
  return 0;
}

// Prefer a priced Kalshi fill (fractional count) over a booked order_id twin.
export function pickFillRow(fills = []) {
  const list = (fills || []).filter(Boolean);
  if (!list.length) return null;
  const priced = list.filter((f) => toNum(f.no_price) != null || toNum(f.yes_price) != null);
  const pool = priced.length ? priced : list;
  const real = pool.find((f) => f.fill_id && f.order_id && f.fill_id !== f.order_id);
  return real || pool[0];
}

export function liveFilledContracts(fills = [], startsAt) {
  let n = 0;
  (fills || []).forEach((f) => {
    if (!isLiveQuotingTs(fillEventAt(f), startsAt)) return;
    n += Math.max(0, toNum(f.count) || 0);
  });
  return n;
}

export function isSameLocalDay(ts, now = Date.now()) {
  const t = tsMs(ts);
  if (!t) return false;
  const a = new Date(t);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// combo-worker maps limitreached → declined before insert (check constraint).
// Read both spellings so a later constraint change still counts as a skip.
export function isSkipStatus(status) {
  const s = String(status || "").toLowerCase().replace(/[_-]/g, "");
  return s === "declined" || s === "limitreached";
}

// Prefer an explicit tape_match on the skip row. Match and declined submission
// are both "the skip row" once the worker starts writing skip-tape.
export function skipTapeSource(match, submission) {
  const rows = [match, submission].filter(Boolean);
  const flagged = rows.find((r) => tapeMatch(r) != null);
  if (flagged) return flagged;
  return rows.find((r) => hasTapePrice(r) || tapeYesPrice(r) != null) || null;
}

// Missing tape → unknown. Do not call that unfilled.
export function skipFillState(source) {
  if (!source) return "unknown";
  const match = tapeMatch(source);
  if (match === "matched") return "filled";
  if (match === "none") return "none";
  return "unknown";
}

export function skipTapeAmerican(row) {
  const src = (row && row.skipTape) || row;
  if (!src) return null;
  return formatParlayAmerican({
    no: row.tapeNo != null ? row.tapeNo : tapeNoPrice(src),
    yes: row.tapeYes != null ? row.tapeYes : tapeYesPrice(src),
  });
}

export function formatSkipReason(row) {
  const skipText = (row && row.skip && row.skip.text)
    || (row && row.bucket === "oversized" ? "oversized" : "skipped");
  if (row && row.skipFill === "filled") {
    const am = skipTapeAmerican(row);
    return am ? `skipped, later filled ${am}` : "skipped, later filled";
  }
  if (row && row.skipFill === "none") return `${skipText} · no print`;
  return skipText;
}

export function skipFillSummary(stats) {
  if (!stats || !stats.skipped) {
    return { n: 0, sub: "no skipped RFQs", known: false };
  }
  if (!stats.skippedFilled && !stats.skippedNone) {
    return { n: stats.skipped, sub: "of those, later filled unknown · skip-tape not written yet", known: false };
  }
  const bits = [`of those, later filled ${stats.skippedFilled}`];
  if (stats.skippedUnknown) bits.push(`${stats.skippedUnknown} unknown`);
  if (stats.skippedNone) bits.push(`${stats.skippedNone} no print`);
  return { n: stats.skipped, sub: bits.join(" · "), known: true };
}

export function skipLockLine(stats) {
  const s = skipFillSummary(stats);
  if (!s.n) return null;
  if (!s.known) return `${s.n} skipped · later filled unknown`;
  return `${s.n} skipped · ${s.sub.replace(/^of those, /, "")}`;
}

// Official Kalshi combo result only (combo_parlays.kalshi_result). Same copy as
// Combo Locks: we sold NO, so yes = parlay won (we lost), no = parlay lost (we won).
// Never infer from kickoff, clocks, or scores.
export function lockSettlement(parlay) {
  return settlementFromStored(parlay);
}

export function settlementTally(lockTapes = []) {
  let weWon = 0;
  let weLost = 0;
  let pending = 0;
  for (const t of lockTapes || []) {
    const s = (t && t.settlement) || lockSettlement(t && t.parlay);
    if (!s) pending++;
    else if (s.weWon) weWon++;
    else weLost++;
  }
  return { weWon, weLost, pending, settled: weWon + weLost };
}

export function settlementSummaryText(tally) {
  if (!tally || !tally.settled) return null;
  return `we won ${tally.weWon} · we lost ${tally.weLost}`;
}

export function classifyMiss({ match, outcome, submission, fill, filled = 0, ceiling = 0 } = {}) {
  if (fill || isFilledSubmission(submission)
    || (outcome && (outcome.outcome === "executed" || outcome.outcome === "accepted" || outcome.fill_confirmed))) {
    return { bucket: "filled", reason: "filled", missed: false };
  }
  if (outcome) {
    if (outcome.outcome === "posted") {
      return { bucket: "awaiting", reason: "awaiting", missed: false };
    }
    if (outcome.outcome === "lost") {
      const priced = hasTapePrice(outcome);
      const matched = tapeMatch(outcome) === "matched";
      const reason = outcome.loss_reason || "lost";
      // comboDesk.formatLoss: a stored clearing price on outbid / no_purchase
      // (or an explicit tape match) is the public-tape outbid signal.
      const outbid = reason === "outbid" || matched || (priced && reason === "no_purchase");
      if (outbid) {
        const beat = beatFromOutcome(outcome);
        return { bucket: "outbid", reason: "outbid", missed: true, beat, tape: beat.known };
      }
      if (reason === "too_slow") return { bucket: "too_slow", reason: "too_slow", missed: true };
      if (reason === "no_taker" || reason === "no_purchase") {
        return { bucket: "no_taker", reason: "no_taker", missed: true };
      }
      return { bucket: "lost", reason: "lost", missed: true };
    }
    return { bucket: "quoted", reason: outcome.outcome || "quoted", missed: false };
  }
  if (isOpenQuote(submission)) {
    return { bucket: "awaiting", reason: "open", missed: false };
  }
  if (isQuotedLost(submission)) {
    const status = normStatus(submission.status);
    if (status === "cancelled" || status === "canceled") {
      return { bucket: "no_taker", reason: "cancelled", missed: true };
    }
    return { bucket: "no_taker", reason: "quoted · no take", missed: true };
  }
  const skipRow = match || submission;
  const skip = skipLabel(skipRow, { filled, ceiling, hedgeCap: ceiling });
  const tape = skipTapeSource(match, submission);
  const skipFill = skipFillState(tape);
  if (skip.kind === "oversized") {
    return { bucket: "oversized", reason: "oversized", missed: true, skip, skipFill, skipTape: tape };
  }
  return { bucket: "skipped", reason: "skipped", missed: true, skip, skipFill, skipTape: tape };
}

export function buildRfqRow({ match, outcome, submission, fill, filled = 0, ceiling = 0, startsAt } = {}) {
  const chosenFill = fill || null;
  const at = (chosenFill && fillEventAt(chosenFill))
    || rfqEventAt(match, outcome)
    || (submission && submission.created_at)
    || null;
  const cls = classifyMiss({ match, outcome, submission, fill: chosenFill, filled, ceiling });
  const tapeRow = outcome || cls.skipTape || skipTapeSource(match, submission);
  const fillCount = chosenFill ? toNum(chosenFill.count) : null;
  const ourNo = ourNoBid(outcome)
    || ourNoBid(submission)
    || (chosenFill ? toNum(chosenFill.no_price) : null);
  const venueKey = inferRfqVenue({ match, outcome, submission, fill: chosenFill });
  return {
    rfqId: (match && match.rfq_id) || (outcome && outcome.rfq_id) || (submission && submission.rfq_id) || fillRfqId(chosenFill) || null,
    fillId: fillRowId(chosenFill),
    at,
    live: isLiveQuotingTs(at, startsAt),
    contracts: fillCount != null ? fillCount : toNum((match && match.contracts) ?? (submission && submission.contracts)),
    ourNo,
    tapeNo: tapeNoPrice(tapeRow),
    tapeYes: tapeYesPrice(tapeRow),
    venueKey,
    venue: formatTapeVenue(venueKey) || "Kalshi",
    outcome,
    submission,
    fill: chosenFill,
    ...cls,
  };
}

export function mean(nums) {
  if (!nums || !nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function median(nums) {
  if (!nums || !nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function beatStats(beats = []) {
  const known = (beats || []).filter((b) => b && b.known && b.cents != null);
  if (!known.length) {
    return {
      n: 0,
      avgCents: null,
      medCents: null,
      avgAmericanGap: null,
      medAmericanGap: null,
      avgOurAmerican: null,
      avgTheirAmerican: null,
      medOurAmerican: null,
      medTheirAmerican: null,
    };
  }
  const cents = known.map((b) => b.cents);
  const withAm = known.filter((b) => b.ourAmerican != null && b.theirAmerican != null);
  const gaps = withAm.map((b) => b.theirAmerican - b.ourAmerican);
  const ours = withAm.map((b) => b.ourAmerican);
  const theirs = withAm.map((b) => b.theirAmerican);
  return {
    n: known.length,
    avgCents: Math.round(mean(cents)),
    medCents: Math.round(median(cents)),
    avgAmericanGap: gaps.length ? Math.round(mean(gaps)) : null,
    medAmericanGap: gaps.length ? Math.round(median(gaps)) : null,
    avgOurAmerican: ours.length ? Math.round(mean(ours)) : null,
    avgTheirAmerican: theirs.length ? Math.round(mean(theirs)) : null,
    medOurAmerican: ours.length ? Math.round(median(ours)) : null,
    medTheirAmerican: theirs.length ? Math.round(median(theirs)) : null,
  };
}

function emptyCounts() {
  return {
    matched: 0,
    filled: 0,
    quoted: 0,
    lost: 0,
    skipped: 0,
    skippedFilled: 0,
    skippedNone: 0,
    skippedUnknown: 0,
    missed: 0,
    outbid: 0,
    no_taker: 0,
    oversized: 0,
    too_slow: 0,
    lost_other: 0,
    awaiting: 0,
    tapedOutbid: 0,
  };
}

function tallySkipFill(counts, row) {
  if (row.skipFill === "filled") counts.skippedFilled++;
  else if (row.skipFill === "none") counts.skippedNone++;
  else counts.skippedUnknown++;
}

export function summarizeRows(rows = []) {
  const counts = emptyCounts();
  const beats = [];
  for (const r of rows || []) {
    counts.matched++;
    if (r.bucket === "filled") counts.filled++;
    if (r.bucket === "awaiting") counts.awaiting++;
    if (r.bucket !== "skipped" && r.bucket !== "oversized") counts.quoted++;
    if (r.bucket === "outbid" || r.bucket === "no_taker" || r.bucket === "too_slow" || r.bucket === "lost") {
      counts.lost++;
    }
    if (r.bucket === "skipped" || r.bucket === "oversized") {
      counts.skipped++;
      tallySkipFill(counts, r);
    }
    if (r.missed) counts.missed++;
    if (r.bucket === "outbid") {
      counts.outbid++;
      if (r.beat && r.beat.known) {
        counts.tapedOutbid++;
        beats.push(r.beat);
      }
    }
    if (r.bucket === "no_taker") counts.no_taker++;
    if (r.bucket === "oversized") counts.oversized++;
    if (r.bucket === "too_slow") counts.too_slow++;
    if (r.bucket === "lost") counts.lost_other++;
  }
  return { ...counts, beat: beatStats(beats) };
}

export function tapeWatcherState(outcomes = []) {
  if ((outcomes || []).some((o) => hasTapePrice(o) || tapeMatch(o) === "matched")) {
    return { key: "on", label: "tape live" };
  }
  return { key: "off", label: "no tape · watcher off" };
}

export function typicalBeatText(stats) {
  if (!stats || !stats.n) return null;
  const we = formatAmerican(stats.avgOurAmerican);
  const they = formatAmerican(stats.avgTheirAmerican);
  if (we && they) return `we ${we} they ${they}`;
  const avgAm = formatAmerican(stats.avgAmericanGap);
  const medAm = formatAmerican(stats.medAmericanGap);
  if (avgAm != null && medAm != null) return `avg ${avgAm} / med ${medAm}`;
  return null;
}

export function typicalBeatTitle(stats) {
  if (!stats || !stats.n) return null;
  const medWe = formatAmerican(stats.medOurAmerican);
  const medThey = formatAmerican(stats.medTheirAmerican);
  const bits = [];
  if (medWe && medThey) bits.push(`med we ${medWe} they ${medThey}`);
  if (stats.avgCents != null && stats.medCents != null) {
    bits.push(`avg ${Math.abs(stats.avgCents)}¢ / med ${Math.abs(stats.medCents)}¢`);
  }
  return bits.join(" · ") || null;
}

function sameParlay(row, parlay) {
  if (!parlay || !parlay.id) return true;
  return !row || !row.parlay_id || row.parlay_id === parlay.id;
}

export function buildLockTape({
  parlay,
  fills = [],
  matches = [],
  outcomes = [],
  outcomeByRfq = {},
  submissions = [],
  submissionByRfq = {},
  now = Date.now(),
} = {}) {
  const startsAt = parlay && parlay.starts_at;
  const filled = liveFilledContracts(fills, startsAt);
  const ceiling = parlay && parlay.max_contracts != null ? parlay.max_contracts : 0;
  const fill = remainingFill({ filled, ceiling });
  const parlayOutcomes = outcomesForParlay(outcomes, { parlayId: parlay && parlay.id, matches });
  const byRfq = { ...outcomeByRfq };
  parlayOutcomes.forEach((o) => {
    if (o && o.rfq_id && !byRfq[o.rfq_id]) byRfq[o.rfq_id] = o;
  });
  const bySub = {};
  Object.entries(submissionByRfq || {}).forEach(([rfq, s]) => {
    if (rfq && s && sameParlay(s, parlay) && normStatus(s.status) !== "shadow") bySub[rfq] = s;
  });
  (submissions || []).forEach((s) => {
    if (!s || !s.rfq_id || !sameParlay(s, parlay)) return;
    if (normStatus(s.status) === "shadow") return;
    if (!bySub[s.rfq_id] || submissionRank(s) > submissionRank(bySub[s.rfq_id])) bySub[s.rfq_id] = s;
  });
  const subByOrder = {};
  (submissions || []).forEach((s) => {
    if (s && s.order_id && sameParlay(s, parlay)) subByOrder[s.order_id] = s;
  });

  const bundles = new Map();
  const take = (key) => {
    if (!bundles.has(key)) bundles.set(key, { match: null, outcome: null, submission: null, fills: [] });
    return bundles.get(key);
  };

  (matches || []).forEach((m) => {
    if (!m || !sameParlay(m, parlay)) return;
    if (m.rfq_id) {
      const b = take(m.rfq_id);
      b.match = m;
      if (byRfq[m.rfq_id]) b.outcome = byRfq[m.rfq_id];
    }
  });
  Object.keys(bySub).forEach((rfq) => {
    if (!rfq) return;
    const b = take(rfq);
    b.submission = bySub[rfq];
    if (byRfq[rfq]) b.outcome = byRfq[rfq];
  });
  (fills || []).forEach((f) => {
    if (!f || !sameParlay(f, parlay)) return;
    const viaOrder = f.order_id && subByOrder[f.order_id] ? subByOrder[f.order_id].rfq_id : null;
    const rfq = fillRfqId(f) || viaOrder || null;
    if (rfq) {
      take(rfq).fills.push(f);
      if (!take(rfq).submission && viaOrder) take(rfq).submission = subByOrder[f.order_id];
      return;
    }
    const id = fillRowId(f);
    if (!id) return;
    take("fill:" + id).fills.push(f);
  });

  const rows = [];
  bundles.forEach((b, key) => {
    const chosenFill = pickFillRow(b.fills);
    const submission = b.submission || (key && bySub[key]) || null;
    const match = b.match || (submission && {
      rfq_id: submission.rfq_id,
      contracts: submission.contracts,
      matched_at: submission.created_at,
      parlay_id: submission.parlay_id,
    }) || (chosenFill && fillRfqId(chosenFill) && {
      rfq_id: fillRfqId(chosenFill),
      contracts: chosenFill.count,
      matched_at: fillEventAt(chosenFill),
      parlay_id: chosenFill.parlay_id,
    }) || null;
    if (!match && !b.outcome && !submission && !chosenFill) return;
    rows.push(buildRfqRow({
      match,
      outcome: b.outcome || (match && match.rfq_id ? byRfq[match.rfq_id] : null),
      submission,
      fill: chosenFill,
      filled: fill.filled,
      ceiling,
      startsAt,
    }));
  });

  const liveRows = rows.filter((r) => r.live);
  const todayRows = liveRows.filter((r) => isSameLocalDay(r.at, now));
  const live = summarizeRows(liveRows);
  const today = summarizeRows(todayRows);

  return {
    parlay,
    fill,
    settlement: lockSettlement(parlay),
    archived: !!(parlay && parlay.archived_at),
    living: !!(parlay && !parlay.archived_at),
    startsAt,
    rows: liveRows,
    afterKickoff: rows.length - liveRows.length,
    live,
    today,
    typicalBeat: typicalBeatText(live.beat),
    typicalBeatTitle: typicalBeatTitle(live.beat),
    todayBeat: typicalBeatText(today.beat),
    todayBeatTitle: typicalBeatTitle(today.beat),
  };
}

// Living + worker watching. Paused (active=false) or archived is not quoting.
export function isQuotingParlay(row) {
  return !!(row && row.archived_at == null && row.active !== false);
}

export function hasQuotingParlays(rows = []) {
  return (rows || []).some(isQuotingParlay);
}

export function lockInScope(tape, scope, now = Date.now()) {
  if (!tape || !tape.parlay) return false;
  if (scope === "active") return tape.living;
  if (scope === "today") {
    if (tape.today.matched > 0) return true;
    return isSameLocalDay(tape.parlay.starts_at || tape.parlay.created_at, now);
  }
  return true;
}

export function buildTapeSummary(lockTapes = [], { scope = "active", now = Date.now() } = {}) {
  const locks = (lockTapes || []).filter((t) => lockInScope(t, scope, now));
  const useToday = scope === "today";
  let filled = 0;
  let ceiling = 0;
  const beats = [];
  const rfq = emptyCounts();
  for (const t of locks) {
    filled += t.fill.filled;
    ceiling += t.fill.ceiling;
    const s = useToday ? t.today : t.live;
    rfq.matched += s.matched;
    rfq.filled += s.filled;
    rfq.quoted += s.quoted;
    rfq.lost += s.lost;
    rfq.skipped += s.skipped;
    rfq.missed += s.missed;
    rfq.outbid += s.outbid;
    rfq.no_taker += s.no_taker;
    rfq.oversized += s.oversized;
    rfq.too_slow += s.too_slow;
    rfq.lost_other += s.lost_other;
    rfq.awaiting += s.awaiting;
    rfq.tapedOutbid += s.tapedOutbid;
    rfq.skippedFilled += s.skippedFilled;
    rfq.skippedNone += s.skippedNone;
    rfq.skippedUnknown += s.skippedUnknown;
    for (const r of (useToday ? t.rows.filter((row) => isSameLocalDay(row.at, now)) : t.rows)) {
      if (r.bucket === "outbid" && r.beat && r.beat.known) beats.push(r.beat);
    }
  }
  const fill = remainingFill({ filled, ceiling });
  const beat = beatStats(beats);
  const settlement = settlementTally(locks);
  return {
    lockCount: locks.length,
    fill,
    rfq: { ...rfq, beat },
    typicalBeat: typicalBeatText(beat),
    typicalBeatTitle: typicalBeatTitle(beat),
    settlement,
    settlementText: settlementSummaryText(settlement),
  };
}

export function sortLockTapes(tapes = []) {
  return [...(tapes || [])].sort((a, b) => {
    if (a.living !== b.living) return a.living ? -1 : 1;
    return tsMs(b.parlay && b.parlay.created_at) - tsMs(a.parlay && a.parlay.created_at);
  });
}
