import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentUnhedged,
  currentStanding,
  targetHedge,
  hedgePayoffs,
  lockProfile,
  formatTargetLine,
  formatFillProgress,
  signedMoney,
  moneyAbs,
  formatAmericanOdds,
  formatStakeOddsChip,
  lockKind,
  isFreeBetLock,
  bookPnL,
  hedgeCap,
  decideAtFill,
} from "./comboLockProfile.js";
import { calcFreeBetParlayEV } from "./promoFreeBet.js";

// Ari + Jax — Kevin's example: risk $100 for $650 profit, ~$5 either way at 750 @ +610
const ariJax = {
  parlay_stake: 100,
  parlay_american: 650,
  fill_american: 610,
  fair_american: 600,
  max_contracts: 750,
  hedge_mode: "1x",
};

{
  const cur = currentUnhedged(ariJax);
  assert.equal(cur.risk, 100);
  assert.equal(cur.profit, 650);
  assert.equal(cur.text, "risk $100 for $650 profit");
  assert.equal(cur.hit, 650);
  assert.equal(cur.miss, -100);
}

{
  const t = targetHedge(ariJax);
  assert.equal(t.contracts, 750);
  assert.equal(t.fillAmerican, 610);
  assert.ok(Math.abs(t.hit - 5.63) < 0.02, `hit ${t.hit}`);
  assert.ok(Math.abs(t.miss - 5.63) < 0.02, `miss ${t.miss}`);
  assert.equal(t.locks, true);
  assert.match(formatTargetLine(t), /750 contracts/);
  assert.match(formatTargetLine(t), /locked either way/);
}

{
  const p = lockProfile(ariJax, 0);
  assert.equal(p.targetTbd, false);
  assert.equal(p.filled, 0);
  assert.equal(p.targetContracts, 750);
  assert.equal(p.remaining, 750);
  assert.equal(p.soFar.hit, 650);
  assert.equal(p.soFar.miss, -100);
  assert.equal(p.current.hit, 650);
  assert.equal(p.current.miss, -100);
  assert.equal(p.current.risk, 100);
  assert.equal(p.current.profit, 650);
  assert.equal(p.current.text, "risk $100 for $650 profit");
  assert.equal(p.current.standing, undefined);
  assert.equal(formatFillProgress(p), "0 of 750 toward target");
}

{
  const halfway = lockProfile(ariJax, 375);
  assert.equal(halfway.filled, 375);
  assert.equal(halfway.remaining, 375);
  assert.equal(halfway.pct, 50);
  assert.ok(halfway.soFar.hit > 200 && halfway.soFar.hit < 400);
  assert.ok(halfway.soFar.miss < 0);
  // CURRENT standing = fills so far, not the original book-only line
  assert.equal(halfway.current.hit, halfway.soFar.hit);
  assert.equal(halfway.current.miss, halfway.soFar.miss);
  assert.equal(halfway.current.standing, true);
  assert.ok(halfway.current.risk < 100, `remaining risk ${halfway.current.risk}`);
  assert.equal(halfway.current.risk, Math.abs(halfway.soFar.miss));
  assert.equal(halfway.current.profit, halfway.soFar.hit);
  assert.equal(halfway.current.text, `risk ${moneyAbs(halfway.current.risk)} for ${moneyAbs(halfway.soFar.hit)} profit`);
  assert.notEqual(halfway.current.text, "risk $100 for $650 profit");
  assert.equal(halfway.target.hit, targetHedge(ariJax).hit);
  assert.equal(halfway.target.miss, targetHedge(ariJax).miss);
}

assert.equal(targetHedge({ parlay_stake: 100, parlay_american: 650 }), null);
assert.equal(formatTargetLine(null), "target TBD");
assert.equal(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0).targetTbd, true);
assert.equal(formatFillProgress(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0)), "target TBD");
assert.equal(currentUnhedged({}), null);
assert.equal(signedMoney(5.63), "+$5.63");
assert.equal(signedMoney(-100), "-$100.00");
assert.equal(moneyAbs(100), "$100");
assert.equal(moneyAbs(650), "$650");
assert.equal(hedgePayoffs({ stake: 100, american: 650, fillAmerican: 610, contracts: 0 }).hit, 650);

