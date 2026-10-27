import test from "node:test";
import assert from "node:assert/strict";
import { applyMinDepthToLeg, formatMinDepthBlendFlag } from "./promoMinDepth.js";
import { applyPmBlendToLegs, applyMinDepthOverlay, trueOppAmerican, applyPmBlendToLeg } from "./blendAskLadder.js";
import { formatTrueOddsWithBlend } from "./trueOddsLine.js";

// Oct 24 2026 Best Pick: Ravens +7.5, Novig Bengals -7.5 at +336 ($649 to win),
// then +317 ($7,187), +300 ($11,696). Min depth $2,000.
const st = (toWin, am) => (toWin * 100) / am;
const levels = [{ american: 336, size: st(649, 336) }, { american: 317, size: st(7187, 317) }, { american: 300, size: st(11696, 300) }];
const leg = { bestOppBook: "novig", sport: "americanfootball_nfl", game: "Cincinnati Bengals @ Baltimore Ravens", bestOppName: "Cincinnati Bengals -7.5", market: "SPR", bestOpp: 336, dk: -313, bestOppVenues: [] };
const key = [leg.bestOppBook, leg.sport, leg.game, leg.bestOppName, leg.market].join("|");

test("spread leg: true win prob uses the $2,000 blend, not the top level", () => {
  const md = applyMinDepthToLeg(leg, 2000, levels, {});
  assert.equal(md.bestOpp, 323);
  const { displayLegs } = applyPmBlendToLegs([md], { [key]: levels }, { numLegs: 5, promoType: "boost", stake: 100, boostPct: 85 });
  const d = displayLegs[0];
  assert.equal(d.bestOpp, 323);
  assert.equal(trueOppAmerican(d), 323, "Edge / True Win Prob column reads the blend");
  const line = formatTrueOddsWithBlend({ odds: 336, bookLabel: "Novig", levels, blend: d.pmBlend });
  assert.equal(line.odds, 323);
  assert.match(line.text, /^\+323 on Novig · blended to \$2,000 to win \(Novig \+336 \$649, then Novig \+317 \$1,351\)/);
});

test("flag lists each venue walked", () => {
  const f = formatMinDepthBlendFlag({ complete: true, target: 2000, parts: [{ book: "kalshi", american: 150, profit: 500 }, { book: "novig", american: 140, profit: 1500 }] });
  assert.equal(f, "blended to $2,000 to win (Kalshi +150 $500, then Novig +140 $1,500)");
});

test("overlay keeps the $500 walk when it is already more conservative", () => {
  const next = { bestOpp: 300, pmBlend: { american: 300, complete: true } };
  assert.equal(applyMinDepthOverlay(next, { complete: true, american: 323 }), next);
  assert.equal(applyMinDepthOverlay(next, null), next);
});

test("subline path (applyPmBlendToLeg + overlay) shows the same blend", () => {
  const md = applyMinDepthToLeg(leg, 2000, levels, {});
  const b = applyMinDepthOverlay(applyPmBlendToLeg(md, levels, { numLegs: 5 }), md.minDepthBlend);
  assert.equal(trueOppAmerican(b), 323);
});

test("per-venue: overlay moves the hedge to the min-depth venue with that venue's size", () => {
  // $500 walk prefers Kalshi −564 ($4,974 ≈ $882 profit); only Novig −567
  // ($18,261 ≈ $3,220) covers $2,000 alone → the card hedges on Novig.
  const fiu = { dk: 490, bestOppBook: "novig", bestOpp: -567, bestOppQuoted: -567, bestOppSize: 18261, sport: "americanfootball_ncaaf", game: "FIU @ Liberty", name: "FIU ML", bestOppName: "Liberty ML", market: "ML",
    bestOppVenues: [{ book: "prophetx", american: -561, size: 53 }, { book: "kalshi", american: -564, size: 4974 }, { book: "novig", american: -567, size: 18261 }] };
  const md = applyMinDepthToLeg(fiu, 2000, null, {});
  assert.equal(md.bestOppBook, "novig");
  const d = applyPmBlendToLegs([md], {}, { numLegs: 1, promoType: "freebet" }).displayLegs[0];
  assert.equal(d.bestOppBook, "novig");
  assert.equal(d.bestOpp, -567);
  assert.equal(d.bestOppSize, 18261);
  assert.ok(applyMinDepthToLeg(d, 2000, null, {}), "stable on a second pass");
});
