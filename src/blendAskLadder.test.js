import assert from "node:assert/strict";
import {
  TARGET_PAYOUT_USD,
  LOW_LIQUIDITY_LABEL,
  blendAskLadderToPayout,
  blendAskLadderToStake,
  formatBlendedPayoutFlag,
  formatBlendedHedgeFlag,
  blendDidWalk,
  payoutTargetLabel,
  americanToImpliedProb,
  impliedProbToAmerican,
  requiredBoostHedgeStake,
  requiredFreeBetHedgeStake,
  requiredNoSweatHedgeStake,
  boostedProfitFromLeg,
  stakeToProfit,
  applyPmBlendToLeg,
  applyPmBlendToLegs,
  preferCompletePmHedge,
  isPmBlendVenue,
  trueOppAmerican,
} from "./blendAskLadder.js";

assert.equal(TARGET_PAYOUT_USD, 500);
assert.equal(payoutTargetLabel(), "$500");
assert.equal(LOW_LIQUIDITY_LABEL, "Low liquidity");
assert.equal(isPmBlendVenue("kalshi"), true);
assert.equal(isPmBlendVenue("pinnacle"), false);
assert.equal(isPmBlendVenue("draftkings"), false);

// ── Lock math stays hedge-$ ; Hide-low-liquidity / blend is $500 profit
{
  const stake = 100;
  const profit = boostedProfitFromLeg({ dk: 200 }, stake, 100);
  assert.ok(Math.abs(profit - 400) < 1e-9);
  const H = requiredBoostHedgeStake(stake, profit, -200);
  assert.ok(Math.abs(H - 500 / 1.5) < 1e-9);
  assert.ok(Math.abs(H - 333.333333) < 1e-4);

  const full = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 1000 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(full.lowLiquidity, false, "full book covers $500 profit");
  assert.equal(full.bestOpp, -200);
  assert.equal(full.pmBlend.mode, "payout");
  assert.ok(full.pmBlend.complete);
  assert.equal(full.pmBlend.levelsUsed, 1);
  assert.equal(full.pmBlend.flag, "", "top size alone fills $500 profit — no blend tag");

  const short = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "novig", bestOppSize: 100 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(short.lowLiquidity, true, "top-only $100 cannot fund $500 profit");
  assert.equal(short.bestOpp, -200);
  assert.equal(short.pmBlend.mode, "payout");
  assert.match(short.pmBlend.flag, /of \$500 payout available/);

  // Old hedge-$ bar would have cleared $400 @ −200 (profit $200); $500 payout does not.
  const coversOldHedge = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 400 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(coversOldHedge.lowLiquidity, true, "$400 fills $333 hedge but only $200 of $500 profit");
  assert.match(coversOldHedge.pmBlend.flag, /\$200 of \$500/);

  const pxShort = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "prophetx", bestOppSize: 80 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(pxShort.lowLiquidity, true, "ProphetX top-only shortfall flags");
}

// Kevin Cardinals: Fanatics −175 / Novig +163 $125 / 0% boost — old hedge ~$60
{
  const stake = 100;
  const profit = boostedProfitFromLeg({ dk: -175 }, stake, 0);
  const H = requiredBoostHedgeStake(stake, profit, 163);
  assert.ok(H > 0 && H < 125, "old hedge-$ bar would have cleared $125 Novig");
  const cardinals = applyPmBlendToLeg(
    { dk: -175, bestOpp: 163, bestOppBook: "novig", bestOppSize: 125 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 0 },
  );
  assert.equal(cardinals.lowLiquidity, true, "Cardinals-style $125 Novig fails $500 profit");
  assert.equal(cardinals.pmBlend.mode, "payout");
  assert.ok(Math.abs(cardinals.pmBlend.payoutFilled - 125 * 1.63) < 1e-6);
  assert.match(cardinals.pmBlend.flag, /of \$500 payout available/);
}

