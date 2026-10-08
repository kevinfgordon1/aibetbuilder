import assert from "node:assert/strict";
import {
  fmtAmerican, americanFromNoPrice, dollars, signedDollars, etDateTime, etDay, etStamp,
  plainLeg, lockTitle, lockStatus, betSummary, lockMetaLine, profitLine, plainAttemptLabel,
  historyResult, historyTotals, historyRow, lockSports, plainOutcomeText,
} from "./comboLockView.js";

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

console.log("comboLockView.test.js ok");
