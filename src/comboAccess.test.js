import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNER_EMAIL,
  COMBO_LOCKS_ALLOWLIST_ENV,
  UNDERDOG_PREDICT_ALLOWLIST_ENV,
  UNDERDOG_PREDICT_ALLOWLIST_ENV_ALT,
  parseComboLocksAllowlist,
  comboLocksAllowlist,
  canSeeComboLocks,
  canSeeOwnerTools,
  canSeeNewOddsBoard,
  canSeeUnderdogPredict,
  KENNETH_GUIDO_EMAIL,
  underdogPredictAllowlist,
  visibleTrustedBookKeys,
  visiblePromoBooks,
  matchingKeysVisibleToUser,
  profileShowsComboPnl,
  parseAppHash,
  comboLockHash,
  profileHash,
  clearComboHash,
  serializeAppHash,
  resolveAppHash,
} from "./comboAccess.js";
import { visibleBetstampBooks, visibleBetstampBookIds, UNDERDOG_PREDICT_BOOK_ID, UNDERDOG_PREDICT_BOOK_KEY, BETSTAMP_TRIAL_BOOKS } from "./betstampBooks.js";

assert.equal(OWNER_EMAIL, "kev120909@gmail.com");
assert.equal(COMBO_LOCKS_ALLOWLIST_ENV, "VITE_COMBO_LOCKS_ALLOWLIST");
assert.equal(UNDERDOG_PREDICT_ALLOWLIST_ENV, "VITE_UNDERDOG_PREDICT_ALLOWLIST");
assert.equal(UNDERDOG_PREDICT_ALLOWLIST_ENV_ALT, "UNDERDOG_PREDICT_ALLOWLIST");

assert.deepEqual(parseComboLocksAllowlist("a@x.com, uid-1; B@Y.com"), ["a@x.com", "uid-1", "B@Y.com"]);
assert.deepEqual(parseComboLocksAllowlist(""), []);

