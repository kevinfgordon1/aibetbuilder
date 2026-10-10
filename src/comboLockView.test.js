import assert from "node:assert/strict";
import {
  fmtAmerican, americanFromNoPrice, dollars, signedDollars, etDateTime, etDay, etStamp,
  plainLeg, lockTitle, lockStatus, betSummary, lockMetaLine, profitLine, cardOutcomeTiles, plainAttemptLabel,
  historyResult, historyTotals, historyRow, lockSports, plainOutcomeText,
  fairOdds, quoteRow, quoteHistory, QUOTE_ROWS_SHOWN,
} from "./comboLockView.js";
import { buildLockAttempts } from "./comboLockHistory.js";

assert.equal(fmtAmerican(1300), "+1300");
assert.equal(fmtAmerican(-110), "-110");
assert.equal(fmtAmerican(null), "—");
// NO 92¢ -> buyer pays 8¢ for YES -> +1150. Cents and dollars both work.
assert.equal(americanFromNoPrice(0.92), 1150);
assert.equal(americanFromNoPrice(92), 1150);
assert.equal(americanFromNoPrice(0.4), -150);
assert.equal(americanFromNoPrice(null), null);
assert.equal(dollars(1025), "$1,025");
assert.equal(dollars(23.214), "$23.21");
assert.equal(signedDollars(-50), "-$50.00");
assert.equal(signedDollars(1234.5), "+$1,234.50");

// ET formatting regardless of the machine zone.
assert.equal(etDateTime("2026-10-12T17:00:00Z"), "Mon, Oct 12 · 1:00 PM ET");
assert.equal(etDay("2026-10-06T02:30:00Z"), "Oct 5");
assert.equal(etStamp("2026-10-07T22:41:00Z"), "Oct 7, 6:41 PM ET");
assert.equal(etDateTime(null), "");

// Legs in plain words, never tickers.
const side = { ticker: "KXNFLGAME-26OCT12BUFNYJ-BUF", side: "yes", label: "Buffalo", type: "side", game: "Buffalo vs New York J" };
const spread = { ticker: "KXNFLSPREAD-26OCT12KCLV-KC3", side: "yes", label: "Kansas City −3.5", type: "spread" };
const total = { ticker: "KXNFLTOTAL-26OCT12KCLV-45", side: "yes", label: "Over 45.5", type: "total", game: "Kansas City vs Las Vegas" };
assert.equal(plainLeg(side).text, "Buffalo to win");
assert.equal(plainLeg(side).typeWord, "Moneyline");
assert.equal(plainLeg(spread).text, "Kansas City −3.5");
assert.equal(plainLeg(total).game, "Kansas City vs Las Vegas");
assert.equal(plainLeg({ ticker: "KXMLBHR-26OCT04NYYTOR-AJUDGE99", label: "Aaron Judge: 1+", type: "prop" }).text, "Aaron Judge to hit a home run");
assert.equal(plainLeg({ ticker: "KXNFLANYTD-26OCT12DETTB-JGIBBS26", label: "Jahmyr Gibbs: 1+", type: "prop" }).text, "Jahmyr Gibbs anytime TD");
assert.equal(plainLeg({ ticker: "KXNHLGOAL-26OCT10PITPHI-SC87", label: "Sidney Crosby: 1+", type: "prop" }).text, "Sidney Crosby to score a goal");
for (const l of [side, spread, total]) assert.ok(!/KX/.test(plainLeg(l).text));

const legs = [spread, total, side];
const auto = { label: "Kansas City −3.5 + Over 45.5 + Buffalo", legs };
assert.equal(lockTitle(auto), "Kansas City −3.5 + Over 45.5 + Buffalo to win");
assert.equal(lockTitle({ ...auto, label: "Free bet · Kansas City −3.5 + Over 45.5 + Buffalo", is_free_bet: true }), "Kansas City −3.5 + Over 45.5 + Buffalo to win");
assert.equal(lockTitle({ ...auto, label: "Sunday special" }), "Sunday special");
assert.deepEqual(lockSports(auto), ["NFL"]);