// Thin top cannot clear Hide low liquidity by walking into worse depth.
// Top +200 / $100 only funds $200 of $500 profit — low liquidity, keep quote.
{
  const walked = applyPmBlendToLeg(
    { dk: 200, bestOpp: 200, bestOppBook: "kalshi", bestOppSize: 100 },
    [
      { american: 200, size: 100 },
      { american: 100, size: 400 },
    ],
    { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 },
  );
  assert.equal(walked.lowLiquidity, true, "thin top stays low liquidity despite deep L2");
  assert.equal(walked.bestOppQuoted, 200);
  assert.equal(walked.bestOpp, 200, "do not replace quote with deep VWAP when top is thin");
  assert.equal(walked.pmBlend.mode, "payout");
  assert.equal(walked.pmBlend.thinTop, true);
  assert.equal(walked.pmBlend.complete, false);
  assert.match(walked.pmBlend.flag, /of \$500 payout available/);
  assert.doesNotMatch(walked.pmBlend.flag, /blended to \$500/);
}

// Endries-style Kalshi No: $64 top + fat worse level must not claim $500.
{
  const endries = applyPmBlendToLeg(
    {
      dk: 2200,
      bestOpp: -2038,
      bestOppBook: "kalshi",
      bestOppSize: 64,
      bestOppLevels: [
        { american: -2038, size: 64 },
        { american: -2042, size: 23832 },
      ],
    },
    null,
    { promoType: "boost", numLegs: 3 },
  );
  assert.equal(endries.lowLiquidity, true);
  assert.equal(endries.bestOpp, -2038);
  assert.equal(endries.pmBlend.thinTop, true);
  assert.match(endries.pmBlend.flag, /\$3 of \$500/);
  assert.doesNotMatch(endries.pmBlend.flag, /blended to \$500/);
}

// Deep top alone still clears the bar (no thin-top tag).
{
  const deepTop = applyPmBlendToLeg(
    { dk: 2200, bestOpp: -2038, bestOppBook: "kalshi", bestOppSize: 12000 },
    [{ american: -2038, size: 12000 }],
    { promoType: "boost", numLegs: 3 },
  );
  assert.equal(deepTop.lowLiquidity, false);
  assert.equal(deepTop.pmBlend.thinTop, undefined);
  assert.equal(deepTop.pmBlend.flag, "", "single deep top is not a blend tag");
}

// 1-leg no-sweat: lock H stays hedge-$ ; liquidity is $500 profit
{
  const H = requiredNoSweatHedgeStake(100, 100, 70, -200);
  assert.ok(Math.abs(H - 130 / 1.5) < 1e-9);
  const short = applyPmBlendToLeg(
    { dk: 100, bestOpp: -200, bestOppBook: "novig", bestOppSize: 80 },
    null,
    { promoType: "nosweat", numLegs: 1, stake: 100 },
  );
  assert.equal(short.lowLiquidity, true);
  assert.equal(short.pmBlend.mode, "payout");
  const full = applyPmBlendToLeg(
    { dk: 100, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 1000 },
    null,
    { promoType: "nosweat", numLegs: 1, stake: 100 },
  );
  assert.equal(full.lowLiquidity, false);
  assert.equal(full.pmBlend.mode, "payout");
}

// 1-leg free bet: lock H stays hedge-$ ; liquidity is $500 profit
{
  const H = requiredFreeBetHedgeStake(200, -200, 100);
  assert.ok(Math.abs(H - 200 / 1.5) < 1e-9);
  const short = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "polymarket", bestOppSize: 50 },
    null,
    { promoType: "freebet", numLegs: 1, stake: 100 },
  );
  assert.equal(short.lowLiquidity, true);
  assert.equal(short.pmBlend.mode, "payout");
  const full = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "polymarket", bestOppSize: 1000 },
    null,
    { promoType: "freebet", numLegs: 1, stake: 100 },
  );
  assert.equal(full.lowLiquidity, false);
  assert.equal(full.pmBlend.mode, "payout");
}