{
  const list = comboLocksAllowlist({ VITE_COMBO_LOCKS_ALLOWLIST: "" });
  assert.equal(list.has(OWNER_EMAIL), true);
  assert.equal(list.size, 1);
}
{
  const list = comboLocksAllowlist({ VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com, abc-uid" });
  assert.equal(list.has(OWNER_EMAIL), true);
  assert.equal(list.has("tester@gmail.com"), true);
  assert.equal(list.has("abc-uid"), true);
}

const kevin = { id: "supabase-kevin", email: "Kev120909@gmail.com", user_metadata: { full_name: "Kevin Gordon" } };
assert.equal(canSeeComboLocks(kevin), true);
assert.equal(canSeeComboLocks(kevin, { VITE_COMBO_LOCKS_ALLOWLIST: "" }), true);
assert.equal(canSeeOwnerTools(kevin), true);

assert.equal(canSeeComboLocks(null), false);
assert.equal(canSeeComboLocks({ email: "stranger@gmail.com", id: "u2" }), false);
assert.equal(canSeeOwnerTools({ email: "stranger@gmail.com" }), false);
assert.equal(canSeeOwnerTools(null), false);

assert.equal(canSeeComboLocks({ email: "tester@gmail.com" }, { VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com" }), true);
assert.equal(canSeeComboLocks({ id: "uid-99", email: "x@y.com" }, { VITE_COMBO_LOCKS_ALLOWLIST: "uid-99" }), true);
assert.equal(canSeeOwnerTools({ email: "tester@gmail.com" }), false);

assert.equal(KENNETH_GUIDO_EMAIL, "kmguido97@gmail.com");
const kenneth = { id: "uid-kenneth", email: "kmguido97@gmail.com" };
assert.equal(canSeeNewOddsBoard(kevin), true);
assert.equal(canSeeNewOddsBoard(kenneth), true);
assert.equal(canSeeNewOddsBoard({ email: "KMGuido97@Gmail.com" }), true);
assert.equal(canSeeNewOddsBoard({ email: "stranger@gmail.com" }), false);
assert.equal(canSeeNewOddsBoard(null), false);
assert.equal(canSeeOwnerTools(kenneth), false);
assert.equal(canSeeUnderdogPredict(kenneth), true);
assert.equal(canSeeUnderdogPredict({ email: "KMGuido97@Gmail.com" }), true);

{
  const list = underdogPredictAllowlist({ VITE_UNDERDOG_PREDICT_ALLOWLIST: "" });
  assert.equal(list.has(OWNER_EMAIL), true);
  assert.equal(list.has(KENNETH_GUIDO_EMAIL), true);
  assert.equal(list.size, 2);
}
{
  const list = underdogPredictAllowlist({ UNDERDOG_PREDICT_ALLOWLIST: "tester@gmail.com" });
  assert.equal(list.has(OWNER_EMAIL), true);
  assert.equal(list.has("tester@gmail.com"), true);
}
assert.equal(canSeeUnderdogPredict(kevin), true);
assert.equal(canSeeUnderdogPredict(kevin, { VITE_UNDERDOG_PREDICT_ALLOWLIST: "" }), true);
assert.equal(canSeeUnderdogPredict({ email: "KEV120909@GMAIL.COM" }), true);
assert.equal(canSeeUnderdogPredict(null), false);
assert.equal(canSeeUnderdogPredict({ email: "stranger@gmail.com", id: "u2" }), false);
assert.equal(canSeeUnderdogPredict({ email: "tester@gmail.com" }, { VITE_UNDERDOG_PREDICT_ALLOWLIST: "tester@gmail.com" }), true);
assert.equal(canSeeUnderdogPredict({ id: "uid-udp", email: "x@y.com" }, { UNDERDOG_PREDICT_ALLOWLIST: "uid-udp" }), true);
assert.equal(canSeeUnderdogPredict({ email: "tester@gmail.com" }), false);

{
  const trusted = new Set(["kalshi", "bookmaker", "underdog_predict", "polymarket"]);
  const kevinKeys = visibleTrustedBookKeys(kevin, trusted);
  const strangerKeys = visibleTrustedBookKeys({ email: "stranger@gmail.com" }, trusted);
  assert.equal(kevinKeys.has("underdog_predict"), true);
  assert.equal(kevinKeys.has("bookmaker"), true);
  assert.equal(strangerKeys.has("underdog_predict"), false);
  assert.equal(strangerKeys.has("bookmaker"), true);
  assert.equal(strangerKeys.has("kalshi"), true);
  const books = [
    { key: "kalshi" },
    { key: "bookmaker" },
    { key: "underdog_predict" },
    { key: "polymarket" },
  ];
  assert.deepEqual(visiblePromoBooks(kevin, books).map((b) => b.key), ["kalshi", "bookmaker", "underdog_predict", "polymarket"]);
  assert.deepEqual(visiblePromoBooks(null, books).map((b) => b.key), ["kalshi", "bookmaker", "polymarket"]);
  const matching = matchingKeysVisibleToUser(trusted, { email: "stranger@gmail.com" }, trusted);
  assert.equal(matching.has("underdog_predict"), false);
  assert.equal(matching.has("bookmaker"), true);
  assert.equal(visibleBetstampBooks(kevin).some((b) => b.id === UNDERDOG_PREDICT_BOOK_ID), true);
  assert.equal(visibleBetstampBooks(kenneth).some((b) => b.id === UNDERDOG_PREDICT_BOOK_ID), true);
  assert.equal(visibleBetstampBooks(null).some((b) => b.id === UNDERDOG_PREDICT_BOOK_ID), false);
  assert.equal(visibleBetstampBookIds({ email: "stranger@gmail.com" }).includes(UNDERDOG_PREDICT_BOOK_ID), false);
  assert.equal(visibleBetstampBookIds(null).includes(400), true, "BetMGM 400 is public on New Odds Board");
  assert.equal(visibleBetstampBooks(null).length, BETSTAMP_TRIAL_BOOKS.length - 1);
  assert.equal(UNDERDOG_PREDICT_BOOK_KEY, "underdog_predict");
}

const stranger = { email: "stranger@gmail.com", id: "u2" };
const tester = { email: "tester@gmail.com", id: "uid-tester" };
assert.equal(profileShowsComboPnl(kevin), false, "own-profile flag must be explicit");
assert.equal(profileShowsComboPnl(kevin, { isOwner: false }), false);
assert.equal(profileShowsComboPnl(kevin, { isOwner: true }), true);
assert.equal(profileShowsComboPnl(kevin, { isOwner: true }, { VITE_COMBO_LOCKS_ALLOWLIST: "" }), true);
assert.equal(profileShowsComboPnl(stranger, { isOwner: true }), false);
assert.equal(profileShowsComboPnl(stranger, { isOwner: true }, { VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com" }), false);
assert.equal(profileShowsComboPnl(tester, { isOwner: true }, { VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com" }), true);
assert.equal(profileShowsComboPnl(tester, { isOwner: false }, { VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com" }), false);
assert.equal(profileShowsComboPnl(null, { isOwner: true }), false);

assert.deepEqual(parseAppHash("#profile"), { tab: "profile", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#combo"), { tab: "combo", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#combo/lock-1"), { tab: "combo", lockId: "lock-1", cardId: null });
assert.deepEqual(parseAppHash(""), { tab: null, lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#odds"), { tab: "odds", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#odds-betstamp"), { tab: "oddsBetstamp", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#betstamp"), { tab: "oddsBetstamp", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#new-odds-board"), { tab: "oddsBetstamp", lockId: null, cardId: null });
assert.equal(serializeAppHash({ tab: "oddsBetstamp" }), "#new-odds-board");
assert.deepEqual(parseAppHash("#promo"), { tab: "promo", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#ev/abc"), { tab: "ev", lockId: null, cardId: "abc" });
assert.equal(serializeAppHash({ tab: "odds" }), "#odds");
assert.equal(comboLockHash("p1"), "#combo/p1");
assert.equal(profileHash(), "#profile");
assert.equal(clearComboHash("#combo/p1"), "");
assert.equal(clearComboHash("#profile"), "#profile");
{
  const denied = resolveAppHash(parseAppHash("#combo/hidden"), { email: "stranger@gmail.com" });
  assert.equal(denied.tab, "promo");
  assert.equal(denied.lockId, null);
  assert.equal(denied.notice, "noaccess");
}
{
  const kevinBoard = resolveAppHash(parseAppHash("#new-odds-board"), kevin);
  assert.equal(kevinBoard.tab, "oddsBetstamp");
  assert.equal(kevinBoard.allowed, true);
  const strangerBoard = resolveAppHash(parseAppHash("#odds-betstamp"), stranger);
  assert.equal(strangerBoard.tab, "promo");
  assert.equal(strangerBoard.allowed, false);
  assert.equal(strangerBoard.notice, "noaccess");
  const kennethBoard = resolveAppHash(parseAppHash("#new-odds-board"), kenneth);
  assert.equal(kennethBoard.tab, "oddsBetstamp");
  assert.equal(kennethBoard.allowed, true);
  const signedOutBoard = resolveAppHash(parseAppHash("#new-odds-board"), null);
  assert.equal(signedOutBoard.tab, "promo");
  assert.equal(signedOutBoard.notice, "signin");
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  const profile = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  const landing = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const landingSlice = landing.slice(landing.indexOf("function LandingFull"), landing.indexOf("function SendToComboLocksButton"));

  assert.match(app, /canSeeComboLocks\(user\)/);
  assert.match(app, /canSeeOwnerTools\(user\)/);
  assert.match(app, /canSeeUnderdogPredict\(user\)/);
  assert.match(app, /maybeOverlayUnderdogPredictOnCacheRows/);
  assert.match(app, /includeUnderdog/);
  assert.match(app, /<BetstampOddsBoard user=\{user\}/);
  assert.match(app, /trustedVisible\.has\(b\.key\)/);
  assert.match(app, /VITE_COMBO_LOCKS_ALLOWLIST|comboAccess/);
  assert.match(app, /activeTab === "combo" && canSeeComboLocks\(user\) && <ComboLocks/);
  assert.match(app, /activeTab === "missTape" && canSeeOwnerTools\(user\) && <ComboTape/);
  assert.match(app, /activeTab === "unhedged" && canSeeOwnerTools\(user\) && <UnhedgedTape/);
  assert.match(app, /href=\{tabHash\("combo"\)\}/);
  assert.match(app, /tabStyle\("combo"\)/);
  assert.match(app, />Combo Locks<\/a>/);
  assert.match(app, /href=\{tabHash\("promo"\)\}/);
  assert.match(app, /href=\{tabHash\("ev"\)\}/);
  assert.match(app, /href=\{tabHash\("odds"\)\}/);
  assert.match(app, /href=\{tabHash\("oddsBetstamp"\)\}/);
  assert.match(app, /href=\{tabHash\("missTape"\)\}/);
  assert.match(app, /href=\{tabHash\("unhedged"\)\}/);
  assert.match(app, /href=\{tabHash\("profile"\)\}/);
  assert.match(app, /onNavTabClick\("oddsBetstamp"/);
  assert.match(app, /activeTab === "oddsBetstamp" && canSeeNewOddsBoard\(user\)/);
  assert.match(app, /canSeeNewOddsBoard\(user\)/);
  assert.match(app, />New Odds Board<\/a>/);
  assert.doesNotMatch(app, />New Odds Board<\/button>/);
  assert.doesNotMatch(app, />Betstamp<\/button>/);
  assert.match(app, /<BetstampOddsBoard/);
  assert.doesNotMatch(landingSlice, /New Odds Board|Betstamp/i);
  assert.match(app, /activeTab === "profile"/);
  assert.match(app, /<UserProfile[\s>]/);
  assert.match(app, /canSeeLocks=\{canSeeComboLocks\(user\)\}/);
  assert.match(app, /isOwner=\{Boolean\(user\)\}/);
  assert.doesNotMatch(app, /^\s+isOwner\s*$/m);
  assert.doesNotMatch(app, /activeTab === "combo" && user\?\.email === OWNER_EMAIL && <ComboLocks/);
  assert.doesNotMatch(landingSlice, /Combo Locks|combo lock|ComboLocks/i);
  assert.doesNotMatch(app, /UNHEDGED_RFQ_LIVE/);

  assert.match(profile, /profileShowsComboPnl\(user, \{ isOwner: isOwner && canSeeLocks \}\)/);
  assert.match(profile, /isOwner = false/);
  assert.match(profile, /canSeeLocks = false/);
  assert.match(profile, /if \(!showPnl \|\| !user\?\.id\)/);
  assert.match(profile, /\{showPnl && \(/);
  assert.match(profile, /canSeeOwnerTools\(user\)/);
  assert.doesNotMatch(profile, /isOwner = true/);
  assert.doesNotMatch(profile, /canSeeComboLocks\(user\)/);

  assert.match(locks, /canSeeComboLocks\(user\)/);
  assert.match(locks, /focusLockId/);
  assert.match(locks, /id=\{\"lock-\" \+ p\.id\}/);
  assert.doesNotMatch(locks, /This tab is private/);
  assert.doesNotMatch(locks, /UNHEDGED_RFQ_LIVE/);

  const envEx = fs.readFileSync(path.join(dir, "..", ".env.example"), "utf8");
  assert.match(envEx, /VITE_COMBO_LOCKS_ALLOWLIST=/);
  assert.match(envEx, /VITE_UNDERDOG_PREDICT_ALLOWLIST=/);
  assert.match(envEx, /\/api\/betstamp-markets is anon/);
  assert.match(envEx, /kev120909@gmail.com/);
  assert.match(envEx, /kmguido97@gmail.com/);
}

console.log("comboAccess.test.js ok");