// Status: one per lock, priority paused > filled > stopped > off > partial > quoting.
const p = { max_contracts: 1000, active: true, paused: false };
assert.equal(lockStatus({ parlay: p }).label, "Quoting");
assert.equal(lockStatus({ parlay: p, filled: 200 }).label, "Partly filled");
assert.equal(lockStatus({ parlay: p, filled: 1000 }).label, "Filled");
assert.equal(lockStatus({ parlay: p, kill: true }).label, "Stopped");
assert.equal(lockStatus({ parlay: { ...p, active: false } }).label, "Off");
assert.equal(lockStatus({ parlay: { ...p, paused: true }, filled: 1000 }).label, "Paused");
assert.equal(lockStatus({ parlay: p, filled: 1000, kill: true }).label, "Filled");

// Bet summary + meta.
const bet = { parlay_stake: 50, parlay_american: 1950, fill_american: 1300, sportsbook: "DraftKings", boost_pct: 30, starts_at: "2026-10-12T17:00:00Z", legs };
const s = betSummary(bet);
assert.equal(s.betLine, "$50 at +1950");
assert.equal(s.maxPayout, 1025);
assert.equal(s.sellAt, "+1300");
assert.equal(lockMetaLine(bet), "NFL · Mon, Oct 12 · 1:00 PM ET · DraftKings · 30% boost");
const fb = betSummary({ ...bet, is_free_bet: true, parlay_stake: 25, parlay_american: 1600 });
assert.equal(fb.maxPayout, 400); // free bet pays profit only
assert.equal(fb.betLine, "Free bet $25 at +1600");

// Profit lines.
assert.deepEqual(profitLine({ filled: 0, current: { hit: 975, miss: -50 }, target: { hit: 23.21, miss: 23.21, locks: true }, remaining: 1025 }),
  { lead: "If fully hedged", text: "+$23.21 either way", tone: "pos" });
assert.equal(profitLine({ filled: 300, current: { hit: 10, miss: 12 }, target: { hit: 11, miss: 11, locks: true }, remaining: 0 }).lead, "Locked profit");
assert.equal(profitLine({ filled: 100, current: { hit: 500, miss: -20 }, target: { hit: 11, miss: 11, locks: true }, remaining: 300 }).text, "+$500.00 if it hits · -$20.00 if it misses");
assert.equal(profitLine(null), null);
// Card outcome tiles: now (actual fills) + at target fill (whole lock at the Selling at price).
{
  const unfilled = cardOutcomeTiles({ filled: 0, current: { hit: 975, miss: -50 }, target: { hit: 23.21, miss: 23.21, locks: true, contracts: 1025 }, remaining: 1025 });
  assert.deepEqual(unfilled.now, { lead: "Where you stand now", hit: "+$975.00", miss: "-$50.00", hitTone: "pos", missTone: "neg", either: false });
  assert.deepEqual(unfilled.target, { lead: "At target fill", hit: "+$23.21", miss: "+$23.21", hitTone: "pos", missTone: "pos", either: true, contracts: 1025, locks: true });
  const partial = cardOutcomeTiles({ filled: 100, current: { hit: 500, miss: -20 }, target: { hit: 11, miss: -3, locks: false, contracts: 400 }, remaining: 300 });
  assert.equal(partial.now.lead, "Where you stand now");
  assert.equal(partial.target.missTone, "neg");
  assert.equal(partial.target.locks, false);
  const full = cardOutcomeTiles({ filled: 400, current: { hit: 11, miss: 11 }, target: { hit: 11, miss: 11, locks: true, contracts: 400 }, remaining: 0 });
  assert.equal(full.now.lead, "Locked profit");
  assert.equal(full.now.either, true);
  assert.equal(cardOutcomeTiles({ filled: 0, current: { hit: 975, miss: -50 }, target: null, remaining: null, targetTbd: true }).target, null);
  assert.deepEqual(cardOutcomeTiles(null), { now: null, target: null });
}

assert.equal(plainAttemptLabel("skipped · over_limit"), "skipped · too big for this lock");
assert.equal(plainAttemptLabel("unfilled · outbid"), "not taken · outbid");
assert.equal(plainAttemptLabel("matched 3 RFQs"), "matched 3 requests");
assert.equal(plainAttemptLabel("outbid at 92¢"), "outbid at +1150");

