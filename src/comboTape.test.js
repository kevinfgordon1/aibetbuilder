import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tapeYesPrice,
  ourNoBid,
  impliedYes,
  americanFromProb,
  americanFromNo,
  formatAmerican,
  formatParlayAmerican,
  outbidDelta,
  beatFromOutcome,
  formatBeat,
  formatBeatTitle,
  isLiveQuotingTs,
  liveFilledContracts,
  classifyMiss,
  buildRfqRow,
  mean,
  median,
  beatStats,
  summarizeRows,
  tapeWatcherState,
  typicalBeatText,
  typicalBeatTitle,
  buildLockTape,
  buildTapeSummary,
  sortLockTapes,
  isQuotingParlay,
  hasQuotingParlays,
  isSkipStatus,
  skipTapeSource,
  skipFillState,
  formatSkipReason,
  skipFillSummary,
  skipLockLine,
  lockSettlement,
  settlementTally,
  settlementSummaryText,
} from "./comboTape.js";
import { settlementCopy, settlementFromStored } from "./comboSettlement.js";

// ── American from YES price (combo-worker tape.test.js fixtures) ──
assert.equal(americanFromProb(0.08), 1150);
assert.equal(americanFromProb(0.2), 400);
assert.equal(americanFromProb(0.23), 335);
assert.equal(americanFromProb(0.6), -150);
assert.equal(americanFromProb(0), null);
assert.equal(americanFromProb(1), null);
assert.equal(formatAmerican(1150), "+1150");
assert.equal(formatAmerican(-150), "-150");
assert.equal(impliedYes(0.8), 0.2);
assert.equal(impliedYes(0.77), 0.23);

// Stored NO → YES (1 − NO) → American of the parlay / YES side.
assert.equal(americanFromNo(0.90), 900);
assert.equal(formatParlayAmerican({ no: 0.90 }), "+900");
assert.equal(impliedYes(0.92), 0.08);
assert.equal(americanFromNo(0.92), 1150);
assert.equal(formatParlayAmerican({ no: 0.92 }), "+1150");
assert.equal(formatParlayAmerican({ yes: 0.08 }), "+1150");
assert.equal(formatParlayAmerican({ no: 0.92, yes: 0.08 }), "+1150");
assert.equal(formatParlayAmerican({}), null);

// ── our quote prefers the sent NO bid ──
assert.equal(ourNoBid({ submitted_no_bid: 0.77, no_bid: 0.8 }), 0.77);
assert.equal(ourNoBid({ no_bid: "0.91" }), 0.91);
assert.equal(ourNoBid({}), null);

// ── tape YES: column or raw.tape fallback ──
assert.equal(tapeYesPrice({ tape_yes_price: 0.2 }), 0.2);
assert.equal(tapeYesPrice({ raw: { tape: { yes_price: 0.08 } } }), 0.08);
assert.equal(tapeYesPrice({ raw: { tape: { yesPrice: 0.1 } } }), 0.1);
assert.equal(tapeYesPrice({}), null);

// ── outbid delta: they paid more for NO ──
assert.equal(outbidDelta(0.77, 0.8), 0.03);
assert.equal(outbidDelta(0.91, 0.92), 0.01);
assert.equal(outbidDelta(0.8, 0.8), 0);
assert.equal(outbidDelta(null, 0.8), null);

// ── beat: tape present → cents + YES American both sides ──
{
  const beat = beatFromOutcome({
    submitted_no_bid: 0.77,
    tape_no_price: 0.8,
    tape_yes_price: 0.2,
    tape_match: "matched",
  });
  assert.equal(beat.known, true);
  assert.equal(beat.dollars, 0.03);
  assert.equal(beat.cents, 3);
  assert.equal(beat.ourAmerican, 335);
  assert.equal(beat.theirAmerican, 400);
  assert.equal(formatBeat(beat), "we +335 they +400");
  assert.equal(formatBeatTitle(beat), "outbid 3¢");
}
{
  const beat = beatFromOutcome({
    submitted_no_bid: 0.91,
    tape_no_price: 0.92,
    tape_match: "matched",
  });
  assert.equal(beat.known, true);
  assert.equal(beat.cents, 1);
  assert.equal(beat.theirAmerican, 1150);
  assert.equal(formatBeat(beat), "we +1011 they +1150");
  assert.equal(formatBeatTitle(beat), "outbid 1¢");
}

