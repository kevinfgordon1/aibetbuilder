
// Sticky sportsbook on tab return: Optimize! / share cardIds must not force the
// Promo book back to Caesars (or any book) when auth TOKEN_REFRESHes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashCardIdForTab,
  shouldApplySharePromoPrefs,
  persistPickFocusInHash,
  encodePromoCardId,
  promoPrefsFromRoute,
} from "./shareCard.js";
import { parseAppHash, serializeAppHash } from "./comboAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

assert.equal(persistPickFocusInHash(), false);

// Simulate: user Optimized on Caesars → cardId baked williamhill_us into the hash.
const caesarsId = encodePromoCardId({
  promoType: "boost",
  book: "williamhill_us",
  stake: 100,
  legs: [{ name: "KC -3.5", market: "spread", game: "KC vs LV" }],
});
assert.match(caesarsId, /^boost\.williamhill_us\./);

// Old bug: writing Optimize focus into the hash made a share-shaped URL.
const stuckHash = serializeAppHash({ tab: "promo", cardId: caesarsId });
assert.equal(parseAppHash(stuckHash).cardId, caesarsId);
const fromStuck = promoPrefsFromRoute(parseAppHash(stuckHash), { promoBook: "draftkings" });
assert.equal(fromStuck.source, "share");
assert.equal(fromStuck.promoBook, "williamhill_us");

// Fix: in-app focus must NOT go into the hash.
assert.equal(
  hashCardIdForTab({ tab: "promo", focusCardId: caesarsId, shareCardId: null }),
  null,
);
assert.equal(serializeAppHash({ tab: "promo", cardId: null }), "#promo");

// Real share: same cardId is owned by shareCardId → stays in the URL, but
// prefs apply only once (TOKEN_REFRESHED must not re-force the book).
assert.equal(
  hashCardIdForTab({ tab: "promo", focusCardId: caesarsId, shareCardId: caesarsId }),
  caesarsId,
);
assert.equal(shouldApplySharePromoPrefs(caesarsId, null), true);
assert.equal(shouldApplySharePromoPrefs(caesarsId, caesarsId), false);

// After the user picks DraftKings, share override is cleared.
assert.equal(
  hashCardIdForTab({ tab: "promo", focusCardId: null, shareCardId: null }),
  null,
);

// App wiring: hash write uses hashCardIdForTab; share prefs gated; profile
// prefs load once per user id; sportsbook onChange clears the sticky share.
assert.match(app, /hashCardIdForTab\(\{ tab: activeTab, focusCardId, shareCardId: shareCardIdRef\.current \}\)/);
assert.match(app, /shouldApplySharePromoPrefs\(resolved\.cardId, sharePrefsAppliedRef\.current\)/);
assert.match(app, /profilePrefsUserRef\.current === user\.id/);
assert.match(app, /\[user && user\.id, authLoading\]/);
assert.doesNotMatch(app, /cardId: \(activeTab === "promo" \|\| activeTab === "ev"\) \? focusCardId : null/);
assert.match(app, /shareCardIdRef\.current = null/);
assert.match(app, /saveProfilePrefs\(user, \{ \.\.\.profilePrefs, promoBook: sanitizePromoBook\(book\) \}/);
assert.match(app, /PROMO_DEFAULT_BOOK = "draftkings"/);
assert.match(app, /useState\(30\)/); // boost %
assert.match(app, /useState\(3\)/); // legs

console.log("promoBookSticky.test.js ok");
