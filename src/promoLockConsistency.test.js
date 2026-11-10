// Displayed book odds, EV, and Guaranteed Profit have to be the same prices.
// Nov 10 2026, No Promo, Underdog Predict, $100, 1 leg: the card showed a
// walked Kalshi best-opp and a lock that still used the thin top.
// A −289 book against the shown +282 opp is about −$0.63 and is not a lock.
// A thin top that is better than that opp must not flip it to Guaranteed Profit.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  americanToDecimal,
  americanToImpliedProb,
  calcBoostLockFromPrices,
  lockOppAmerican,
} from "./blendAskLadder.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function evFromDisplayed(bookAmerican, oppAmerican, stake) {
  const d = americanToDecimal(bookAmerican);
  const oppP = americanToImpliedProb(oppAmerican);
  const p = 1 - oppP;
  const profit = (d - 1) * stake;
  const ev = p * profit - (1 - p) * stake;
  return { profit, ev, p };
}

// EV dollars and lock profit are the same number when both use the displayed
// book American and the displayed best-opp American.
function assertEvMatchesLock(bookAmerican, oppAmerican, stake) {
  const shown = evFromDisplayed(bookAmerican, oppAmerican, stake);
  const lock = calcBoostLockFromPrices(oppAmerican, stake, shown.profit);
  assert.ok(Math.abs(shown.ev - lock.lockedProfit) < 1e-9, `EV ${shown.ev} vs lock ${lock.lockedProfit}`);
  return { ...shown, lock };
}

{
  const row = assertEvMatchesLock(-289, 282, 100);
  assert.ok(row.ev < 0, "−289 vs +282 is negative EV");
  assert.ok(Math.abs(row.ev + 0.63) < 0.02, `EV about −$0.63, got ${row.ev}`);
  assert.ok(Math.abs(row.lock.hedgeStake - 35.24) < 0.05, `hedge about $35.24, got ${row.lock.hedgeStake}`);
  assert.equal(row.lock.valid, false, "negative lock is not Guaranteed Profit");
}

// The thin top is a better price. Using it would print a small lock.
// The card's best opp is the walk, so the lock stays off.
{
  const leg = {
    dk: -289,
    bestOpp: 282,
    bestOppQuoted: 296,
    pmBlend: { american: 282 },
  };
  assert.equal(lockOppAmerican(leg), 282);
  const shown = evFromDisplayed(leg.dk, lockOppAmerican(leg), 100);
  const lock = calcBoostLockFromPrices(lockOppAmerican(leg), 100, shown.profit);
  assert.equal(lock.valid, false);
  const atTop = calcBoostLockFromPrices(leg.bestOppQuoted, 100, shown.profit);
  assert.equal(atTop.valid, true, "the top alone would falsely lock");
  assert.ok(atTop.lockedProfit > 0);
}

// Live Underdog phone price for Georgia Southern ML was −209 (probability 66
// plus the UDX fee; decimal 1.48). Against the shown +282 blend that EV is
// about +$9.14. A +296 top locks about +$10.51 and must not be the number
// on the card.
{
  const leg = { dk: -209, bestOpp: 282, bestOppQuoted: 296, pmBlend: { american: 282 } };
  assert.equal(lockOppAmerican(leg), 282);
  const shown = assertEvMatchesLock(-209, 282, 100);
  assert.ok(Math.abs(shown.ev - 9.14) < 0.02);
  const atTop = calcBoostLockFromPrices(296, 100, shown.profit);
  assert.ok(Math.abs(atTop.lockedProfit - 10.51) < 0.02);
  assert.ok(shown.lock.lockedProfit < atTop.lockedProfit);
}

{
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /calcBoostLock\(lockOppAmerican\(p\.legs\[0\]\)/);
  assert.match(app, /calcBoostLock\(lockOppAmerican\(displayLeg\)/);
  assert.match(app, /hedgeDecimal: dkDecimal\(lockOppAmerican\(p\.legs\[0\]\)\)/);
  assert.match(app, /const hedgeOdds = lockOppAmerican\(leg\)/);
  const freeBet = fs.readFileSync(path.join(root, "src/promoFreeBet.js"), "utf8");
  assert.match(freeBet, /lockOppAmerican\(parlay\.legs\[0\]\)/);
}

console.log("promoLockConsistency.test.js ok");
