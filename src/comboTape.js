// Combo miss-tape analytics — beat/delta + miss classification over the same
// polls Combo Locks already uses (combo_parlays / combo_fills / combo_matches /
// quote_outcomes). Declined / limitreached combo_submissions are the worker's
// skip log. Does not invent tables or tape columns.
//
// Beat math matches combo-worker tape.js: theirNo − ourNo (positive = they paid
// more for NO, so the requester got a cheaper YES). YES American is converted
// from the NO price (1 − NO), never guessed when tape columns are empty.
// Miss labels reuse comboDesk skipLabel / tapeNoPrice / tapeMatch.
//
// Skip-then-filled is tape_match=matched on the skip row (match and/or declined
// submission). Those columns are not on main yet — missing tape is "unknown",
// not "unfilled". tape_match=none is the only leftover no-print / unfilled.

import {
  remainingFill,
  tapeNoPrice,
  tapeMatch,
  skipLabel,
  outcomesForParlay,
} from "./comboDesk.js";

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
  const am = we && they ? ` · we ${we} they ${they}` : "";
  const cents = `${Math.abs(beat.cents)}¢`;
  if (beat.dollars > 0) return `outbid ${cents}${am}`;
  if (beat.dollars < 0) return `we were longer ${cents}${am}`;
  return `same price${am}`;
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

export function formatSkipReason(row) {
  const skipText = (row && row.skip && row.skip.text)
    || (row && row.bucket === "oversized" ? "oversized" : "skipped");
  if (row && row.skipFill === "filled") return "skipped, later filled";
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

export function classifyMiss({ match, outcome, submission, filled = 0, ceiling = 0 } = {}) {
  if (outcome) {
    if (outcome.outcome === "executed" || outcome.outcome === "accepted" || outcome.fill_confirmed) {
      return { bucket: "filled", reason: "filled", missed: false };
    }
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
  const skipRow = match || submission;
  const skip = skipLabel(skipRow, { filled, ceiling, hedgeCap: ceiling });
  const tape = skipTapeSource(match, submission);
  const skipFill = skipFillState(tape);
  if (skip.kind === "oversized") {
    return { bucket: "oversized", reason: "oversized", missed: true, skip, skipFill, skipTape: tape };
  }
  return { bucket: "skipped", reason: "skipped", missed: true, skip, skipFill, skipTape: tape };
}

export function buildRfqRow({ match, outcome, submission, filled = 0, ceiling = 0, startsAt } = {}) {
  const at = rfqEventAt(match, outcome) || (submission && submission.created_at) || null;
  const cls = classifyMiss({ match, outcome, submission, filled, ceiling });
  const tapeRow = outcome || cls.skipTape || skipTapeSource(match, submission);
  return {
    rfqId: (match && match.rfq_id) || (outcome && outcome.rfq_id) || (submission && submission.rfq_id) || null,
    at,
    live: isLiveQuotingTs(at, startsAt),
    contracts: toNum((match && match.contracts) ?? (submission && submission.contracts)),
    ourNo: ourNoBid(outcome),
    tapeNo: tapeNoPrice(tapeRow),
    tapeYes: tapeYesPrice(tapeRow),
    outcome,
    submission,
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
    return { n: 0, avgCents: null, medCents: null, avgAmericanGap: null, medAmericanGap: null };
  }
  const cents = known.map((b) => b.cents);
  const gaps = known
    .filter((b) => b.ourAmerican != null && b.theirAmerican != null)
    .map((b) => b.theirAmerican - b.ourAmerican);
  return {
    n: known.length,
    avgCents: Math.round(mean(cents)),
    medCents: Math.round(median(cents)),
    avgAmericanGap: gaps.length ? Math.round(mean(gaps)) : null,
    medAmericanGap: gaps.length ? Math.round(median(gaps)) : null,
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
  const avgAm = formatAmerican(stats.avgAmericanGap);
  const medAm = formatAmerican(stats.medAmericanGap);
  const am = avgAm != null && medAm != null
    ? ` · American gap avg ${avgAm} / med ${medAm}`
    : "";
  return `avg ${stats.avgCents}¢ / med ${stats.medCents}¢${am}`;
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
  const bySkip = { ...submissionByRfq };
  (submissions || []).forEach((s) => {
    if (s && s.rfq_id && !bySkip[s.rfq_id]) bySkip[s.rfq_id] = s;
  });

  const rows = (matches || []).map((m) => buildRfqRow({
    match: m,
    outcome: m && m.rfq_id ? byRfq[m.rfq_id] : null,
    submission: m && m.rfq_id ? bySkip[m.rfq_id] : null,
    filled: fill.filled,
    ceiling,
    startsAt,
  }));
  const used = new Set(rows.map((r) => r.rfqId).filter(Boolean));
  for (const s of submissions || []) {
    if (!s || !isSkipStatus(s.status)) continue;
    if (!parlay || s.parlay_id !== parlay.id) continue;
    if (s.rfq_id && (used.has(s.rfq_id) || byRfq[s.rfq_id])) continue;
    rows.push(buildRfqRow({
      match: {
        rfq_id: s.rfq_id,
        contracts: s.contracts,
        matched_at: s.created_at,
        parlay_id: s.parlay_id,
      },
      outcome: s.rfq_id ? byRfq[s.rfq_id] : null,
      submission: s,
      filled: fill.filled,
      ceiling,
      startsAt,
    }));
    if (s.rfq_id) used.add(s.rfq_id);
  }

  const liveRows = rows.filter((r) => r.live);
  const todayRows = liveRows.filter((r) => isSameLocalDay(r.at, now));
  const live = summarizeRows(liveRows);
  const today = summarizeRows(todayRows);

  return {
    parlay,
    fill,
    archived: !!(parlay && parlay.archived_at),
    living: !!(parlay && !parlay.archived_at),
    startsAt,
    rows: liveRows,
    afterKickoff: rows.length - liveRows.length,
    live,
    today,
    typicalBeat: typicalBeatText(live.beat),
    todayBeat: typicalBeatText(today.beat),
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
  return {
    lockCount: locks.length,
    fill,
    rfq: { ...rfq, beat },
    typicalBeat: typicalBeatText(beat),
  };
}

export function sortLockTapes(tapes = []) {
  return [...(tapes || [])].sort((a, b) => {
    if (a.living !== b.living) return a.living ? -1 : 1;
    return tsMs(b.parlay && b.parlay.created_at) - tsMs(a.parlay && a.parlay.created_at);
  });
}