{
  // Seattle-style partial fill: CURRENT must leave the book-only $50 line
  const seattle = {
    parlay_stake: 50,
    parlay_american: 2447,
    fill_american: 1993,
    max_contracts: 1274,
  };
  const book = currentUnhedged(seattle);
  assert.equal(book.risk, 50);
  assert.equal(book.profit, 1223.5);
  assert.equal(book.text, "risk $50 for $1223.50 profit");
  const zero = lockProfile(seattle, 0);
  assert.equal(zero.current.text, book.text);
  assert.equal(zero.current.hit, book.hit);
  assert.equal(zero.current.miss, book.miss);
  const partial = lockProfile(seattle, 387.26);
  assert.equal(partial.current.hit, partial.soFar.hit);
  assert.equal(partial.current.miss, partial.soFar.miss);
  assert.equal(partial.current.standing, true);
  assert.ok(partial.current.risk < 50);
  assert.notEqual(partial.current.text, book.text);
  assert.equal(partial.soFar.hit, hedgePayoffs({
    stake: 50, american: 2447, fillAmerican: 1993, contracts: 387.26,
  }).hit);
  const locked = currentStanding(book, { hit: 5.63, miss: 5.63 });
  assert.equal(locked.risk, 0);
  assert.equal(locked.text, "standing +$5.63 / +$5.63");
}

{
  assert.equal(formatAmericanOdds(650), "+650");
  assert.equal(formatAmericanOdds(-110), "-110");
  assert.equal(formatAmericanOdds(0), null);
  assert.equal(formatAmericanOdds(null), null);
  assert.equal(formatStakeOddsChip(ariJax), "stake $100 @ +650");
  assert.equal(formatStakeOddsChip({ parlay_stake: 50, parlay_american: 2447 }), "stake $50 @ +2447");
  assert.equal(formatStakeOddsChip({ parlay_stake: 94.76, parlay_american: 434 }), "stake $94.76 @ +434");
  assert.equal(formatStakeOddsChip({ parlay_stake: 100 }), null);
  assert.equal(formatStakeOddsChip({ parlay_american: 650 }), null);
  assert.equal(formatStakeOddsChip({ parlay_stake: 0, parlay_american: 650 }), null);
  assert.equal(formatStakeOddsChip({ parlay_stake: 100, parlay_american: 0 }), null);
  assert.equal(formatStakeOddsChip({}), null);
  assert.equal(formatStakeOddsChip(null), null);
}