assert.equal(plainOutcomeText("parlay lost (we won)"), "Parlay missed");
assert.equal(plainOutcomeText("parlay won (we lost)"), "Parlay hit");
assert.equal(plainOutcomeText("risk won"), "Parlay hit");
assert.equal(plainOutcomeText("awaiting settlement"), "Waiting on Kalshi");
// History.
assert.deepEqual(historyResult({ settled: true, side: "miss", pnl: 14.2 }), { text: "Parlay missed", tone: "win" });
assert.deepEqual(historyResult({ settled: true, side: "hit", pnl: -3 }), { text: "Parlay hit", tone: "lose" });
assert.equal(historyResult({ settled: false, resultKind: "awaiting" }).text, "Waiting on Kalshi");
assert.equal(historyResult({ settled: false, resultKind: "pending" }).text, "Waiting on games");
const totals = historyTotals([
  { settled: true, pnl: 10, filled: 5 }, { settled: true, pnl: -4, filled: 5 }, { settled: true, pnl: 30, filled: 0 }, { settled: false, pnl: null },
]);
assert.deepEqual(totals, { net: 36, wins: 2, losses: 1, settled: 3, pending: 1, hedgedPnl: 6, hedgedN: 2, openPnl: 30, openN: 1 });
const row = historyRow({ id: "x", settled: true, side: "miss", pnl: 14.2, filled: 600, createdAt: "2026-10-04T13:00:00Z" }, { ...bet, starts_at: "2026-10-05T20:25:00Z", label: auto.label });
assert.equal(row.date, "Oct 5");
assert.equal(row.title, "Kansas City −3.5 + Over 45.5 + Buffalo to win");
assert.equal(row.bet, "$50 at +1950");
assert.equal(row.soldAt, "+1300");
assert.equal(row.hedged, true);
assert.equal(row.result, "Parlay missed");

// Fair odds: the saved fair_american wins; else the legs' fair chances; else "—".
assert.deepEqual(fairOdds({ fair_american: 1250 }), { american: 1250, text: "+1250", source: "saved" });
assert.equal(fairOdds({ fair_american: null, legs: [{ label: "A" }] }).text, "—");
assert.equal(fairOdds({ fair_american: "", legs: [] }).source, null);
assert.deepEqual(fairOdds({ legs: [{ fair_prob: 0.5 }, { fair_american: 100 }] }), { american: 300, text: "+300", source: "legs" });
assert.equal(betSummary({ parlay_stake: 50, parlay_american: 1950, fair_american: 1250 }).fair.text, "+1250");
assert.equal(row.fair, "—");
assert.equal(historyRow({ id: "y" }, { fair_american: 760 }).fair, "+760");

