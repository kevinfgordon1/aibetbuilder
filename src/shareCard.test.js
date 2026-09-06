import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fnv1a36,
  promoLegsKey,
  encodePromoCardId,
  decodePromoCardId,
  encodeEvCardId,
  sharePath,
  absoluteShareUrl,
  shareCardFilename,
  buildShareCardModel,
  formatShareMarket,
  formatShareLeg,
  formatSharePromoType,
  shareCardPromoRule,
  shareCardMetaChips,
  shareCardDimensions,
  shareCardHeadline,
  shareCardSubline,
  shareCardBottomLine,
  paintShareCard,
} from "./shareCard.js";
import {
  parseAppHash,
  serializeAppHash,
  resolveAppHash,
  tabHash,
  comboLockHash,
  profileHash,
  clearComboHash,
  hashesEqual,
  OWNER_EMAIL,
} from "./comboAccess.js";

assert.equal(fnv1a36("a"), fnv1a36("a"));
assert.notEqual(fnv1a36("a"), fnv1a36("b"));

const legsA = [
  { game: "NYY @ BOS", name: "Yankees ML", market: "Moneyline", commence_time: "2026-09-06T17:00:00Z" },
  { game: "LAD @ SF", name: "Dodgers -1.5", market: "Spread", commence_time: "2026-09-06T20:00:00Z" },
];
const legsB = [...legsA].reverse();
assert.equal(promoLegsKey(legsA), promoLegsKey(legsB));

const id1 = encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 100, legs: legsA });
const id2 = encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 100, legs: legsB });
assert.equal(id1, id2);
assert.match(id1, /^boost\.draftkings\.100\.[a-z0-9]+$/);

assert.notEqual(
  encodePromoCardId({ promoType: "boost", book: "fanduel", stake: 100, legs: legsA }),
  id1,
);
assert.notEqual(
  encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 50, legs: legsA }),
  id1,
);
assert.notEqual(
  encodePromoCardId({ promoType: "nosweat", book: "draftkings", stake: 100, legs: legsA }),
  id1,
);
assert.notEqual(
  encodePromoCardId({ promoType: "boost", book: "draftkings", stake: 100, legs: legsA.slice(0, 1) }),
  id1,
);

const decoded = decodePromoCardId(id1);
assert.deepEqual(decoded, { promoType: "boost", book: "draftkings", stake: 100, hash: id1.split(".").pop() });
assert.equal(decodePromoCardId("nope"), null);
assert.equal(decodePromoCardId(""), null);

const evA = { bookKey: "fanduel", name: "Chiefs ML", market: "Moneyline", game: "KC @ BUF", commence_time: "2026-09-07T17:00:00Z" };
const evId = encodeEvCardId(evA);
assert.equal(evId, encodeEvCardId({ ...evA }));
assert.notEqual(evId, encodeEvCardId({ ...evA, bookKey: "draftkings" }));
assert.notEqual(evId, encodeEvCardId({ ...evA, name: "Bills ML" }));
assert.match(evId, /^fanduel\.[a-z0-9]+$/);

assert.equal(sharePath({ tab: "promo" }), "/s/promo");
assert.equal(sharePath({ tab: "promo", cardId: id1 }), "/s/promo/" + encodeURIComponent(id1));
assert.equal(sharePath({ tab: "combo", lockId: "p1" }), "/s/combo/p1");
assert.equal(absoluteShareUrl({ origin: "https://aibetbuilder.io", tab: "ev", cardId: evId }), "https://aibetbuilder.io/s/ev/" + encodeURIComponent(evId));

assert.equal(formatShareMarket("SPR"), "Spread");
assert.equal(formatShareMarket("ML"), "Moneyline");
assert.equal(formatShareMarket("TOT"), "Total");
assert.equal(formatShareMarket("TT"), "Team Total");
assert.equal(formatShareMarket("Moneyline"), "Moneyline");
assert.equal(formatSharePromoType("boost"), "Profit Boost");
assert.equal(formatSharePromoType("nosweat"), "No Sweat");
assert.equal(formatSharePromoType("freebet"), "Free Bet");

const sprLeg = formatShareLeg({
  name: "Notre Dame Fighting Irish -20.5",
  market: "SPR",
  game: "Wisconsin Badgers @ Notre Dame Fighting Irish",
  dk: -110,
});
assert.equal(sprLeg.name, "Notre Dame Fighting Irish -20.5");
assert.equal(sprLeg.market, "Spread");
assert.equal(sprLeg.game, "Wisconsin Badgers @ Notre Dame Fighting Irish");
assert.equal(sprLeg.odds, "-110");
assert.doesNotMatch(sprLeg.name + sprLeg.market + sprLeg.game, /— SPR ·/);