// ── multi-leg uses $500 profit excl. stake (not hedge $, not face/total return)
{
  const multi = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 200 },
    null,
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  assert.equal(multi.pmBlend.mode, "payout");
  // profit at −200: 200 × (100/200) = 100 < 500  (old face 300 was the bug)
  assert.equal(multi.lowLiquidity, true);
  assert.match(multi.pmBlend.flag, /of \$500 payout available/);
  assert.match(multi.pmBlend.flag, /\$100 of \$500/);

  const stillShortAt400 = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 400 },
    null,
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  // profit at −200: 400 × 0.5 = 200 < 500 (old face 600 incorrectly cleared the bar)
  assert.equal(stillShortAt400.lowLiquidity, true);
  assert.match(stillShortAt400.pmBlend.flag, /\$200 of \$500/);

  const covers500 = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 1000 },
    null,
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  // profit at −200: 1000 × 0.5 = 500
  assert.equal(covers500.lowLiquidity, false);
  assert.equal(covers500.pmBlend.levelsUsed, 1);
  assert.equal(covers500.pmBlend.flag, "", "single-level $500 fill is not a blend");

  const deep = applyPmBlendToLeg(
    { dk: -110, bestOpp: 100, bestOppBook: "kalshi", bestOppSize: 600 },
    [{ american: 100, size: 600 }],
    { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 },
  );
  assert.equal(deep.lowLiquidity, false);
  assert.equal(deep.pmBlend.flag, "");
}

// Sportsbooks unchanged — no blend, no low-liq flag
{
  const fd = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "fanduel", bestOppSize: 50 },
    [{ american: -200, size: 50 }],
    { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 },
  );
  assert.equal(fd.bestOpp, -200);
  assert.equal(fd.lowLiquidity, false);
  assert.equal(fd.pmBlend, null);

  const pin = applyPmBlendToLegs(
    [{ dk: 100, bestOpp: -110, bestOppBook: "pinnacle", bestOppSize: null, sport: "x", game: "A @ B", name: "A", market: "ML" }],
    {},
    { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 },
  );
  assert.equal(pin.displayLegs[0].bestOpp, -110);
  assert.equal(pin.displayLegs[0].lowLiquidity, false);
}

// ── unproven PM book (empty ladder / missing bestOppSize) is low liquidity
{
  const multi = { promoType: "freebet", numLegs: 2, stake: 100 };
  const unknown = applyPmBlendToLeg(
    { dk: -115, bestOpp: 537, bestOppBook: "novig", bestOppSize: null },
    null,
    multi,
  );
  assert.equal(unknown.lowLiquidity, true, "missing size + no ladder → unproven fill");
  assert.equal(unknown.pmBlend, null);
  assert.equal(unknown.bestOpp, 537, "keep quoted true odds when unproven");

  const emptyLadder = applyPmBlendToLeg(
    { dk: -115, bestOpp: 537, bestOppBook: "kalshi" },
    [],
    multi,
  );
  assert.equal(emptyLadder.lowLiquidity, true, "empty ladder + no size → unproven fill");

  const zeroSize = applyPmBlendToLeg(
    { dk: -115, bestOpp: 537, bestOppBook: "polymarket", bestOppSize: 0 },
    null,
    multi,
  );
  assert.equal(zeroSize.lowLiquidity, true, "zero bestOppSize is not a proven fill");

  const failedWalk = applyPmBlendToLeg(
    { dk: -115, bestOpp: 537, bestOppBook: "prophetx", bestOppSize: null },
    [{ american: 0, size: 100 }],
    multi,
  );
  assert.equal(failedWalk.lowLiquidity, true, "levels that normalize away → unproven");

  const provenFromSize = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 1000 },
    null,
    multi,
  );
  assert.equal(provenFromSize.lowLiquidity, false, "bestOppSize that fills $500 profit is proven");

  const provenFromLadder = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "novig" },
    [{ american: -200, size: 1000 }],
    multi,
  );
  assert.equal(provenFromLadder.lowLiquidity, false, "real ladder that fills is proven even without bestOppSize");

  const fdUnknown = applyPmBlendToLeg(
    { dk: -115, bestOpp: 537, bestOppBook: "fanduel", bestOppSize: null },
    null,
    multi,
  );
  assert.equal(fdUnknown.lowLiquidity, false, "sportsbook opp is never low-liq from this path");
  assert.equal(fdUnknown.pmBlend, null);
}

// ── Profit Boost: thin top stays quoted + lowLiquidity (no deep VWAP laundering)
{
  const raw = {
    dk: 150,
    bestOpp: 200,
    bestOppBook: "kalshi",
    bestOppSize: 100,
    sport: "mlb",
    game: "A @ B",
    name: "A ML",
    bestOppName: "B ML",
    market: "ML",
  };
  const levels = [
    { american: 200, size: 100 },
    { american: 100, size: 400 },
  ];
  const { displayLegs } = applyPmBlendToLegs([raw], {
    ["kalshi|mlb|A @ B|B ML|ML"]: levels,
  }, { promoType: "boost", numLegs: 2, stake: 100, boostPct: 30 });
  assert.equal(displayLegs[0].lowLiquidity, true);
  assert.equal(displayLegs[0].bestOpp, 200, "thin top keeps quoted opp");
  assert.equal(trueOppAmerican(displayLegs[0]), 200);
  assert.match(displayLegs[0].pmBlend.flag, /of \$500 payout available/);
}