{
  const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  // Stake @ odds now lives in the shared LockCard ("Your original bet") and History rows.
  const viewSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocksView.jsx"), "utf8");
  // First tile is where you stand now; the original bet is a small reminder line under the tiles.
  assert.match(viewSrc, /<div className="lk-facts">\s*<StandTile now=\{tiles\.now\} \/>\s*<TargetTile target=\{tiles\.target\} sellAt=\{s\.sellAt\} \/>\s*<SellTile summary=\{s\}[^>]*\/>/);
  assert.match(viewSrc, /<span className="lead">Your original bet:<\/span>\{" "\}\s*<span className="val">\{s\.betLine\}<\/span>/);
  assert.doesNotMatch(viewSrc, /Pays up to|Wins if it hits/);
  assert.match(viewSrc, /<th>Your original bet<\/th><th>Fair odds<\/th>/);
  assert.doesNotMatch(viewSrc + locksSrc, /Your bet\b/);
  assert.match(locksSrc, /<LockCard/);
  assert.doesNotMatch(locksSrc, /have \{fmtAm/);
  assert.match(locksSrc, /moneyAbs\(profile\.current\.risk\)/);
  assert.match(locksSrc, /moneyAbs\(profile\.current\.profit\)/);
  assert.match(locksSrc, /<span className="neg">\{moneyAbs\(profile\.current\.risk\)\}<\/span>/);
  assert.match(locksSrc, /<span className="pos">\{moneyAbs\(profile\.current\.profit\)\}<\/span>/);
  assert.match(locksSrc, /If it hits <span className="pos">\{signedMoney\(profile\.current\.hit\)\}<\/span>/);
  assert.match(locksSrc, /if it loses <span className=\{missTone\}>\{signedMoney\(profile\.current\.miss\)\}<\/span>/);
  assert.match(locksSrc, /conversionRate/);
  assert.match(locksSrc, /unhedged upside/);
  assert.match(locksSrc, /is_free_bet/);
  assert.match(locksSrc, /hedgeCap/);
  assert.match(locksSrc, /decideAtFill/);
  // With fills the first Profit picture tile is just the two outcomes.
  assert.doesNotMatch(locksSrc, /Right now \(with fills\)/);
  assert.match(locksSrc, /If parlay hits <span className=\{profile\.current\.hit < 0 \? "neg" : "pos"\}>\{signedMoney\(profile\.current\.hit\)\}<\/span>/);
  assert.match(locksSrc, /If it loses <span className=\{missTone\}>\{signedMoney\(profile\.current\.miss\)\}<\/span>/);
  assert.match(locksSrc, /const missTone = profile\.current\.miss < 0 \? "neg" : "pos";/);
  // Whole card summary toggles Details; real controls do not.
  assert.match(viewSrc, /className="lk-sum"\s+role="button"\s+tabIndex=\{0\}\s+aria-expanded=\{!!open\}/);
  assert.match(viewSrc, /onClick=\{summaryClick\}/);
  assert.match(viewSrc, /onKeyDown=\{summaryKey\}/);
  assert.match(viewSrc, /className="lk-ctl" data-no-toggle=""/);
  assert.match(locksSrc, /\.cl \.pos\{color:#34d399\}\.cl \.neg\{color:#f87171\}\.cl \.muted\{color:#8a8f98\}/);
  assert.doesNotMatch(locksSrc, /className="v num">\{profile\.current\.text\}/);
  assert.match(locksSrc, /Risk-free — floor \$0, keep upside/);
  assert.match(locksSrc, /1× pure hedge — equal both sides \(default\)/);
  assert.match(locksSrc, /Risk-free — floor \$0, open to larger orders \(new\)/);
  assert.doesNotMatch(locksSrc, /<option value="2x">/);
  assert.match(locksSrc, /"2x": "2× \(directional\)"/);
  assert.doesNotMatch(locksSrc, /<option value="3x">/);
  assert.match(locksSrc, /"3x": "3× \(directional\)"/);
  assert.match(locksSrc, /if the parlay hits/);
  assert.match(locksSrc, /if the parlay misses/);
}

{
  // Free bet: miss is $0, hit is profit only. Do not reuse cash bookMiss = −stake.
  const fb = {
    parlay_stake: 100,
    parlay_american: 650,
    fill_american: 610,
    fair_american: 600,
    max_contracts: 650,
    hedge_mode: "1x",
    is_free_bet: true,
  };
  assert.equal(lockKind(fb), "freebet");
  assert.equal(isFreeBetLock(fb), true);
  assert.equal(lockKind({ label: "Free bet · Ari + Jax" }), "freebet");
  assert.equal(lockKind(ariJax), "cash");

  const book = bookPnL({ stake: 100, american: 650, kind: "freebet" });
  assert.equal(book.bookMiss, 0);
  assert.ok(Math.abs(book.bookHit - 650) < 1e-9);
  assert.ok(Math.abs(book.equalizeN - 650) < 1e-9);
  const cashBook = bookPnL({ stake: 100, american: 650, kind: "cash" });
  assert.equal(cashBook.bookMiss, -100);
  assert.ok(Math.abs(cashBook.equalizeN - 750) < 1e-9);

  assert.equal(hedgeCap({ stake: 100, boostAmerican: 650, fillAmerican: 610, mode: "1x" }), 750);
  assert.equal(hedgeCap({ stake: 100, boostAmerican: 650, fillAmerican: 610, mode: "1x", kind: "freebet" }), 650);
  assert.equal(hedgeCap({ stake: 100, boostAmerican: 650, fillAmerican: 610, mode: "2x", kind: "freebet" }), 1300);
  // Free bet riskfree: N = ceil(face / y) = ceil(100 × 7.10) = 710 (never 0).
  assert.equal(hedgeCap({ stake: 100, boostAmerican: 650, fillAmerican: 610, mode: "riskfree", kind: "freebet" }), 710);

  const unhedged = currentUnhedged(fb);
  assert.equal(unhedged.kind, "freebet");
  assert.equal(unhedged.risk, 0);
  assert.equal(unhedged.miss, 0);
  assert.equal(unhedged.hit, 650);
  assert.equal(unhedged.profit, 650);
  assert.equal(unhedged.conversionRate, 0);
  assert.match(unhedged.text, /0\.0% conversion/);
  assert.match(unhedged.text, /\$650 unhedged upside/);
  assert.notEqual(unhedged.text, "risk $100 for $650 profit");

  const pay = hedgePayoffs({
    stake: 100, american: 650, fillAmerican: 610, contracts: 650, kind: "freebet",
  });
  const s = 100 / (610 + 100);
  const locked = 650 * s;
  assert.ok(Math.abs(pay.hit - locked) < 0.02, `fb hit ${pay.hit}`);
  assert.ok(Math.abs(pay.miss - locked) < 0.02, `fb miss ${pay.miss}`);
  assert.ok(pay.hit > 0 && pay.miss > 0);
  assert.notEqual(pay.miss, hedgePayoffs({
    stake: 100, american: 650, fillAmerican: 610, contracts: 650,
  }).miss);

  const decided = decideAtFill({
    parlayStake: 100, parlayAmerican: 650, fillAmerican: 610,
    rfqContracts: 650, hedgeMode: "1x", kind: "freebet",
  });
  assert.equal(decided.ok, true);
  assert.equal(decided.kind, "freebet");
  assert.equal(decided.cap, 650);
  assert.equal(decided.contracts, 650);
  assert.equal(decided.locks, true);
  assert.ok(Math.abs(decided.hit - decided.miss) < 0.02);

  const cashDecided = decideAtFill({
    parlayStake: 100, parlayAmerican: 650, fillAmerican: 610,
    rfqContracts: 750, hedgeMode: "1x",
  });
  assert.equal(cashDecided.cap, 750);
  assert.ok(Math.abs(cashDecided.hit - 5.63) < 0.02);
  assert.ok(Math.abs(cashDecided.miss - 5.63) < 0.02);

  const riskfree = decideAtFill({
    parlayStake: 100, parlayAmerican: 650, fillAmerican: 610,
    rfqContracts: 710, hedgeMode: "riskfree", kind: "freebet",
  });
  assert.equal(riskfree.ok, true);
  assert.equal(riskfree.cap, 710);
  assert.equal(riskfree.contracts, 710);
  assert.equal(riskfree.miss, 100); // free-bet face back on a miss
  assert.equal(riskfree.hit, 40); // 650 − 710 × (1 − y), still ≥ $0
  assert.equal(riskfree.locks, true);

  const prof = lockProfile(fb, 0);
  assert.equal(prof.current.kind, "freebet");
  assert.equal(prof.current.miss, 0);
  assert.equal(prof.target.contracts, 650);
  assert.ok(Math.abs(prof.target.hit - prof.target.miss) < 0.02);
  assert.equal(formatStakeOddsChip(fb), "free bet $100 @ +650");

  const half = lockProfile(fb, 325);
  assert.equal(half.current.standing, true);
  assert.equal(half.current.kind, "freebet");
  assert.ok(half.current.miss >= 0);
  assert.ok(half.current.conversionRate > 0);
  assert.ok(half.current.unhedgedUpside > 0);
  assert.match(half.current.text, /conversion/);
}

{
  // EV consistency: Combo Locks free-bet bookHit === promo winProfit (D−1)×FB
  const legs = [
    { dk: 150, bestOpp: -130 },
    { dk: -110, bestOpp: 120 },
  ];
  const ev = calcFreeBetParlayEV(legs, 40);
  const book = bookPnL({ stake: 40, american: ev.parlayOdds, kind: "freebet" });
  assert.ok(book);
  assert.equal(book.bookMiss, 0);
  assert.ok(Math.abs(book.bookHit - ev.winProfit) < 0.51, `bookHit ${book.bookHit} vs winProfit ${ev.winProfit}`);
  assert.ok(Math.abs(ev.ev - ev.combinedProb * ev.winProfit) < 1e-9);
}

{
  // Kevin's hedge-mode example: S=100, +2000, fill +1200.
  // y = 1/13. Mode 1 = 1,300 (+$800 / $0). 1× = 2,100 (+$61.54 both).
  // Open-to-larger exact N = 2,166.67 (+$66.67 if it loses, $0 if it wins),
  // then floored to a whole contract so the win side stays ≥ $0.
  const stake = 100;
  const boost = 2000;
  const fill = 1200;
  const y = 100 / (fill + 100);
  const W = stake * (boost / 100);
  const exactOpen = W / (1 - y);
  assert.ok(Math.abs(y - 1 / 13) < 1e-12);
  assert.equal(W, 2000);
  assert.ok(Math.abs(exactOpen - (2000 * 13) / 12) < 1e-9);
  assert.equal(Number(exactOpen.toFixed(2)), 2166.67);
  const exactMiss = exactOpen * y - stake;
  const exactHit = W - exactOpen * (1 - y);
  assert.equal(Number(exactMiss.toFixed(2)), 66.67);
  assert.ok(Math.abs(exactHit) < 1e-9);

  const modes = {
    riskfree: hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: "riskfree" }),
    "1x": hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: "1x" }),
    riskfree_open: hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: "riskfree_open" }),
    "2x": hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: "2x" }),
    "3x": hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: "3x" }),
  };
  assert.equal(modes.riskfree, 1300);
  assert.equal(modes["1x"], 2100);
  assert.equal(modes.riskfree_open, 2166);
  assert.equal(modes["2x"], 4200);
  assert.equal(modes["3x"], 6300);

  function filled(mode, contracts) {
    return decideAtFill({
      parlayStake: stake,
      parlayAmerican: boost,
      fillAmerican: fill,
      rfqContracts: contracts,
      hedgeMode: mode,
    });
  }
  const riskfree = filled("riskfree", modes.riskfree);
  assert.equal(riskfree.ok, true);
  assert.equal(riskfree.cap, 1300);
  assert.equal(riskfree.hit, 800);
  assert.equal(riskfree.miss, 0);

  const oneX = filled("1x", modes["1x"]);
  assert.equal(oneX.cap, 2100);
  assert.equal(oneX.hit, 61.54);
  assert.equal(oneX.miss, 61.54);
  assert.equal(oneX.locks, true);

  const open = filled("riskfree_open", modes.riskfree_open);
  assert.equal(open.cap, 2166);
  assert.equal(open.contracts, 2166);
  assert.ok(open.hit >= 0, `win side went negative: ${open.hit}`);
  assert.equal(open.hit, 0.62);
  assert.equal(open.miss, 66.62);
  assert.equal(open.locks, true);

  const twoX = filled("2x", modes["2x"]);
  assert.equal(twoX.cap, 4200);
  assert.ok(twoX.hit < 0, "2× is a directional short on a win");
  assert.ok(twoX.miss > 0);

  const threeX = filled("3x", modes["3x"]);
  assert.equal(threeX.cap, 6300);
  assert.ok(threeX.hit < twoX.hit);

  // Free bet: risk-free sizes off the free-bet face (never 0): ceil(100 × 13) = 1,300.
  // Miss = +$100, hit = +$800. The new mode still sizes off W.
  const freeRf = hedgeCap({
    stake, boostAmerican: boost, fillAmerican: fill, mode: "riskfree", kind: "freebet",
  });
  assert.equal(freeRf, 1300);
  const freeRfDecision = decideAtFill({
    parlayStake: stake, parlayAmerican: boost, fillAmerican: fill,
    rfqContracts: freeRf, hedgeMode: "riskfree", kind: "freebet",
  });
  assert.equal(freeRfDecision.miss, 100);
  assert.equal(freeRfDecision.hit, 800);
  // Boost worse than the fill: clamp so the win side never goes negative.
  const clamp = hedgeCap({ stake: 100, boostAmerican: 400, fillAmerican: 600, mode: "riskfree", kind: "freebet" });
  assert.equal(clamp, Math.floor(400 / (1 - 1 / 7) + 1e-9));
  assert.ok(decideAtFill({
    parlayStake: 100, parlayAmerican: 400, fillAmerican: 600,
    rfqContracts: clamp, hedgeMode: "riskfree", kind: "freebet",
  }).hit >= 0);
  // Every saved mode gives a free bet a positive cap (combo-worker treats 0 as unlimited).
  for (const m of ["1x", "2x", "3x", "riskfree", "riskfree_open"]) {
    assert.ok(hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: m, kind: "freebet" }) > 0, m);
  }
  const freeOpen = hedgeCap({
    stake, boostAmerican: boost, fillAmerican: fill, mode: "riskfree_open", kind: "freebet",
  });
  assert.equal(freeOpen, 2166);
  const freeDecision = decideAtFill({
    parlayStake: stake, parlayAmerican: boost, fillAmerican: fill,
    rfqContracts: freeOpen, hedgeMode: "riskfree_open", kind: "freebet",
  });
  assert.equal(freeDecision.ok, true);
  assert.ok(freeDecision.hit >= 0);
  assert.ok(freeDecision.miss > 0);
  assert.equal(hedgeCap({
    stake, boostAmerican: boost, fillAmerican: fill, mode: "1x", kind: "freebet",
  }), 2000);
}

// Partial-fill locks (Filled section) keep the "taker gets" + "fair" header chips, same as 0-fill locks.
{
  const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  // One shared renderLock() card for both sections, so both keep the chips.
  assert.equal((locksSrc.match(/<TakerFairChips parlay=\{p\} \/>/g) || []).length, 1);
  assert.match(locksSrc, /function TakerFairChips\(\{ parlay \}\)/);
  assert.match(locksSrc, /parlay\.fair_american/);
  assert.match(locksSrc, /waiting\.map\(\(p\) => renderLock\(p, \{ filledSection: false \}\)\)/);
  assert.match(locksSrc, /filledParlays\.map\(\(p\) => renderLock\(p, \{ filledSection: true \}\)\)/);
}

console.log("comboLockProfile.test.js ok");
