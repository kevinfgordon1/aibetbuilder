// Golden ranking for a fixed slate. Stake scaling and UI scheduling must not
// change who ranks first or the EV at a given stake and boost.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { findTopParlaysExact, linearEvForm } from "./promoExactScan.js";
import { diversifyTopParlays, rescaleParlaysForStake } from "./promoParlayScan.js";
import { rankPromoPicks } from "./promoListRank.js";

const require = createRequire(import.meta.url);
const { calcParlayEV } = require("../lib/promo-ev.js");

function leg(name, game, dk, bestOpp) {
  return {
    name,
    game,
    dk,
    bestOpp,
    bestOppBook: "pinnacle",
    market: "ML",
    sport: "basketball_nba",
    bookKey: "draftkings",
    commence_time: "2026-11-12T00:00:00Z",
  };
}

// Five independent games. Prices are fixed so the exact 3-leg order is stable.
const FIXTURE = [
  leg("Alpha ML", "Alpha @ Beta", 120, -130),
  leg("Gamma ML", "Gamma @ Delta", 140, -125),
  leg("Echo ML", "Echo @ Foxtrot", -110, 100),
  leg("Golf ML", "Golf @ Hotel", 180, -150),
  leg("India ML", "India @ Juliet", 105, -115),
];

const STAKE = 100;
const BOOST = 30;

function overlay(p, displayLegs, ctx) {
  const changed = (p.legs || []).some((l, i) => displayLegs[i] && displayLegs[i].bestOpp !== l.bestOpp);
  if (!changed) return p;
  return { ...p, ...calcParlayEV(displayLegs, ctx.boostPct, ctx.stake), legs: displayLegs };
}

function names(p) {
  return p.legs.map((l) => l.name).slice().sort();
}

const form = linearEvForm("boost", STAKE, BOOST);
const calc = (ls) => calcParlayEV(ls, BOOST, STAKE);
const deep = await findTopParlaysExact(FIXTURE, 3, calc, form, { maxResults: 10, yieldFn: () => Promise.resolve() });
const diversified = diversifyTopParlays(deep);
const ranked = rankPromoPicks(
  diversified,
  { promoType: "boost", numLegs: 3, stake: STAKE, boostPct: BOOST, hideLowLiquidity: false, minLegDepth: 0, includeTeamTokens: [], excludeTeamTokens: [] },
  (p) => p,
  overlay,
);

const golden = ranked.slice(0, 3).map((p) => ({
  names: names(p),
  ev: Math.round(p.ev * 100) / 100,
  parlayOdds: p.parlayOdds,
}));

assert.deepEqual(golden, [
  { names: ["Alpha ML", "Gamma ML", "Golf ML"], ev: 46.24, parlayOdds: 1378 },
  { names: ["Gamma ML", "Golf ML", "India ML"], ev: 45.6, parlayOdds: 1278 },
  { names: ["Echo ML", "Gamma ML", "Golf ML"], ev: 45.58, parlayOdds: 1183 },
]);

const doubled = rescaleParlaysForStake(ranked, STAKE, 200);
assert.deepEqual(doubled.slice(0, 3).map(names), golden.map((g) => g.names));
assert.ok(Math.abs(doubled[0].ev - golden[0].ev * 2) < 0.02);

console.log("promoRankingFixture.test.js: ok");