// Deep top that alone funds $500 still clears (no thin-top flag).
{
  const raw = {
    dk: 150,
    bestOpp: 200,
    bestOppBook: "kalshi",
    bestOppSize: 300,
    sport: "mlb",
    game: "A @ B",
    name: "A ML",
    bestOppName: "B ML",
    market: "ML",
  };
  const { displayLegs } = applyPmBlendToLegs([raw], {
    ["kalshi|mlb|A @ B|B ML|ML"]: [{ american: 200, size: 300 }],
  }, { promoType: "boost", numLegs: 2, stake: 100, boostPct: 30 });
  assert.equal(displayLegs[0].lowLiquidity, false);
  assert.equal(displayLegs[0].bestOpp, 200);
  assert.equal(displayLegs[0].pmBlend.flag, "");
}

// Prefer a full hedge fill over a short book when ranking 1-leg
{
  const ranked = preferCompletePmHedge([
    { ev: 40, legs: [{ lowLiquidity: true }] },
    { ev: 10, legs: [{ lowLiquidity: false }] },
  ]);
  assert.equal(ranked[0].ev, 10);
  assert.equal(ranked[1].ev, 40);
}

// ── known $500-profit ladder (multi-leg helper)
// +200 × $100 → $200 profit; need $300 more at +100 → $300 stake.
// VWAP p = 400 / (400+500) = 4/9 → +125 (old face walk stopped at +150).
{
  const blend = blendAskLadderToPayout([
    { american: 200, size: 100 },
    { american: 100, size: 400 },
  ]);
  assert.equal(blend.american, 125);
  assert.ok(Math.abs(blend.payoutFilled - 500) < 1e-6);
  assert.ok(Math.abs(blend.stakeFilled - 400) < 1e-6);
  assert.equal(blend.complete, true);
  assert.ok(blend.levelsUsed > 1);
  assert.equal(blend.flag, "blended to $500 payout");
  assert.equal(formatBlendedPayoutFlag(blend), "blended to $500 payout");
}

{
  const thin = blendAskLadderToPayout([
    { american: 104, size: 54 },
    { american: 100, size: 420 },
    { american: -105, size: 1100 },
  ]);
  assert.notEqual(thin.american, 104);
  assert.equal(thin.complete, true);
}

{
  const short = blendAskLadderToPayout([{ american: 150, size: 50 }]);
  assert.equal(short.american, 150);
  assert.equal(short.complete, false);
  // profit = 50 × 1.50 = 75 (old face 125 was stake × decimalOdds)
  assert.equal(short.flag, "blended · $75 of $500 payout available");
  assert.ok(Math.abs(short.payoutFilled - 75) < 1e-6);
}

// ── Nationals +1.5 Novig (Kevin, 2026-09-06): $62 @ +117 is $72.54 profit, not $135 face
{
  assert.ok(Math.abs(stakeToProfit(62, 117) - 72.54) < 1e-9);
  const nationals = blendAskLadderToPayout([{ american: 117, size: 62 }]);
  assert.equal(nationals.american, 117, "single level → VWAP stays +117");
  assert.equal(nationals.complete, false);
  assert.equal(nationals.lowLiquidity, true);
  assert.ok(Math.abs(nationals.payoutFilled - 72.54) < 1e-6);
  assert.ok(Math.abs(nationals.stakeFilled - 62) < 1e-6);
  assert.equal(nationals.flag, "blended · $73 of $500 payout available");
  assert.notEqual(nationals.flag, "blended · $135 of $500 payout available");

  const applied = applyPmBlendToLeg(
    { dk: -110, bestOpp: 117, bestOppBook: "novig", bestOppSize: 62 },
    [{ american: 117, size: 62 }],
    { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 },
  );
  assert.equal(applied.bestOpp, 117);
  assert.equal(applied.lowLiquidity, true);
  assert.equal(applied.pmBlend.flag, "blended · $73 of $500 payout available");
}

