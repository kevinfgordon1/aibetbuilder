import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { calcFreeBetParlayEV } from "./promoFreeBet.js";
import { calcNoSweatEV } from "./promoNoSweat.js";
import { applyBlendToLegs, depthCacheKey } from "./promoBookDepth.js";
import { overlayBlendedParlay, rankPromoPicks, visiblePromoAfterDepth } from "./promoListRank.js";

const require = createRequire(import.meta.url);
const { calcParlayEV, ourTrueProb, dkDecimal, decimalToAmerican } = require("../lib/promo-ev.js");

function calcNoSweatFromLegs(legs, stake, refundPct, conversionPct) {
  let parlayDec = 1;
  let combinedProb = 1;
  for (const l of legs) {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  }
  const ns = calcNoSweatEV({ stake, decimal: parlayDec, p: combinedProb, refundPct, conversionPct });
  return { parlayDec, combinedProb, parlayOdds: decimalToAmerican(parlayDec), ...ns };
}

const calcs = { calcNoSweatFromLegs, calcFreeBetParlayEV, calcParlayEV };

function overlayParlayMetrics(p, displayLegs, ctx) {
  return overlayBlendedParlay(p, displayLegs, ctx, calcs);
}

function bookLeg(over) {
  return {
    dk: -110,
    bestOpp: 100,
    bestOppBook: "pinnacle",
    bestOppSize: null,
    sport: "baseball_mlb",
    market: "ML",
    game: "Companion",
    name: "Companion",
    bestOppName: "Other",
    ...over,
  };
}

// Thin top +200 fills $500 by itself (large bestOppSize). The real ladder
// only has $15 there and the rest at +102, so the depth blend cuts true prob.
const thinKalshi = {
  dk: 150,
  bestOpp: 200,
  bestOppBook: "kalshi",
  bestOppSize: 5000,
  sport: "baseball_mlb",
  market: "ML",
  game: "Cincinnati Reds @ Atlanta Braves",
  name: "Cincinnati Reds ML",
  bestOppName: "Atlanta Braves ML",
};
const steadyBook = {
  dk: 150,
  bestOpp: 120,
  bestOppBook: "pinnacle",
  bestOppSize: null,
  sport: "baseball_mlb",
  market: "ML",
  game: "St. Louis Cardinals @ Pittsburgh Pirates",
  name: "St. Louis Cardinals ML",
  bestOppName: "Pittsburgh Pirates ML",
};
const worseBook = {
  ...steadyBook,
  bestOpp: -110,
  game: "Tampa Bay Rays @ New York Yankees",
  name: "Tampa Bay Rays ML",
  bestOppName: "New York Yankees ML",
};

function parlay(id, lead, tag, promoType) {
  const legs = [
    lead,
    bookLeg({ game: `${tag} companion A`, name: `${tag} A` }),
    bookLeg({ game: `${tag} companion B`, name: `${tag} B` }),
  ];
  const ctx = ctxFor(promoType);
  const metrics = promoType === "nosweat"
    ? calcNoSweatFromLegs(legs, ctx.stake, ctx.refundPct, ctx.creditConversionPct)
    : promoType === "freebet"
      ? calcFreeBetParlayEV(legs, ctx.stake)
      : calcParlayEV(legs, ctx.boostPct, ctx.stake);
  return { id, legs, ...metrics };
}

const ladders = {
  [depthCacheKey(thinKalshi)]: [
    { american: 200, size: 15 },
    { american: 102, size: 20000 },
  ],
};

const ctxFor = (promoType) => ({
  promoType,
  numLegs: 3,
  stake: 100,
  boostPct: 0,
  refundPct: 100,
  creditConversionPct: 70,
  hideLowLiquidity: true,
  includeTeamTokens: [],
  excludeTeamTokens: [],
});

function rankPage(ctx) {
  return (head, laddersByKey) => rankPromoPicks(head, ctx, (p) => p, overlayParlayMetrics, laddersByKey);
}

function assertPostBlendOrder(promoType) {
  const ctx = ctxFor(promoType);
  const raw = [parlay("A", thinKalshi, "A", promoType), parlay("B", steadyBook, "B", promoType), parlay("C", worseBook, "C", promoType)];
  const base = rankPromoPicks(raw, ctx, (p) => p, overlayParlayMetrics, {});
  assert.equal(base[0].id, "A", `${promoType}: top-of-book still ranks the thin price first`);
  assert.ok(base[0].ev > base[1].ev, `${promoType}: A starts above B`);

  const waiting = visiblePromoAfterDepth(base, 2, null, rankPage(ctx));
  assert.deepEqual(waiting.visible.map((p) => p.id), ["A", "B"], `${promoType}: before depth, page order matches top-of-book EV`);
  assert.equal(waiting.rest[0].id, "C");

  const page = visiblePromoAfterDepth(base, 5, ladders, rankPage(ctx));
  assert.equal(page.visible[0].id, "B", `${promoType}: BEST PICK slot follows the post-blend EV`);
  assert.ok(page.visible[0].ev > page.visible.find((p) => p.id === "A").ev, `${promoType}: blend dropped A below B`);
  for (let i = 1; i < page.visible.length; i++) {
    assert.ok(page.visible[i - 1].ev >= page.visible[i].ev, `${promoType}: visible list sorted by displayed EV`);
  }
  for (const p of page.visible) {
    const { displayLegs } = applyBlendToLegs(p.legs, ladders, { ...ctx, numLegs: p.legs.length });
    const view = overlayParlayMetrics(p, displayLegs, ctx);
    assert.equal(view.ev, p.ev, `${promoType}: card EV matches the sort key after the same ladder blend`);
  }

  const window = visiblePromoAfterDepth(base, 2, ladders, rankPage(ctx));
  assert.deepEqual(window.visible.map((p) => p.id), ["B", "A"]);
  assert.equal(window.rest[0].id, "C", "picks below the page stay put until Show more");
  assert.equal(window.visible[0].id, "B");
}

assertPostBlendOrder("freebet");
assertPostBlendOrder("boost");
assertPostBlendOrder("nosweat");

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /visiblePromoAfterDepth\(/);
  assert.match(app, /usePromoPageLadders\(/);
  assert.equal((app.match(/promoDepthRank\.visible\.map/g) || []).length, 3);
  assert.equal((app.match(/ladders=\{pageLadders\}/g) || []).length, 3);
  assert.doesNotMatch(app, /live=\{i === 0 \|\| isExpanded\}/);
  assert.match(app, /i === 0 \? "BEST PICK"/);
  assert.match(app, /i === 0 \? \(showLock \? "BEST CONVERSION" : "BEST PICK"\)/);
  assert.match(app, /i === 0 \? "★ Best Pick"/);
  assert.match(app, /i === 0 \? \(showLock \? "★ Best Conversion" : "★ Best Pick"\)/);
  assert.match(app, /rankPromoPicks\([\s\S]*?overlayParlayMetrics/);
}

console.log("promoListRank.test.js ok");