{
  const beat = beatFromOutcome({
    submitted_no_bid: 0.92,
    tape_no_price: 0.90,
    tape_match: "matched",
  });
  assert.equal(beat.ourAmerican, 1150);
  assert.equal(beat.theirAmerican, 900);
  assert.equal(formatBeat(beat), "we +1150 they +900");
  assert.equal(formatParlayAmerican({ no: beat.ourNo }), "+1150");
  assert.equal(formatParlayAmerican({ no: beat.theirNo }), "+900");
}

// ── no tape → do not invent a beat amount ──
{
  const beat = beatFromOutcome({ submitted_no_bid: 0.77, loss_reason: "outbid", tape_match: "none" });
  assert.equal(beat.known, false);
  assert.equal(beat.cents, null);
  assert.equal(beat.theirAmerican, null);
  assert.equal(formatBeat(beat), null);
}
assert.equal(formatBeat(null), null);
assert.equal(formatBeatTitle(null), null);

// ── kickoff cutoff: after starts_at is not live quoting ──
assert.equal(isLiveQuotingTs("2026-08-22T22:00:00Z", "2026-08-22T23:10:00Z"), true);
assert.equal(isLiveQuotingTs("2026-08-22T23:10:00Z", "2026-08-22T23:10:00Z"), false);
assert.equal(isLiveQuotingTs("2026-08-22T23:11:00Z", "2026-08-22T23:10:00Z"), false);
assert.equal(isLiveQuotingTs("2026-08-22T23:11:00Z", null), true);
assert.equal(isLiveQuotingTs(null, "2026-08-22T23:10:00Z"), true);

{
  const fills = [
    { count: 40, kalshi_created_time: "2026-08-22T22:00:00Z" },
    { count: 100, kalshi_created_time: "2026-08-22T23:30:00Z" },
    { count: 7, recorded_at: "2026-08-22T21:00:00Z" },
  ];
  assert.equal(liveFilledContracts(fills, "2026-08-22T23:10:00Z"), 47);
  assert.equal(liveFilledContracts(fills, null), 147);
}