// ── Missouri-style Novig: thin top +223 is low liquidity; keep quote, honest shortfall
{
  const levels = [
    { american: 223, size: 80 },
    { american: 180, size: 50 },
    { american: 150, size: 14 },
  ];
  const blend = blendAskLadderToPayout(levels);
  assert.ok(blend.payoutFilled + 0.5 < TARGET_PAYOUT_USD, "short of $500 → low liquidity");
  assert.equal(blend.complete, false);
  assert.notEqual(blend.american, 223, "raw VWAP of the walk ≠ thin top");
  assert.match(blend.flag, /of \$500 payout available/);

  const raw = {
    dk: -110,
    bestOpp: 223,
    bestOppBook: "novig",
    bestOppSize: 80,
    sport: "americanfootball_ncaaf",
    game: "Missouri @ Rival",
    name: "Missouri ML",
    bestOppName: "Rival ML",
    market: "ML",
  };
  const { displayLegs } = applyPmBlendToLegs([raw], {
    ["novig|americanfootball_ncaaf|Missouri @ Rival|Rival ML|ML"]: levels,
  }, { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 });
  assert.equal(displayLegs[0].bestOppQuoted, 223);
  assert.equal(displayLegs[0].bestOpp, 223, "thin top keeps quoted opp on the card");
  assert.equal(displayLegs[0].lowLiquidity, true);
  assert.equal(displayLegs[0].pmBlend.thinTop, true);
  assert.match(displayLegs[0].pmBlend.flag, /of \$500 payout available/);
  assert.doesNotMatch(displayLegs[0].pmBlend.flag, /blended to \$500/);
}

assert.equal(blendAskLadderToPayout(null), null);
assert.equal(blendAskLadderToPayout([]), null);
assert.equal(blendAskLadderToStake([], { targetStake: 333 }), null);

{
  const walk = blendAskLadderToStake(
    [{ american: -200, size: 200 }, { american: -210, size: 200 }],
    { targetStake: 500 / 1.5 },
  );
  assert.ok(walk.complete);
  assert.equal(walk.mode, "hedge");
  assert.ok(walk.levelsUsed > 1);
  assert.match(walk.flag, /blended to .* hedge/);
}

// ── Ole Miss-style: deep top alone fills $500 profit — no "blended to $500" tag
{
  const oleMiss = blendAskLadderToPayout([{ american: -111, size: 1896 }]);
  assert.equal(oleMiss.complete, true);
  assert.equal(oleMiss.levelsUsed, 1);
  assert.equal(oleMiss.american, -111);
  assert.ok(oleMiss.payoutFilled + 0.5 >= TARGET_PAYOUT_USD);
  assert.equal(blendDidWalk(oleMiss), false);
  assert.equal(oleMiss.flag, "");
  assert.equal(formatBlendedPayoutFlag(oleMiss), "");
  assert.equal(formatBlendedPayoutFlag(oleMiss, -111), "");

  const applied = applyPmBlendToLeg(
    { dk: -110, bestOpp: -111, bestOppBook: "novig", bestOppSize: 1896 },
    [{ american: -111, size: 1896 }],
    { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 },
  );
  assert.equal(applied.lowLiquidity, false);
  assert.equal(applied.bestOpp, -111);
  assert.equal(applied.pmBlend.flag, "");
}

{
  const singleHedge = blendAskLadderToStake(
    [{ american: -200, size: 400 }],
    { targetStake: 500 / 1.5 },
  );
  assert.ok(singleHedge.complete);
  assert.equal(singleHedge.levelsUsed, 1);
  assert.equal(formatBlendedHedgeFlag(singleHedge), "");
  assert.equal(blendDidWalk(singleHedge, -200), false);
}

{
  const p104 = americanToImpliedProb(104);
  const profit104 = 54 * (1 - p104) / p104;
  assert.ok(Math.abs(profit104 - stakeToProfit(54, 104)) < 1e-9);
  assert.ok(profit104 < 200);
  assert.ok(stakeToProfit(62, 117) < 80);
  assert.ok(stakeToProfit(62, 117) > 72);
}

console.log("blendAskLadder.test.js ok");
