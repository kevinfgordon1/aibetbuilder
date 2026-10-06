import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activePromoList, bestPromoCardId } from "./promoOptimize.js";
import { encodePromoCardId } from "./shareCard.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const leg = (name) => ({
  name,
  dk: 150,
  bestOpp: -160,
  bestOppBook: "kalshi",
  sport: "icehockey_nhl",
  market: "ML",
  game: "A @ B",
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
  assert.equal(bestPromoCardId([], { promoType: "boost", book: "draftkings", stake: 100 }), null);
  assert.equal(bestPromoCardId(null, { promoType: "boost", book: "draftkings", stake: 100 }), null);
}

{
  const app = fs.readFileSync(path.join(here, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/promoOptimize\.js"/);
  assert.match(app, /Optimize!/);
  assert.match(app, /onOptimizePromo|optimizePromo|pendingOptimize/);
  assert.match(app, /bestPromoCardId/);
  // Button sits on the main controls row (Promo Type / Sportsbook / … / Legs), not Filters.
  const controlsStart = app.indexOf('<label style={labelStyle}>Promo Type</label>');
  const filtersStart = app.indexOf('<label style={labelStyle}>Sports</label>');
  const optimizeAt = app.indexOf(">Optimize!</");
  assert.ok(controlsStart > 0 && filtersStart > controlsStart);
  assert.ok(optimizeAt > controlsStart && optimizeAt < filtersStart, "Optimize! must be on the main controls row before Filters");
}

console.log("promoOptimize.test.js: ok");