// ── miss classification ──
{
  const oversized = classifyMiss({
    match: { contracts: 250 },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(oversized.bucket, "oversized");
  assert.equal(oversized.missed, true);
  assert.equal(oversized.reason, "oversized");
  assert.equal(oversized.skipFill, "unknown");
}
{
  const skipped = classifyMiss({
    match: { contracts: 10 },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(skipped.bucket, "skipped");
  assert.equal(skipped.reason, "skipped");
  assert.equal(skipped.skipFill, "unknown");
}
{
  const outbid = classifyMiss({
    match: { rfq_id: "r1", contracts: 20 },
    outcome: {
      outcome: "lost",
      loss_reason: "outbid",
      submitted_no_bid: 0.77,
      tape_no_price: 0.8,
      tape_yes_price: 0.2,
      tape_match: "matched",
    },
  });
  assert.equal(outbid.bucket, "outbid");
  assert.equal(outbid.tape, true);
  assert.equal(outbid.beat.cents, 3);
}
{
  const noTape = classifyMiss({
    outcome: { outcome: "lost", loss_reason: "outbid", submitted_no_bid: 0.9, tape_match: "none" },
  });
  assert.equal(noTape.bucket, "outbid");
  assert.equal(noTape.tape, false);
  assert.equal(noTape.beat.known, false);
}
{
  const noTaker = classifyMiss({
    outcome: { outcome: "lost", loss_reason: "no_purchase" },
  });
  assert.equal(noTaker.bucket, "no_taker");
}
{
  const inferred = classifyMiss({
    outcome: {
      outcome: "lost",
      loss_reason: "no_purchase",
      submitted_no_bid: 0.77,
      tape_no_price: 0.8,
      tape_match: "matched",
    },
  });
  assert.equal(inferred.bucket, "outbid");
  assert.equal(inferred.beat.cents, 3);
}
assert.equal(classifyMiss({ outcome: { outcome: "lost", loss_reason: "too_slow" } }).bucket, "too_slow");
assert.equal(classifyMiss({ outcome: { outcome: "lost", loss_reason: "no_taker" } }).bucket, "no_taker");
assert.equal(classifyMiss({ outcome: { outcome: "lost" } }).bucket, "lost");
assert.equal(classifyMiss({ outcome: { outcome: "executed" } }).bucket, "filled");
assert.equal(classifyMiss({ outcome: { outcome: "posted" } }).bucket, "awaiting");

// ── RFQ row respects kickoff ──
{
  const live = buildRfqRow({
    match: { rfq_id: "a", matched_at: "2026-08-22T22:00:00Z", contracts: 12 },
    startsAt: "2026-08-22T23:10:00Z",
  });
  const late = buildRfqRow({
    match: { rfq_id: "b", matched_at: "2026-08-22T23:20:00Z", contracts: 12 },
    startsAt: "2026-08-22T23:10:00Z",
  });
  assert.equal(live.live, true);
  assert.equal(late.live, false);
  assert.equal(live.bucket, "skipped");
}

// ── mean / median / beat stats ──
assert.equal(mean([1, 2, 3]), 2);
assert.equal(median([1, 3, 2]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);
{
  const stats = beatStats([
    { known: true, cents: 3, ourAmerican: 335, theirAmerican: 400 },
    { known: true, cents: 1, ourAmerican: 1011, theirAmerican: 1150 },
    { known: false, cents: null },
  ]);
  assert.equal(stats.n, 2);
  assert.equal(stats.avgCents, 2);
  assert.equal(stats.medCents, 2);
  assert.equal(stats.avgAmericanGap, 102);
  assert.equal(stats.avgOurAmerican, 673);
  assert.equal(stats.avgTheirAmerican, 775);
  assert.equal(typicalBeatText(stats), "we +673 they +775");
  assert.match(typicalBeatTitle(stats), /2¢/);
}
assert.equal(typicalBeatText({ n: 0 }), null);

assert.equal(tapeWatcherState([]).key, "off");
assert.equal(tapeWatcherState([{ tape_match: "none" }]).label, "no tape · watcher off");
assert.equal(tapeWatcherState([{ tape_no_price: 0.8, tape_match: "matched" }]).key, "on");

// ── full lock: fill closeness + miss breakdown + tape beat ──
{
  const tape = buildLockTape({
    parlay: {
      id: "p1",
      active: true,
      max_contracts: 100,
      fill_american: 1600,
      fair_american: 1400,
      starts_at: "2026-08-22T23:10:00Z",
      created_at: "2026-08-22T18:00:00Z",
    },
    fills: [
      { parlay_id: "p1", count: 40, kalshi_created_time: "2026-08-22T20:00:00Z" },
      { parlay_id: "p1", count: 25, kalshi_created_time: "2026-08-22T23:40:00Z" },
    ],
    matches: [
      { rfq_id: "fill-1", matched_at: "2026-08-22T20:00:00Z", contracts: 40 },
      { rfq_id: "lost-1", matched_at: "2026-08-22T21:00:00Z", contracts: 20 },
      { rfq_id: "skip-1", matched_at: "2026-08-22T21:30:00Z", contracts: 80 },
      { rfq_id: "slow-1", matched_at: "2026-08-22T22:00:00Z", contracts: 8 },
      { rfq_id: "late-1", matched_at: "2026-08-22T23:30:00Z", contracts: 10 },
    ],
    outcomes: [
      { rfq_id: "fill-1", parlay_id: "p1", outcome: "executed", submitted_no_bid: 0.94 },
      {
        rfq_id: "lost-1",
        parlay_id: "p1",
        outcome: "lost",
        loss_reason: "outbid",
        submitted_no_bid: 0.77,
        tape_no_price: 0.8,
        tape_yes_price: 0.2,
        tape_match: "matched",
        posted_at: "2026-08-22T21:00:10Z",
      },
      { rfq_id: "slow-1", parlay_id: "p1", outcome: "lost", loss_reason: "too_slow", posted_at: "2026-08-22T22:00:10Z" },
    ],
    outcomeByRfq: {
      "fill-1": { outcome: "executed", submitted_no_bid: 0.94 },
      "lost-1": {
        outcome: "lost",
        loss_reason: "outbid",
        submitted_no_bid: 0.77,
        tape_no_price: 0.8,
        tape_yes_price: 0.2,
        tape_match: "matched",
      },
      "slow-1": { outcome: "lost", loss_reason: "too_slow" },
    },
  });
  assert.equal(tape.fill.filled, 40);
  assert.equal(tape.fill.left, 60);
  assert.equal(tape.afterKickoff, 1);
  assert.equal(tape.live.matched, 4);
  assert.equal(tape.live.filled, 1);
  assert.equal(tape.live.lost, 2);
  assert.equal(tape.live.skipped, 1);
  assert.equal(tape.live.skippedUnknown, 1);
  assert.equal(tape.live.skippedFilled, 0);
  assert.equal(tape.live.outbid, 1);
  assert.equal(tape.live.too_slow, 1);
  assert.equal(tape.live.oversized, 1);
  assert.equal(tape.live.tapedOutbid, 1);
  assert.equal(tape.live.beat.avgCents, 3);
  assert.equal(tape.typicalBeat, "we +335 they +400");
  assert.match(tape.typicalBeatTitle, /3¢/);
  assert.equal(tape.rows.some((r) => r.rfqId === "late-1"), false);
}

{
  const empty = buildLockTape({
    parlay: { id: "p2", active: true, max_contracts: 50, archived_at: null },
    matches: [{ rfq_id: "x", matched_at: "2026-08-22T12:00:00Z", contracts: 12 }],
    outcomeByRfq: { x: { outcome: "lost", loss_reason: "outbid", submitted_no_bid: 0.9 } },
  });
  assert.equal(empty.live.outbid, 1);
  assert.equal(empty.live.tapedOutbid, 0);
  assert.equal(empty.typicalBeat, null);
}

// ── summary: active vs all; archived stays available ──
{
  const active = buildLockTape({
    parlay: { id: "a", active: true, max_contracts: 100, created_at: "2026-08-22T18:00:00Z" },
    fills: [{ count: 10, kalshi_created_time: "2026-08-22T19:00:00Z" }],
    matches: [{ rfq_id: "m1", matched_at: "2026-08-22T19:00:00Z", contracts: 10 }],
    outcomeByRfq: { m1: { outcome: "executed" } },
  });
  const archived = buildLockTape({
    parlay: { id: "b", active: false, archived_at: "2026-08-21T04:00:00Z", max_contracts: 80, created_at: "2026-08-21T12:00:00Z" },
    fills: [{ count: 20, kalshi_created_time: "2026-08-21T13:00:00Z" }],
    matches: [{ rfq_id: "m2", matched_at: "2026-08-21T13:00:00Z", contracts: 20 }],
    outcomeByRfq: {
      m2: {
        outcome: "lost",
        loss_reason: "outbid",
        submitted_no_bid: 0.77,
        tape_no_price: 0.8,
        tape_yes_price: 0.2,
      },
    },
  });
  const ordered = sortLockTapes([archived, active]);
  assert.equal(ordered[0].parlay.id, "a");
  const onlyActive = buildTapeSummary([active, archived], { scope: "active" });
  assert.equal(onlyActive.lockCount, 1);
  assert.equal(onlyActive.fill.filled, 10);
  assert.equal(onlyActive.rfq.filled, 1);
  const all = buildTapeSummary([active, archived], { scope: "all" });
  assert.equal(all.lockCount, 2);
  assert.equal(all.fill.filled, 30);
  assert.equal(all.rfq.outbid, 1);
  assert.equal(all.rfq.tapedOutbid, 1);
  assert.equal(all.typicalBeat, "we +335 they +400");
  assert.match(all.typicalBeatTitle, /3¢/);
}

{
  const s = summarizeRows([
    { bucket: "filled", missed: false },
    { bucket: "outbid", missed: true, beat: { known: false } },
    { bucket: "oversized", missed: true, skipFill: "unknown" },
    { bucket: "no_taker", missed: true },
  ]);
  assert.equal(s.matched, 4);
  assert.equal(s.filled, 1);
  assert.equal(s.lost, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.skippedUnknown, 1);
  assert.equal(s.skippedFilled, 0);
  assert.equal(s.missed, 3);
  assert.equal(s.quoted, 3);
}

// ── skip vs skip-then-filled vs skip-unknown ──
assert.equal(isSkipStatus("declined"), true);
assert.equal(isSkipStatus("limitreached"), true);
assert.equal(isSkipStatus("limit_reached"), true);
assert.equal(isSkipStatus("filled"), false);
assert.equal(skipFillState(null), "unknown");
assert.equal(skipFillState({}), "unknown");
assert.equal(skipFillState({ tape_match: "matched", tape_no_price: 0.8 }), "filled");
assert.equal(skipFillState({ tape_match: "none" }), "none");
assert.equal(skipFillState({ tape_match: "ambiguous" }), "unknown");
assert.equal(skipFillState({ tape_no_price: 0.8 }), "unknown");

{
  const fromMatch = skipTapeSource({ tape_match: "matched", tape_no_price: 0.81 }, { status: "declined" });
  assert.equal(tapeYesPrice({ tape_yes_price: 0.19 }), 0.19);
  assert.equal(fromMatch.tape_match, "matched");
  const fromSub = skipTapeSource({ contracts: 80 }, { status: "declined", tape_match: "none" });
  assert.equal(fromSub.tape_match, "none");
}

{
  const unknown = classifyMiss({ match: { rfq_id: "s1", contracts: 80 }, filled: 40, ceiling: 100 });
  assert.equal(unknown.bucket, "oversized");
  assert.equal(unknown.skipFill, "unknown");
  assert.equal(formatSkipReason(unknown), "skipped oversized 80 (need ≤60)");
  assert.doesNotMatch(formatSkipReason(unknown), /unfilled/);
}
{
  const later = classifyMiss({
    match: { rfq_id: "s2", contracts: 80, tape_match: "matched", tape_no_price: 0.8, tape_yes_price: 0.2 },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(later.skipFill, "filled");
  assert.equal(formatSkipReason(later), "skipped, later filled +400");
  const row = buildRfqRow({
    match: { rfq_id: "s2", matched_at: "2026-08-22T21:00:00Z", contracts: 80, tape_match: "matched", tape_no_price: 0.8 },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(row.skipFill, "filled");
  assert.equal(row.tapeNo, 0.8);
  assert.equal(formatParlayAmerican({ no: row.tapeNo }), "+400");
  assert.equal(formatSkipReason(row), "skipped, later filled +400");
}
{
  const fromDeclined = classifyMiss({
    match: { rfq_id: "s3", contracts: 12 },
    submission: { rfq_id: "s3", status: "declined", tape_match: "matched", tape_no_price: 0.91 },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(fromDeclined.bucket, "skipped");
  assert.equal(fromDeclined.skipFill, "filled");
  assert.equal(formatSkipReason(fromDeclined), "skipped, later filled +1011");
}
{
  const none = classifyMiss({
    match: { rfq_id: "s4", contracts: 12, tape_match: "none" },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(none.skipFill, "none");
  assert.match(formatSkipReason(none), /no print/);
  assert.doesNotMatch(formatSkipReason(none), /unfilled/);
}

{
  const tape = buildLockTape({
    parlay: { id: "p-skip", active: true, max_contracts: 100 },
    matches: [
      { rfq_id: "unk", matched_at: "2026-08-22T20:00:00Z", contracts: 12 },
      { rfq_id: "filled-later", matched_at: "2026-08-22T20:10:00Z", contracts: 80 },
      { rfq_id: "noprint", matched_at: "2026-08-22T20:20:00Z", contracts: 9 },
    ],
    submissions: [
      { rfq_id: "filled-later", parlay_id: "p-skip", status: "declined", tape_match: "matched", tape_no_price: 0.8, tape_yes_price: 0.2 },
      { rfq_id: "noprint", parlay_id: "p-skip", status: "limitreached", tape_match: "none" },
      { rfq_id: "orphan-skip", parlay_id: "p-skip", status: "declined", contracts: 15, created_at: "2026-08-22T20:30:00Z" },
    ],
  });
  assert.equal(tape.live.skipped, 4);
  assert.equal(tape.live.skippedFilled, 1);
  assert.equal(tape.live.skippedNone, 1);
  assert.equal(tape.live.skippedUnknown, 2);
  const later = tape.rows.find((r) => r.rfqId === "filled-later");
  assert.equal(later.skipFill, "filled");
  assert.equal(later.tapeNo, 0.8);
  assert.equal(formatParlayAmerican({ no: later.tapeNo }), "+400");
  assert.equal(formatSkipReason(later), "skipped, later filled +400");
  const unknown = tape.rows.find((r) => r.rfqId === "unk");
  assert.equal(unknown.skipFill, "unknown");
  assert.doesNotMatch(formatSkipReason(unknown), /unfilled/);
  assert.equal(tape.rows.some((r) => r.rfqId === "orphan-skip"), true);
}

{
  const sum = skipFillSummary({ skipped: 3, skippedFilled: 0, skippedNone: 0, skippedUnknown: 3 });
  assert.equal(sum.n, 3);
  assert.match(sum.sub, /later filled unknown/);
  assert.doesNotMatch(sum.sub, /unfilled/);
  const known = skipFillSummary({ skipped: 4, skippedFilled: 2, skippedNone: 1, skippedUnknown: 1 });
  assert.equal(known.sub, "of those, later filled 2 · 1 unknown · 1 no print");
  assert.equal(skipLockLine({ skipped: 3, skippedFilled: 0, skippedNone: 0, skippedUnknown: 3 }), "3 skipped · later filled unknown");
  assert.equal(skipLockLine({ skipped: 4, skippedFilled: 2, skippedNone: 1, skippedUnknown: 1 }), "4 skipped · later filled 2 · 1 unknown · 1 no print");
  assert.equal(skipLockLine({ skipped: 0 }), null);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.match(locks, /DeskChips/);
  assert.match(locks, /FillProgress/);
  assert.match(locks, /buildParlayDesk/);
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /Miss tape/);
  assert.match(app, /<ComboTape /);
  const tapeUi = fs.readFileSync(path.join(dir, "ComboTape.jsx"), "utf8");
  assert.doesNotMatch(tapeUi, /fetchPages/);
  assert.doesNotMatch(tapeUi, /\.range\(/);
  assert.match(tapeUi, /limit\(MATCH_LIMIT\)/);
  assert.match(tapeUi, /limit\(OUTCOME_LIMIT\)/);
  assert.match(tapeUi, /const MATCH_LIMIT = 400/);
  assert.match(tapeUi, /const OUTCOME_LIMIT = 200/);
  assert.match(tapeUi, /const SKIP_LIMIT = 400/);
  assert.match(tapeUi, /limit\(SKIP_LIMIT\)/);
  assert.match(tapeUi, /k="Skipped"/);
  assert.match(tapeUi, /skipFillSummary/);
  assert.match(tapeUi, /skipLockLine/);
  assert.match(tapeUi, /skipped, later filled|formatSkipReason/);
  assert.match(tapeUi, /formatParlayAmerican/);
  assert.match(tapeUi, /formatParlayAmerican\(\{ no: r\.ourNo \}\)/);
  assert.match(tapeUi, /formatParlayAmerican\(\{ no: r\.tapeNo, yes: r\.tapeYes \}\)/);
  assert.match(tapeUi, /formatBeatTitle/);
  assert.doesNotMatch(tapeUi, /r\.ourNo != null \? `NO \$\{Number\(r\.ourNo\)/);
  assert.doesNotMatch(tapeUi, /formatCents\(r\.tapeNo\)\s*:[^?]*no tape/);
  assert.doesNotMatch(tapeUi, /unfilled/);
  assert.match(tapeUi, /if \(!poll\) return undefined/);
  assert.match(tapeUi, /reload\("tick"\)/);
  assert.match(tapeUi, /hasQuotingParlays/);
  assert.doesNotMatch(tapeUi, /setInterval\(\(\) => \{ reload\(\); \}/);
  assert.match(tapeUi, /user\.id/);
  assert.match(tapeUi, /select\("id,active,archived_at"\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(tapeUi, /from\("combo_parlays"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.is\("archived_at"/);
  assert.match(tapeUi, /from\("combo_parlays"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.not\("archived_at"/);
  assert.match(tapeUi, /from\("combo_submissions"\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(tapeUi, /from\("combo_fills"\)[\s\S]*?\.in\("parlay_id"/);
  assert.match(tapeUi, /from\("combo_matches"\)[\s\S]*?\.in\("parlay_id"/);
  assert.match(tapeUi, /from\("quote_outcomes"\)[\s\S]*?\.in\("parlay_id"/);
  assert.match(locks, /from\("combo_parlays"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.is\("archived_at"/);
  assert.match(locks, /from\("combo_parlays"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.not\("archived_at"/);
  assert.doesNotMatch(locks, /skipFill|later filled/);
  assert.match(tapeUi, /settlementFromStored/);
  assert.match(tapeUi, /parlay won \(we lost\)|settlement\.text/);
  assert.match(tapeUi, /pending/);
  assert.match(tapeUi, /settlementText/);
  assert.doesNotMatch(tapeUi, /score|finalized from start|kickoff settled/i);
  assert.doesNotMatch(tapeUi, /kalshi-games/);
  assert.doesNotMatch(tapeUi, /refreshSettlements/);
  assert.match(locks, /settlementFromStored/);
  assert.match(locks, /parlay won \(we lost\)/);
  assert.match(locks, /parlay lost \(we won\)/);
}

// ── official Kalshi settlement on Miss tape (same copy as Combo Locks) ──
{
  const yes = lockSettlement({ kalshi_result: "yes" });
  assert.equal(yes.text, "parlay won (we lost)");
  assert.equal(yes.weWon, false);
  assert.deepEqual(yes, settlementCopy("yes"));
  assert.deepEqual(yes, settlementFromStored({ kalshi_result: "yes" }));
}
{
  const no = lockSettlement({ kalshi_result: "no" });
  assert.equal(no.text, "parlay lost (we won)");
  assert.equal(no.weWon, true);
  assert.deepEqual(no, settlementCopy("no"));
  assert.deepEqual(no, settlementFromStored({ kalshi_result: "no" }));
}
{
  const missing = lockSettlement({ kalshi_result: null, starts_at: "2020-01-01T00:00:00Z" });
  assert.equal(missing, null);
  assert.equal(lockSettlement({}), null);
  assert.equal(lockSettlement({ kalshi_result: "scalar" }), null);
  assert.equal(settlementFromStored({ kalshi_result: null }), null);
}

{
  const yesTape = buildLockTape({
    parlay: { id: "won", kalshi_result: "yes", max_contracts: 10, created_at: "2026-08-22T18:00:00Z" },
  });
  const noTape = buildLockTape({
    parlay: { id: "lost", kalshi_result: "NO", max_contracts: 10, created_at: "2026-08-22T18:00:00Z" },
  });
  const pendingTape = buildLockTape({
    parlay: {
      id: "open",
      kalshi_result: null,
      starts_at: "2020-01-01T00:00:00Z",
      max_contracts: 10,
      created_at: "2026-08-22T18:00:00Z",
    },
  });
  assert.equal(yesTape.settlement.text, "parlay won (we lost)");
  assert.equal(yesTape.settlement.weWon, false);
  assert.equal(noTape.settlement.text, "parlay lost (we won)");
  assert.equal(noTape.settlement.weWon, true);
  assert.equal(pendingTape.settlement, null);
  assert.notEqual(pendingTape.settlement && pendingTape.settlement.weWon, true);
  assert.notEqual(pendingTape.settlement && pendingTape.settlement.weWon, false);

  const tally = settlementTally([yesTape, noTape, pendingTape, yesTape]);
  assert.equal(tally.weWon, 1);
  assert.equal(tally.weLost, 2);
  assert.equal(tally.pending, 1);
  assert.equal(tally.settled, 3);
  assert.equal(settlementSummaryText(tally), "we won 1 · we lost 2");
  assert.equal(settlementSummaryText({ weWon: 0, weLost: 0, settled: 0 }), null);

  const summary = buildTapeSummary([yesTape, noTape, pendingTape], { scope: "all" });
  assert.equal(summary.settlement.weWon, 1);
  assert.equal(summary.settlement.weLost, 1);
  assert.equal(summary.settlement.pending, 1);
  assert.equal(summary.settlementText, "we won 1 · we lost 1");
}

assert.equal(isQuotingParlay({ active: true, archived_at: null }), true);
assert.equal(isQuotingParlay({ active: false, archived_at: null }), false);
assert.equal(isQuotingParlay({ active: true, archived_at: "2026-08-22T00:00:00Z" }), false);
assert.equal(isQuotingParlay({ archived_at: null }), true);
assert.equal(hasQuotingParlays([]), false);
assert.equal(hasQuotingParlays([{ active: false, archived_at: null }, { active: true, archived_at: "2026-08-21T00:00:00Z" }]), false);
assert.equal(hasQuotingParlays([{ active: true, archived_at: null }]), true);

console.log("comboTape.test.js ok");
