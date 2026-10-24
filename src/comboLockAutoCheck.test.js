import assert from "node:assert/strict";
import { quotedYesPrice } from "./buyerOdds.js";
import { topPriceSuggestion, autoCheckDue, missedQuotes, lockPriceAdvice, LOCK_CHECK_SECONDS, AUTO_CHECK_EVERY_MISSED } from "./comboLockCheck.js";
import { lockQuoteFillCounts } from "./comboLockSubmissions.js";

assert.equal(LOCK_CHECK_SECONDS, 5);
assert.equal(AUTO_CHECK_EVERY_MISSED, 20);

// missed = quotes − fills
assert.equal(missedQuotes({ quoted: 19, fills: 0 }), 19);
assert.equal(missedQuotes({ quoted: 3, fills: 5 }), 0);
assert.equal(missedQuotes(null), 0);

// fires after 20 missed, then once per 20 new
assert.equal(autoCheckDue({ missed: 10 }), false);
assert.equal(autoCheckDue({ missed: 19 }), false);
assert.equal(autoCheckDue({ missed: 20 }), true);
assert.equal(autoCheckDue({ missed: 39, lastMissed: 20 }), false);
assert.equal(autoCheckDue({ missed: 40, lastMissed: 20 }), true);
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