const model = buildShareCardModel({
  kind: "promo",
  badge: "BEST PICK",
  promoType: "boost",
  bookLabel: "DraftKings",
  ev: 12.4,
  evPct: 12.4,
  odds: "+817",
  parlayOdds: "+650",
  stake: 100,
  boostPct: 30,
  legs: [
    { name: "Yankees ML", market: "ML", game: "NYY @ BOS", dk: -120 },
    { name: "Dodgers -1.5", market: "SPR", game: "LAD @ SF", dk: -110 },
  ],
});
assert.equal(model.evText, "+$12.40 EV");
assert.equal(model.evPctText, "+12.4%");
assert.equal(model.promoLabel, "Profit Boost");
assert.equal(model.promoRule, "30% Profit Boost");
assert.equal(model.brand, "AI Bet Builder");
assert.equal(model.legs.length, 2);
assert.equal(model.legs[0].name, "Yankees ML");
assert.equal(model.legs[0].market, "Moneyline");
assert.equal(model.legs[1].market, "Spread");
assert.ok(shareCardMetaChips(model).includes("DraftKings"));
assert.ok(shareCardMetaChips(model).includes("2 legs"));
assert.ok(shareCardMetaChips(model).includes("$100 stake"));
assert.ok(shareCardMetaChips(model).includes("+817 w/ boost"));
assert.ok(shareCardMetaChips(model).some((c) => /Parlay \+650/.test(c)));
assert.equal(shareCardFilename(model), "aibetbuilder-promo-best-pick.png");
assert.equal(shareCardFilename({ kind: "ev", badge: "+EV" }), "aibetbuilder-ev-ev.png");
assert.equal(shareCardDimensions(model).width, 1200);
assert.equal(shareCardDimensions(model).height, 630);

const ns = buildShareCardModel({
  kind: "promo",
  promoType: "nosweat",
  bookLabel: "FanDuel",
  ev: 8.2,
  stake: 50,
  refundPct: 100,
  creditConversionPct: 70,
  refund: 50,
  creditValue: 35,
  odds: "+210",
  legs: legsA,
});
assert.equal(ns.promoRule, "No Sweat · 100% refund · credit as 70% cash");
assert.equal(shareCardHeadline(ns), "No Sweat");
assert.equal(shareCardSubline(ns), "100% refund · credit as 70% cash");
assert.match(shareCardBottomLine(ns), /If it loses/);
assert.ok(shareCardMetaChips(ns).some((c) => /credit ≈ \$35/.test(c)));

const fb = buildShareCardModel({
  kind: "promo",
  promoType: "freebet",
  stake: 25,
  odds: "+340",
  conversionRate: 0.72,
  guaranteedCash: 18,
  legs: legsA.slice(0, 1),
});
assert.equal(fb.promoLabel, "Free Bet");
assert.ok(shareCardMetaChips(fb).includes("$25 free bet"));
assert.ok(shareCardMetaChips(fb).some((c) => /72\.0% conversion/.test(c)));

const evModel = buildShareCardModel({
  kind: "ev",
  badge: "+EV",
  bookLabel: "FanDuel",
  ev: 6.5,
  odds: "+150",
  title: "Chiefs ML",
  market: "ML",
  trueProb: 0.44,
  implied: 0.4,
  edge: 0.04,
  legs: [{ name: "Chiefs ML", market: "ML", game: "KC @ BUF", dk: 150 }],
});
assert.equal(evModel.promoType, null);
assert.equal(evModel.promoLabel, "");
assert.equal(shareCardPromoRule(evModel), "");
assert.equal(shareCardHeadline(evModel), "Chiefs ML");
assert.ok(!shareCardMetaChips(evModel).some((c) => /Profit Boost|No Sweat|Free Bet/.test(c)));
assert.equal(evModel.legs[0].market, "Moneyline");
assert.ok(shareCardDimensions(evModel).height >= 630);

{
  const texts = [];
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineWidth: 1,
    strokeStyle: "",
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    measureText(t) { return { width: String(t).length * 8 }; },
    fillText(t) { texts.push(String(t)); },
  };
  paintShareCard(ctx, model, 1200, 630);
  const blob = texts.join("\n");
  assert.match(blob, /AI Bet Builder/);
  assert.match(blob, /BEST PICK/);
  assert.match(blob, /30% Profit Boost/);
  assert.match(blob, /Yankees ML/);
  assert.match(blob, /Moneyline|Spread/);
  assert.doesNotMatch(blob, /Powered by Claude/);
  assert.doesNotMatch(blob, /— SPR ·/);
}

