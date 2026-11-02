import assert from "node:assert/strict";
import { ladderTopLooksRogue, LADDER_TOP_MAX_IMPROVE } from "./promoOppGuard.js";
import { applyPmBlendToLeg, trueOppAmerican } from "./blendAskLadder.js";
import { blendLegToMinDepth } from "./promoMinDepth.js";

// Kevin 2026-10-29 6:23 PM ET: Red Wings ML vs BetMGM −160 showed
// "Best opp +337 on Polymarket" (True −337, Edge +15.6%). The ladder was the
// closed MLB Tigers vs Cubs book (Blackhawks matched to Cubs on "chicago");
// the real Polymarket Blackhawks ask was 41¢ (+134 after the taker fee).
const rogue = [
  { american: 9256, size: 766.45 },
  { american: 4581, size: 10.2 },
  { american: 2244, size: 107.2 },
  { american: 841, size: 20 },
  { american: 530, size: 45 },
  { american: 426, size: 18 },
  { american: 398, size: 76 },
  { american: 218, size: 165 },
];
const leg = {
  sport: "icehockey_nhl",
  game: "Chicago Blackhawks @ Detroit Red Wings",
  name: "Detroit Red Wings ML",
  market: "h2h",
  dk: -160,
  bestOppBook: "polymarket",
  bestOppName: "Chicago Blackhawks ML",
  bestOpp: 134,
  bestOppSize: 14258,
};

assert.equal(LADDER_TOP_MAX_IMPROVE, 0.20);
assert.equal(ladderTopLooksRogue(134, rogue), true, "+9256 top vs +134 quote is another market");
assert.equal(ladderTopLooksRogue(134, [{ american: 426 }]), true, "+426 top vs +134 quote (19% vs 43%)");
assert.equal(ladderTopLooksRogue(134, [{ american: 134 }, { american: 129 }, { american: 124 }]), false, "real book");
assert.equal(ladderTopLooksRogue(134, [{ american: 150 }]), false, "a few cents of drift is fine");
assert.equal(ladderTopLooksRogue(104, [{ american: 200 }]), false, "16 pts of feed lag is tolerated");
assert.equal(ladderTopLooksRogue(152, [{ american: 530 }]), true, "#534 case: +530 top vs real +152");
assert.equal(ladderTopLooksRogue(-150, [{ american: -200 }]), false, "worse than quoted is normal depth");
assert.equal(ladderTopLooksRogue(null, rogue), false, "no quote → no opinion");
assert.equal(ladderTopLooksRogue(134, []), false);

// Texas A&M-CC ML (Kevin 2026-11-02): feed Novig +456 (18%) vs a wrong-game ladder topped at +9900
// (1%). Only 17 points of p, but 22x the odds and a penny top: rogue. Normal longshot drift is not.
assert.equal(ladderTopLooksRogue(456, [{ american: 9900, size: 138 }, { american: 6567, size: 2 }, { american: 3233, size: 1 }]), true, "+9900 top vs +456 quote");
assert.equal(ladderTopLooksRogue(456, [{ american: 4900 }]), true, "2c top vs an 18% quote");
assert.equal(ladderTopLooksRogue(456, [{ american: 426 }, { american: 413 }, { american: -9900 }]), false, "real AMCC book (deep 1c bid is just bad depth)");
assert.equal(ladderTopLooksRogue(456, [{ american: 600 }]), false, "+600 vs +456 is ordinary drift");
assert.equal(ladderTopLooksRogue(5000, [{ american: 6000 }]), false, "a real longshot quote may have a penny-ish top");
assert.equal(ladderTopLooksRogue(-1236, [{ american: -1100 }]), false, "heavy favorite drift is fine");
{
  const amcc = { sport: "basketball_ncaab", game: "Texas A&M-CC Islanders @ Texas State Bobcats", name: "Texas State Bobcats ML", market: "h2h", dk: -535, bestOppBook: "novig", bestOppName: "Texas A&M-CC Islanders ML", bestOpp: 456, bestOppSize: 89 };
  const r = applyPmBlendToLeg(amcc, [{ american: 9900, size: 138.39 }, { american: 6567, size: 2.3 }, { american: 3233, size: 0.75 }, { american: 2400, size: 1 }, { american: 1329, size: 3.41 }, { american: -9900, size: 2441.34 }], { numLegs: 4 });
  const o = trueOppAmerican(r);
  assert.ok(o == null || o <= 456, `Texas State true must not come from the +9900 ladder (got ${o})`);
}

// Rogue ladder → never priced; card keeps the feed quote, Red Wings is not +EV.
const out = applyPmBlendToLeg(leg, rogue, { numLegs: 3 });
const opp = trueOppAmerican(out);
assert.ok(opp <= 134, `opp must not beat the feed quote, got ${opp}`);
assert.notEqual(opp, 337);

// Real ladder (live 6:30 PM ET) still blends normally.
const real = [
  { american: 134, size: 14258 },
  { american: 129, size: 44376 },
  { american: 124, size: 46785 },
];
const ok = applyPmBlendToLeg(leg, real, { numLegs: 3 });
assert.equal(ok.lowLiquidity, false);
assert.equal(trueOppAmerican(ok), 134);

// Owner Min depth path uses the same guard.
const md = blendLegToMinDepth(leg, 2000, rogue, {});
assert.ok(!md || !md.complete || Number(md.american) <= 134, "min depth must not walk the rogue ladder");

console.log("promoRogueLadder ok");
