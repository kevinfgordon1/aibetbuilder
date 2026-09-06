import assert from "node:assert/strict";
import {
  TARGET_PAYOUT_USD,
  LOW_LIQUIDITY_LABEL,
  blendAskLadderToPayout,
  blendAskLadderToStake,
  formatBlendedPayoutFlag,
  americanToImpliedProb,
  requiredBoostHedgeStake,
  requiredFreeBetHedgeStake,
  requiredNoSweatHedgeStake,
  boostedProfitFromLeg,
  applyPmBlendToLeg,
  applyPmBlendToLegs,
  preferCompletePmHedge,
  isPmBlendVenue,
} from "./blendAskLadder.js";

assert.equal(TARGET_PAYOUT_USD, 1000);
assert.equal(LOW_LIQUIDITY_LABEL, "Low liquidity");
assert.equal(isPmBlendVenue("kalshi"), true);
assert.equal(isPmBlendVenue("pinnacle"), false);
assert.equal(isPmBlendVenue("draftkings"), false);

// ── Kevin: $100 stake, +200 boosted 100% → $400 win; opp −200 needs $333.33
{
  const stake = 100;
  const profit = boostedProfitFromLeg({ dk: 200 }, stake, 100);
  assert.ok(Math.abs(profit - 400) < 1e-9);
  const H = requiredBoostHedgeStake(stake, profit, -200);
  assert.ok(Math.abs(H - 500 / 1.5) < 1e-9);
  assert.ok(Math.abs(H - 333.333333) < 1e-4);

  const full = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 400 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(full.lowLiquidity, false, "full book covers $333.33 hedge");
  assert.equal(full.bestOpp, -200);
  assert.equal(full.pmBlend.mode, "hedge");
  assert.ok(full.pmBlend.complete);
  assert.match(full.pmBlend.flag, /blended to \$333\.33 hedge/);

  const short = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "novig", bestOppSize: 100 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(short.lowLiquidity, true, "top-only $100 cannot fund $333.33 hedge");
  assert.equal(short.bestOpp, -200);
  assert.ok(Math.abs(short.pmBlend.stakeFilled - 100) < 1e-6);
  assert.match(short.pmBlend.flag, /of \$333\.33 hedge available/);

  const pxShort = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "prophetx", bestOppSize: 80 },
    null,
    { promoType: "boost", numLegs: 1, stake, boostPct: 100 },
  );
  assert.equal(pxShort.lowLiquidity, true, "ProphetX top-only shortfall flags");
}

// 1-leg walk VWAP uses hedge $, not the thin top (and not $1,000 payout)
{
  const walked = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 100 },
    [
      { american: -200, size: 100 },
      { american: -250, size: 300 },
    ],
    { promoType: "boost", numLegs: 1, stake: 100, boostPct: 100 },
  );
  assert.equal(walked.lowLiquidity, false);
  assert.equal(walked.bestOppQuoted, -200);
  assert.notEqual(walked.bestOpp, -200, "VWAP to $333.33 walks into −250");
  assert.equal(walked.pmBlend.mode, "hedge");
  assert.ok(walked.pmBlend.complete);
}

// 1-leg no-sweat: H = (winProfit + stake − creditValue) / d_h
{
  const H = requiredNoSweatHedgeStake(100, 100, 70, -200);
  assert.ok(Math.abs(H - 130 / 1.5) < 1e-9);
}

// 1-leg free bet: H = (d_fb − 1) × FB / d_h
{
  const H = requiredFreeBetHedgeStake(200, -200, 100);
  assert.ok(Math.abs(H - 200 / 1.5) < 1e-9);
  const short = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "polymarket", bestOppSize: 50 },
    null,
    { promoType: "freebet", numLegs: 1, stake: 100 },
  );
  assert.equal(short.lowLiquidity, true);
  assert.equal(short.pmBlend.mode, "hedge");
}

// ── multi-leg still uses $1,000 payout (not the hedge $)
{
  const multi = applyPmBlendToLeg(
    { dk: 200, bestOpp: -200, bestOppBook: "kalshi", bestOppSize: 400 },
    null,
    { promoType: "boost", numLegs: 2, stake: 100, boostPct: 100 },
  );
  assert.equal(multi.pmBlend.mode, "payout");
  // face at −200: 400 / (200/300) = 600 < 1000
  assert.equal(multi.lowLiquidity, true);
  assert.match(multi.pmBlend.flag, /of \$1,000 payout available/);

  const deep = applyPmBlendToLeg(
    { dk: -110, bestOpp: 100, bestOppBook: "kalshi", bestOppSize: 600 },
    [{ american: 100, size: 600 }],
    { promoType: "boost", numLegs: 3, stake: 100, boostPct: 30 },
  );
  assert.equal(deep.lowLiquidity, false);
  assert.equal(deep.pmBlend.flag, "blended to $1,000 payout");
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

// ── Profit Boost EV uses blended American, not the thin top
{
  function calcParlayEV(legs, boostPct, stake) {
    const dkDecimal = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
    const trueProb = (o) => (o < 0 ? Math.abs(o) / (Math.abs(o) + 100) : 100 / (o + 100));
    const ourTrue = (o) => 1 - trueProb(o);
    let parlayDec = 1;
    let combinedProb = 1;
    legs.forEach((l) => {
      parlayDec *= dkDecimal(l.dk);
      combinedProb *= ourTrue(l.bestOpp);
    });
    const boostedProfit = (parlayDec - 1) * stake * (1 + boostPct / 100);
    return (combinedProb * boostedProfit) - ((1 - combinedProb) * stake);
  }
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
  assert.equal(displayLegs[0].bestOpp, 122, "boost path uses VWAP not +200 top");
  const evTop = calcParlayEV([{ ...raw, bestOpp: 200 }], 30, 100);
  const evBlend = calcParlayEV(displayLegs, 30, 100);
  assert.notEqual(evBlend, evTop);
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

// ── known $1,000-payout ladder (multi-leg helper)
{
  const blend = blendAskLadderToPayout([
    { american: 200, size: 100 },
    { american: 100, size: 400 },
  ]);
  assert.equal(blend.american, 122);
  assert.equal(blend.complete, true);
  assert.equal(blend.flag, "blended to $1,000 payout");
  assert.equal(formatBlendedPayoutFlag(blend), "blended to $1,000 payout");
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
  assert.equal(short.flag, "blended · $125 of $1,000 payout available");
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
}

{
  const p104 = americanToImpliedProb(104);
  const face1 = 54 / p104;
  assert.ok(face1 < 200);
}

console.log("blendAskLadder.test.js ok");
