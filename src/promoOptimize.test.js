import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activePromoList,
  bestPromoCardId,
  promoPickCardId,
  resolveOptimizeFocusId,
} from "./promoOptimize.js";
import { encodePromoCardId } from "./shareCard.js";
import { findBestAcrossLegCounts, SCAN_MAX_PROMO_LEGS } from "./promoParlayScan.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const leg = (name, game = "A @ B", dk = 150, bestOpp = -160) => ({
  name,
  dk,
  bestOpp,
  bestOppBook: "kalshi",
  sport: "icehockey_nhl",
  market: "ML",
  game,
});

{
  const boost = [{ legs: [leg("A")], ev: 12 }, { legs: [leg("B")], ev: 5 }];
  assert.equal(activePromoList("boost", { boost, nosweat: [], freebet: [] })[0].ev, 12);
  assert.equal(activePromoList("nosweat", { boost, nosweat: [{ legs: [leg("N")] }], freebet: [] })[0].legs[0].name, "N");
  assert.equal(activePromoList("freebet", { boost, nosweat: [], freebet: [{ legs: [leg("F")] }] })[0].legs[0].name, "F");
  assert.deepEqual(activePromoList("boost", { boost: null, nosweat: [], freebet: [] }), []);
}

{
  const list = [{ legs: [leg("Best"), leg("Second")], ev: 20 }, { legs: [leg("Other")], ev: 1 }];
  const id = bestPromoCardId(list, { promoType: "boost", book: "draftkings", stake: 100 });
  assert.equal(id, encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 100, legs: list[0].legs }));
  assert.equal(promoPickCardId(list[0], { promoType: "boost", book: "draftkings", stake: 100 }), id);
  assert.equal(bestPromoCardId([], { promoType: "boost", book: "draftkings", stake: 100 }), null);
  assert.equal(bestPromoCardId(null, { promoType: "boost", book: "draftkings", stake: 100 }), null);
}

{
  const winner = { legs: [leg("W1", "G1 @ G2"), leg("W2", "G3 @ G4")], ev: 30 };
  const other = { legs: [leg("Other")], ev: 1 };
  const list = [other, winner];
  const target = promoPickCardId(winner, { promoType: "boost", book: "draftkings", stake: 100 });
  assert.equal(
    resolveOptimizeFocusId(list, target, { promoType: "boost", book: "draftkings", stake: 100 }),
    target,
    "resolve prefers the exact Optimize winner even when not index 0",
  );
  assert.equal(
    resolveOptimizeFocusId([other], "missing-id", { promoType: "boost", book: "draftkings", stake: 100 }),
    bestPromoCardId([other], { promoType: "boost", book: "draftkings", stake: 100 }),
    "falls back to Best Pick when winner not in list",
  );
  assert.equal(resolveOptimizeFocusId([], target, { promoType: "boost", book: "draftkings", stake: 100 }), null);
}

{
  // Synthetic EV: longer parlays score higher so Optimize must pick max legs.
  const calc = (ls) => ({
    ev: ls.length * 10 + (ls[0]?.dk || 0) / 1000,
    parlayOdds: 100 * ls.length,
    boostedProfit: 0,
  });
  const pool = [
    leg("A", "G1 @ G2", 110, -120),
    leg("B", "G3 @ G4", 120, -125),
    leg("C", "G5 @ G6", 130, -130),
    leg("D", "G7 @ G8", 140, -135),
    leg("E", "G9 @ G10", 150, -140),
  ];
  const best = await findBestAcrossLegCounts(pool, calc, {
    maxLegs: 4,
    yieldMs: 0,
    growFrom3Seeds: 10,
  });
  assert.ok(best, "cross-leg optimize returns a winner");
  assert.equal(best.numLegs, 4, "highest EV across 1..4 is the 4-leg (synthetic calc)");
  assert.equal(best.pick.legs.length, 4);
  assert.equal(SCAN_MAX_PROMO_LEGS, 10);
}

{
  // 1-leg dominates when its EV is highest.
  const calc = (ls) => ({
    ev: ls.length === 1 ? 100 : ls.length,
    parlayOdds: 100,
    boostedProfit: 0,
  });
  const pool = [
    leg("Solo", "G1 @ G2", 200, -150),
    leg("B", "G3 @ G4", 110, -120),
    leg("C", "G5 @ G6", 120, -125),
  ];
  const best = await findBestAcrossLegCounts(pool, calc, { maxLegs: 3, yieldMs: 0 });
  assert.equal(best.numLegs, 1);
  assert.equal(best.pick.legs[0].name, "Solo");
}

{
  const app = fs.readFileSync(path.join(here, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/promoOptimize\.js"/);
  assert.match(app, /findBestAcrossLegCounts/);
  assert.match(app, /onOptimizePromo|optimizePromo|pendingOptimize/);
  assert.match(app, /setNumLegs\(result\.numLegs\)/);
  assert.match(app, /resolveOptimizeFocusId/);
  assert.match(app, /promoPickCardId/);
  assert.match(app, /across_legs:\s*true/);
  // Button sits on the main controls row (Promo Type / Sportsbook / … / Legs), not Filters.
  const controlsStart = app.indexOf('<label style={labelStyle}>Promo Type</label>');
  const filtersStart = app.indexOf('<label style={labelStyle}>Sports</label>');
  const optimizeBtn = app.indexOf('optimizeBusy ? "Optimizing…" : "Optimize!"');
  assert.ok(controlsStart > 0 && filtersStart > controlsStart);
  assert.ok(optimizeBtn > controlsStart && optimizeBtn < filtersStart, "Optimize! must be on the main controls row before Filters");
  assert.match(app, /Search 1–10 legs for the highest EV bet/);
}

console.log("promoOptimize.test.js: ok");