// Quote history: filled first, then not filled, each row in plain words.
{
  const P = "p1";
  const parlay = { id: P, user_id: "u", active: true, archived_at: null, fill_american: 1300, max_contracts: 1025, starts_at: "2026-10-11T17:00:00Z", created_at: "2026-10-07T20:15:00Z", legs: [] };
  const sub = (id, status, contracts, at, extra = {}) => ({ id, user_id: "u", parlay_id: P, status, contracts, created_at: at, rfq_id: "rfq-" + id, venue: "kalshi", is_live: true, ...extra });
  const attempts = buildLockAttempts({
    parlay,
    fills: [{ parlay_id: P, count: 250, order_id: "ord-1", fill_id: "f-1", kalshi_created_time: "2026-10-07T21:12:00Z", no_price: 0.93 }],
    submissions: [
      sub("s1", "filled", 400, "2026-10-07T21:12:00Z", { fill_american: 1300, order_id: "ord-1", worst_lock: 9.1 }),
      sub("s2", "quoted", 300, "2026-10-07T22:41:00Z", { fill_american: 1300, quote_id: "q2" }),
      sub("s3", "declined", 3000, "2026-10-07T21:05:00Z", { skip_reason: "over_limit" }),
      sub("s4", "declined", 200, "2026-10-07T20:50:00Z", { skip_reason: "game_started", venue: "polymarket" }),
    ],
    outcomes: [{ rfq_id: "rfq-s2", parlay_id: P, outcome: "lost", loss_reason: "outbid", submitted_no_bid: 0.92, tape_no_price: 0.93, responded_ms: 410, posted_at: "2026-10-07T22:41:00Z" }],
    now: Date.parse("2026-10-08T12:00:00Z"),
  });
  const qh = quoteHistory(attempts, { parlay, now: Date.parse("2026-10-08T12:00:00Z") });
  assert.equal(qh.filled.length, 1);
  assert.equal(qh.filled[0].result, "partly filled");
  assert.equal(qh.filled[0].detail, "250 of 400 asked · worst case +$9.10");
  assert.equal(qh.filled[0].price, "+1300");
  assert.equal(qh.filled[0].size, "250");
  assert.equal(qh.filled[0].venue, "Kalshi");
  assert.equal(qh.filled[0].time, "Oct 7, 5:12 PM ET");
  assert.equal(qh.filledContracts, 250);
  assert.deepEqual(qh.notFilled.map((q) => q.result), ["outbid", "over limit", "game already started"]);
  assert.equal(qh.notFilled[0].detail, "winning price +1329 · answered in 0.4s");
  assert.equal(qh.notFilled[1].price, "—");
  assert.equal(qh.notFilled[1].detail, "asked 3,000, room for 775");
  assert.equal(qh.notFilled[1].tone, "warn");
  assert.equal(qh.notFilled[2].venue, "Polymarket");
  assert.equal(qh.addedText, "Wed, Oct 7 · 4:15 PM ET");
  assert.ok(QUOTE_ROWS_SHOWN >= 3);
}
assert.equal(quoteRow({ bucket: "awaiting", reason: "open", at: null, contracts: 10 }, { ended: true }).result, "expired");
assert.equal(quoteRow({ bucket: "awaiting", reason: "open", contracts: 10 }).result, "offer resting · waiting");
assert.equal(quoteRow({ bucket: "too_slow", contracts: 10, ourNo: 0.92 }).price, "+1150");
assert.equal(quoteRow({ bucket: "no_taker", reason: "quoted · no take", contracts: 10 }).result, "not taken");
assert.equal(quoteRow({ bucket: "no_taker", reason: "cancelled", contracts: 10 }).result, "cancelled");
assert.equal(quoteRow({ bucket: "lost", outcome: { loss_reason: "expired" }, contracts: 10 }).result, "expired");
assert.deepEqual(quoteHistory(null), { filled: [], notFilled: [], filledContracts: 0, addedText: "", afterKickoff: 0 });

{
  const { setSeriesFee } = await import("./buyerOdds.js");
  setSeriesFee("KXMVECROSSCATEGORY0", "quadratic", 1); // Kenny's series: no maker fee
  const ob = quoteRow({ bucket: "no_taker", contracts: 12, submission: { skip_reason: "outbid", tape_yes_price: 0.078, fill_american: 1188, venue: "kalshi" } }, { ticker: "KXMVECROSSCATEGORY0-S2026A0E24EEACD4-D44B4A1E301" });
  assert.equal(ob.result, "Outbid by a better price");
  assert.match(ob.detail, /winner gave the buyer \+1104 after fees/);
  assert.equal(ob.buyerSees, "+1104");
  // Series not loaded → conservative 0.035 maker fee.
  assert.equal(quoteRow({ bucket: "no_taker", contracts: 12, submission: { fill_american: 1188 } }).buyerSees, "+1060");
  assert.equal(quoteRow({ bucket: "skipped", contracts: 12, submission: { skip_reason: "outbid", fill_american: 1188 } }).detail.startsWith("another maker won it"), true);
  assert.equal(quoteRow({ bucket: "no_taker", contracts: 12, submission: { skip_reason: "no_taker" } }).result, "Buyer walked away");
  assert.equal(quoteRow({ bucket: "no_taker", contracts: 12, submission: { skip_reason: "rfq_closed_live" } }).result, "Request closed");
  assert.equal(quoteRow({ bucket: "oversized", contracts: 126, submission: { skip_reason: "oversized" } }).result, "over limit");
}
console.log("comboLockView.test.js ok");

// Selling at tile: taker's odds after the 0.07·P·(1−P) taker fee.
{
  const { takerOddsAfterFee: t } = await import("./comboLockView.js");
  assert.equal(t(1188, "kalshi", "KXMVECROSSCATEGORY0-S2026A0E24EEACD4-D44B4A1E301").text, "+1104"); // Kenny's lock: 7.8¢ + taker fee
  assert.equal(t(null), null);
}
