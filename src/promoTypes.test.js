import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOGGED_OUT_DEFAULT_PROMO_TYPE,
  SIGNED_IN_DEFAULT_PROMO_TYPE,
  PROMO_TYPE_ORDER,
  effectiveBoostPct,
  isBoostLikePromo,
  isParlayPromoType,
} from "./promoTypes.js";
import { activePromoList, promoPickCardId } from "./promoOptimize.js";
import {
  encodePromoCardId,
  decodePromoCardId,
  buildShareCardModel,
  formatSharePromoType,
  shareCardPromoRule,
  shareCardBottomLine,
  shareCardMetaChips,
} from "./shareCard.js";
import { comboKindForPromo } from "./comboPrefill.js";

assert.equal(LOGGED_OUT_DEFAULT_PROMO_TYPE, "nopromo");
assert.equal(SIGNED_IN_DEFAULT_PROMO_TYPE, "boost");
assert.equal(PROMO_TYPE_ORDER[0], "nopromo");
assert.equal(PROMO_TYPE_ORDER[1], "boost");

assert.equal(effectiveBoostPct("nopromo", 30), 0);
assert.equal(effectiveBoostPct("nopromo", ""), 0);
assert.equal(effectiveBoostPct("boost", 30), 30);
assert.equal(effectiveBoostPct("boost", "25"), 25);
assert.equal(effectiveBoostPct("freebet", 30), 30);

assert.equal(isBoostLikePromo("nopromo"), true);
assert.equal(isBoostLikePromo("boost"), true);
assert.equal(isBoostLikePromo("freebet"), false);
assert.equal(isParlayPromoType("nopromo"), true);
assert.equal(isParlayPromoType("nosweat"), true);
assert.equal(isParlayPromoType("other"), false);

assert.equal(comboKindForPromo("nopromo"), "cash");
assert.equal(comboKindForPromo("boost"), "boost");

const legs = [{ name: "A", game: "A @ B", market: "ML", commence_time: "t" }];
const noId = encodePromoCardId({ promoType: "nopromo", book: "draftkings", stake: 100, legs });
const boostId = encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 100, legs });
assert.notEqual(noId, boostId);
assert.equal(decodePromoCardId(noId).promoType, "nopromo");
assert.equal(promoPickCardId({ legs }, { promoType: "nopromo", book: "draftkings", stake: 100 }), noId);

const picks = activePromoList("nopromo", {
  boost: [{ ev: 1, legs }],
  nopromo: [{ ev: 4, legs }],
  nosweat: [],
  freebet: [],
});
assert.equal(picks[0].ev, 4);
assert.equal(activePromoList("boost", { boost: [{ ev: 1, legs }], nopromo: [{ ev: 4, legs }], nosweat: [], freebet: [] })[0].ev, 1);

assert.equal(formatSharePromoType("nopromo"), "No Promo");
const model = buildShareCardModel({
  promoType: "nopromo",
  bookLabel: "DraftKings",
  ev: 12.5,
  stake: 100,
  odds: "+150",
  parlayOdds: "+150",
  legs,
});
assert.equal(model.promoType, "nopromo");
assert.equal(model.promoLabel, "No Promo");
assert.equal(shareCardPromoRule(model), "No Promo");
assert.match(shareCardBottomLine(model), /Expected profit/);
const chips = shareCardMetaChips(model);
assert.ok(chips.some((c) => c === "DraftKings"));
assert.ok(!chips.some((c) => /w\/ boost/.test(c)));

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
assert.match(app, /val: "nopromo", label: "No Promo"/);
assert.match(app, /LOGGED_OUT_DEFAULT_PROMO_TYPE/);
assert.match(app, /SIGNED_IN_DEFAULT_PROMO_TYPE/);
assert.match(app, /effectiveBoostPct\(promoType, scanBoostPct\)/);
assert.match(app, /effectiveBoostPct\(promoType, boostPct\)/);
assert.match(app, /promoType === "boost" && controlBox/);
assert.match(app, /<label style=\{labelStyle\}>Boost %<\/label>/);
assert.match(app, /isParlayPromoType\(promoType\)/);
assert.match(app, /setScannedNoPromo/);
assert.match(app, /calcParlayEV\(ls, effectiveBoostPct\(promoType, scanBoostPct\), atStake\)/);
assert.doesNotMatch(app, /promoType === "nopromo"[\s\S]{0,80}Boost %/);

console.log("promoTypes.test.js ok");
