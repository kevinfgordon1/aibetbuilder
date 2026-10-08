
// Sticky sportsbook on full Refresh / tab return: leftover Optimize! cardIds
// in the hash must not force Caesars (or any book) over Profile defaults.
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
  markPendingShareCard,
  consumePendingShareCard,
  PENDING_SHARE_CARD_KEY,
} from "./shareCard.js";
import { parseAppHash, serializeAppHash } from "./comboAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");
const shareApi = fs.readFileSync(path.join(__dirname, "..", "api", "share.js"), "utf8");

assert.equal(persistPickFocusInHash(), false);

const caesarsId = encodePromoCardId({
  promoType: "boost",
  book: "williamhill_us",
  stake: 100,
  legs: [{ name: "KC -3.5", market: "spread", game: "KC vs LV" }],
});
assert.match(caesarsId, /^boost\.williamhill_us\./);

// Leftover Optimize! hash still *decodes* as a share-shaped route…
const stuckHash = serializeAppHash({ tab: "promo", cardId: caesarsId });
assert.equal(parseAppHash(stuckHash).cardId, caesarsId);
const fromStuck = promoPrefsFromRoute(parseAppHash(stuckHash), { promoBook: "draftkings" });
assert.equal(fromStuck.source, "share");
assert.equal(fromStuck.promoBook, "williamhill_us");

// …but without the /s/ pending marker we must NOT apply those prefs.
assert.equal(shouldApplySharePromoPrefs(caesarsId, null, { intentional: false }), false);
assert.equal(shouldApplySharePromoPrefs(caesarsId, null, { intentional: true }), true);
assert.equal(shouldApplySharePromoPrefs(caesarsId, caesarsId, { intentional: true }), false);

// In-app focus / share cardIds never stay in the hash (Refresh → Profile book).
assert.equal(
  hashCardIdForTab({ tab: "promo", focusCardId: caesarsId, shareCardId: null }),
  null,
);
assert.equal(
  hashCardIdForTab({ tab: "promo", focusCardId: caesarsId, shareCardId: caesarsId }),
  null,
  "even an intentional share cardId is stripped after load so Refresh is clean",
);
assert.equal(serializeAppHash({ tab: "promo", cardId: null }), "#promo");

// /s/ landing marks pending; consume once → Refresh cannot re-apply.
const mem = {
  _d: Object.create(null),
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
assert.equal(markPendingShareCard(caesarsId, mem), true);
assert.equal(mem.getItem(PENDING_SHARE_CARD_KEY), caesarsId);
assert.equal(consumePendingShareCard(caesarsId, mem), true);
assert.equal(consumePendingShareCard(caesarsId, mem), false, "second Refresh has no marker");

// App wiring
assert.match(app, /consumePendingShareCard\(resolved\.cardId\)/);
assert.match(app, /shouldApplySharePromoPrefs\(resolved\.cardId, sharePrefsAppliedRef\.current, \{ intentional \}\)/);
assert.match(app, /hashCardIdForTab\(\{ tab: activeTab, focusCardId, shareCardId: shareCardIdRef\.current \}\)/);
assert.match(app, /profilePrefsUserRef\.current === user\.id/);
assert.match(app, /\[user && user\.id, authLoading\]/);
assert.match(app, /shareCardIdRef\.current = null/);
assert.match(app, /saveProfilePrefs\(user, \{ \.\.\.profilePrefs, promoBook: sanitizePromoBook\(book\) \}/);
assert.match(app, /PROMO_DEFAULT_BOOK = "draftkings"/);
assert.match(app, /useState\(30\)/);
assert.match(app, /useState\(3\)/);
assert.match(shareApi, /aibetbuilder\.pendingShareCard/);

console.log("promoBookSticky.test.js ok");
