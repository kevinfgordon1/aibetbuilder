// NHL 1+ goal legs in the Promo Builder: they ride the existing Player Props
// market pick (no new Markets option), load with NHL in the sport chips, and
// blend on the stored Kalshi/Polymarket No ladder like TD / HR legs.
import assert from "node:assert/strict";
import * as playerTd from "../lib/player-td.mjs";
import { MARKET_SCOPES, scopePromoLegs, isPlayerPropLeg } from "./promoMarketScope.js";
import { buildOddsQueryPlan, PLAYER_PROP_SPORT_KEYS } from "./oddsLoad.js";
import { applyPmBlendToLeg } from "./blendAskLadder.js";

const { playerTdsFromCacheRows, playerTdLegsForBook } = playerTd;
const NOW = Date.parse("2026-10-06T16:00:00Z");

const nhlRow = {
  event_id: "nhl-1",
  sport: "icehockey_nhl",
  away_team: "Florida Panthers",
  home_team: "Los Angeles Kings",
  commence_time: "2026-10-07T02:00:00Z",
  data: {
    gameKey: "NHL|FLA|LA|2026-10-06",
    players: [{
      name: "Sam Reinhart",
      team: "FLA",
      markets: {
        goal: {
          offers: [{ book: "draftkings", price: 175 }, { book: "fliff", price: 400 }],
          opp: { price: -230, book: "kalshi", count: 1, source: "exchange", size: 3000 },
          opps: [{ price: -230, book: "kalshi", source: "exchange", size: 3000, levels: [{ american: -230, size: 3000 }, { american: -250, size: 5000 }] }],
        },
      },
    }],
  },
};

// No new Markets option: NHL goals are Player Props.
assert.deepEqual(MARKET_SCOPES.map((o) => o.val), ["all", "main", "ml", "alt", "props"]);
assert.ok(PLAYER_PROP_SPORT_KEYS.includes("icehockey_nhl"));
const plan = buildOddsQueryPlan({ mode: "promo", promoSports: new Set(["icehockey_nhl"]), featuredSportKeys: ["baseball_mlb", "icehockey_nhl"] });
assert.equal(plan.includePlayerProps, true);
assert.deepEqual(plan.playerPropSports, ["icehockey_nhl"]);

const legs = playerTdLegsForBook(playerTdsFromCacheRows([nhlRow]), "draftkings", { now: NOW, sportFilter: ["icehockey_nhl"] });
assert.equal(legs.length, 1);
const leg = legs[0];
assert.equal(leg.name, "Sam Reinhart 1+ Goal");
assert.equal(leg.market, "GOAL");
assert.equal(leg.dk, 175, "American odds");
assert.ok(isPlayerPropLeg(leg));
assert.ok(isPlayerPropLeg({ market: "GOAL" }));

const ml = { name: "Los Angeles Kings ML", market: "ML", isAlt: false, game: "Florida Panthers @ Los Angeles Kings", sport: "icehockey_nhl" };
assert.deepEqual(scopePromoLegs([ml, leg], ["props"]).map((l) => l.name), ["Sam Reinhart 1+ Goal"], "Player Props includes NHL goals");
assert.deepEqual(scopePromoLegs([ml, leg], ["main"]).map((l) => l.name), ["Los Angeles Kings ML"], "Main excludes NHL goals");
assert.equal(scopePromoLegs([ml, leg], ["all"]).length, 2);

// Stored No ladder → $500 depth blend runs without a live depth call.
assert.deepEqual(leg.bestOppLevels.map((l) => l.american), [-230, -250]);
const blended = applyPmBlendToLeg(leg, null, {});
assert.ok(blended.pmBlend, "deep NHL goal leg is blended");

console.log("playerGoalPromo.test.js ok");
