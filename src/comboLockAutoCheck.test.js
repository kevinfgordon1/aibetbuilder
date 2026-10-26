import assert from "node:assert/strict";
import { quotedYesPrice } from "./buyerOdds.js";
import { topPriceSuggestion, autoCheckDue, missedQuotes, lockPriceAdvice, LOCK_CHECK_SECONDS, AUTO_CHECK_FIRST_MISSED, AUTO_CHECK_EVERY_MISSED } from "./comboLockCheck.js";
import { lockQuoteFillCounts } from "./comboLockSubmissions.js";

assert.equal(LOCK_CHECK_SECONDS, 5);
assert.equal(AUTO_CHECK_FIRST_MISSED, 10);
assert.equal(AUTO_CHECK_EVERY_MISSED, 20);

// missed = quotes − fills
assert.equal(missedQuotes({ quoted: 19, fills: 0 }), 19);
assert.equal(missedQuotes({ quoted: 3, fills: 5 }), 0);
assert.equal(missedQuotes(null), 0);

// first at 10 missed, then every 20 after (30, 50, 70…)
assert.equal(autoCheckDue({ missed: 9 }), false);
assert.equal(autoCheckDue({ missed: 10 }), true);
assert.equal(autoCheckDue({ missed: 20, lastMissed: 10 }), false, "old every-10 cadence is gone");
assert.equal(autoCheckDue({ missed: 29, lastMissed: 10 }), false);
assert.equal(autoCheckDue({ missed: 30, lastMissed: 10 }), true, "lock checked at 10 next checks at 30");
assert.equal(autoCheckDue({ missed: 49, lastMissed: 30 }), false);
assert.equal(autoCheckDue({ missed: 50, lastMissed: 30 }), true);
assert.equal(autoCheckDue({ missed: 70, lastMissed: 50 }), true);
// never while a check runs, paused, unavailable, or in cooldown
assert.equal(autoCheckDue({ missed: 20, busy: true }), false);
assert.equal(autoCheckDue({ missed: 20, paused: true }), false);
assert.equal(autoCheckDue({ missed: 20, available: false }), false);
assert.equal(autoCheckDue({ missed: 20, nowMs: 1000, notBeforeMs: 5000 }), false);
assert.equal(autoCheckDue({ missed: 20, nowMs: 6000, notBeforeMs: 5000 }), true);

// counts helper agrees with the pill
const rows = [{ parlay_id: "a", status: "filled", quote_id: "q1" }, { parlay_id: "a", status: "expired", quote_id: "q2" }];
const c = lockQuoteFillCounts(rows, { fills: 1, countedUnfilledQuotes: 30 });
assert.equal(c.fills, 1);
assert.ok(c.quoted >= 1);

// advice
const lock = { id: "l", fill_american: 1200, max_contracts: 668, parlay_stake: 50, parlay_american: 1200, kind: "boost", legs: [] };
assert.equal(lockPriceAdvice(null, lock), null);
assert.equal(lockPriceAdvice({ ok: false }, lock), null);
assert.equal(lockPriceAdvice({ ok: true, bestNoBid: null, bestAmerican: null }, lock), null, "nobody else quoted → nothing");
// competitor NO bid 0.93 → seller-side +1377, better for the buyer than our +1200 → we're behind
const r1 = { ok: true, bestNoBid: 0.93, bestAmerican: 1377, suggestFillAmerican: 1623, makerRate: 0.035 };
const behind = lockPriceAdvice(r1, lock);
assert.equal(behind.kind, "behind");
assert.ok(behind.suggest > 1377 && behind.suggest < 1623, "just better than best, not a whole cent: " + behind.suggest);
assert.equal(topPriceSuggestion(r1), behind.suggest);
assert.ok(quotedYesPrice(behind.suggest, { makerRate: 0.035 }) < 0.07);
assert.ok(!(quotedYesPrice(behind.suggest - 1, { makerRate: 0.035 }) < 0.07 - 1e-9), "smallest such price");
assert.match(behind.text, /^Not the best market price — best seen \+1377, yours \+1200\. Try \+\d+ to be top/);
assert.ok(behind.profit && Number.isFinite(behind.profit.hit), "profit at the suggested price");
// competitor NO 0.85 (+587) is worse for the buyer than our +1200 → "best"
const best = lockPriceAdvice({ ok: true, bestNoBid: 0.85, bestAmerican: 587, suggestFillAmerican: 636, makerRate: 0.035 }, lock);
assert.equal(best.kind, "best");
console.log("comboLockAutoCheck ok");

// Server-side auto check (auto_check_* columns)
import { serverAutoCheckOn, serverAutoCheckResult } from "./comboLockCheck.js";
assert.equal(serverAutoCheckOn({}), false);
assert.equal(serverAutoCheckOn({ VITE_COMBO_SERVER_AUTO_CHECK: "1" }), true);
assert.equal(serverAutoCheckResult({ id: "x" }), null); // column missing
assert.equal(serverAutoCheckResult({ auto_check_at: "2026-10-26T21:00:00Z", auto_check_result: "error" }), null);
const sr = serverAutoCheckResult({ auto_check_at: "2026-10-26T21:00:00Z", auto_check_result: "lose", auto_check_best_no_bid: "0.945", auto_check_best_american: 1718, auto_check_competitors: 1, combo_ticker: "KXMVE-1" });
assert.equal(sr.ok, true); assert.equal(sr.bestAmerican, 1718); assert.equal(sr.bestNoBid, 0.945); assert.equal(sr.competitorCount, 1);