assert.deepEqual(parseAppHash("#promo"), { tab: "promo", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#promo/" + id1), { tab: "promo", lockId: null, cardId: id1 });
assert.deepEqual(parseAppHash("#ev"), { tab: "ev", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#ev/" + evId), { tab: "ev", lockId: null, cardId: evId });
assert.deepEqual(parseAppHash("#odds"), { tab: "odds", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#missTape"), { tab: "missTape", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#miss"), { tab: "missTape", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#unhedged"), { tab: "unhedged", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#profile"), { tab: "profile", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#combo"), { tab: "combo", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#combo/lock-1"), { tab: "combo", lockId: "lock-1", cardId: null });
assert.deepEqual(parseAppHash(""), { tab: null, lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#unknown"), { tab: null, lockId: null, cardId: null });

assert.equal(serializeAppHash({ tab: "promo" }), "#promo");
assert.equal(serializeAppHash({ tab: "promo", cardId: id1 }), "#promo/" + encodeURIComponent(id1));
assert.equal(serializeAppHash({ tab: "ev", cardId: evId }), "#ev/" + encodeURIComponent(evId));
assert.equal(serializeAppHash({ tab: "odds" }), "#odds");
assert.equal(serializeAppHash({ tab: "missTape" }), "#missTape");
assert.equal(serializeAppHash({ tab: "unhedged" }), "#unhedged");
assert.equal(comboLockHash("p1"), "#combo/p1");
assert.equal(profileHash(), "#profile");
assert.equal(tabHash("promo", { cardId: "x" }), "#promo/x");
assert.equal(serializeAppHash(parseAppHash("#promo/" + id1)), "#promo/" + encodeURIComponent(id1));
assert.equal(serializeAppHash(parseAppHash("#combo/lock-1")), "#combo/lock-1");
assert.equal(clearComboHash("#combo/p1"), "");
assert.equal(clearComboHash("#promo"), "#promo");
assert.equal(hashesEqual("#promo/" + id1, { tab: "promo", cardId: id1 }), true);

const kevin = { id: "k", email: OWNER_EMAIL };
const stranger = { id: "u2", email: "stranger@gmail.com" };

{
  const open = resolveAppHash(parseAppHash("#combo/secret-1"), kevin);
  assert.equal(open.tab, "combo");
  assert.equal(open.lockId, "secret-1");
  assert.equal(open.allowed, true);
  assert.equal(open.notice, null);
}
{
  const denied = resolveAppHash(parseAppHash("#combo/secret-1"), stranger);
  assert.equal(denied.tab, "promo");
  assert.equal(denied.lockId, null);
  assert.equal(denied.cardId, null);
  assert.equal(denied.allowed, false);
  assert.equal(denied.notice, "noaccess");
}
{
  const signedOut = resolveAppHash(parseAppHash("#combo/secret-1"), null);
  assert.equal(signedOut.tab, "promo");
  assert.equal(signedOut.lockId, null);
  assert.equal(signedOut.notice, "signin");
}
{
  const miss = resolveAppHash(parseAppHash("#missTape"), stranger);
  assert.equal(miss.tab, "promo");
  assert.equal(miss.notice, "noaccess");
  assert.equal(resolveAppHash(parseAppHash("#unhedged"), kevin).tab, "unhedged");
}
{
  const prof = resolveAppHash(parseAppHash("#profile"), null);
  assert.equal(prof.tab, "promo");
  assert.equal(prof.notice, "signin");
}
{
  const promo = resolveAppHash(parseAppHash("#promo/" + id1), null);
  assert.equal(promo.tab, "promo");
  assert.equal(promo.cardId, id1);
  assert.equal(promo.allowed, true);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.match(app, /ShareCardActions/);
  assert.match(app, /encodePromoCardId/);
  assert.match(app, /encodeEvCardId/);
  assert.match(app, /resolveAppHash/);
  assert.match(app, /serializeAppHash/);
  assert.match(app, /id=\{\"pick-\" \+ promoId\}/);
  assert.match(app, /id=\{\"ev-\" \+ evId\}/);
  assert.match(app, /routeNotice/);
  assert.match(app, /promoType: \"boost\"/);
  assert.match(app, /promoType: \"nosweat\"/);
  assert.match(app, /promoType: \"freebet\"/);
  assert.match(app, /boostPct,/);
  assert.match(app, /refundPct,/);
  const shareSrc = fs.readFileSync(path.join(dir, "shareCard.js"), "utf8");
  assert.doesNotMatch(shareSrc, /Powered by Claude/);
  assert.doesNotMatch(app, /shouldFetchFullBoard\(\{ tab: \"promo\"/);
  assert.match(locks, /Copy link/);
  assert.match(locks, /comboLockHash|sharePath|#combo/);
}

console.log("shareCard.test.js ok");
