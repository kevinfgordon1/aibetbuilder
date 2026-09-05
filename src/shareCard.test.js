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

const model = buildShareCardModel({
  kind: "promo",
  badge: "BEST PICK",
  bookLabel: "DraftKings",
  ev: 12.4,
  odds: "+420",
  stake: 100,
  legs: legsA,
});
assert.equal(model.evText, "+$12.40 EV");
assert.equal(model.brand, "AI Bet Builder");
assert.equal(model.legs.length, 2);
assert.match(model.legs[0], /Yankees ML|Dodgers/);
assert.equal(shareCardFilename(model), "aibetbuilder-promo-best-pick.png");
assert.equal(shareCardFilename({ kind: "ev", badge: "+EV" }), "aibetbuilder-ev-ev.png");

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
  assert.doesNotMatch(app, /shouldFetchFullBoard\(\{ tab: \"promo\"/);
  assert.match(locks, /Copy link/);
  assert.match(locks, /comboLockHash|sharePath|#combo/);
}

console.log("shareCard.test.js ok");
