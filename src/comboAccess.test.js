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
  COMBO_LOCKS_ACCOUNTS,
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
  initialAppTab,
} from "./comboAccess.js";
import { visibleBetstampBooks, visibleBetstampBookIds, UNDERDOG_PREDICT_BOOK_ID, UNDERDOG_PREDICT_BOOK_KEY, BETSTAMP_TRIAL_BOOKS } from "./betstampBooks.js";

assert.equal(OWNER_EMAIL, "kev120909@gmail.com");
assert.equal(COMBO_LOCKS_ALLOWLIST_ENV, "VITE_COMBO_LOCKS_ALLOWLIST");
assert.equal(UNDERDOG_PREDICT_ALLOWLIST_ENV, "VITE_UNDERDOG_PREDICT_ALLOWLIST");
assert.equal(UNDERDOG_PREDICT_ALLOWLIST_ENV_ALT, "UNDERDOG_PREDICT_ALLOWLIST");

assert.deepEqual(parseComboLocksAllowlist("a@x.com, uid-1; B@Y.com"), ["a@x.com", "uid-1", "B@Y.com"]);
assert.deepEqual(parseComboLocksAllowlist(""), []);

// Combo Locks is hardcoded: Kevin's two accounts + one approved tester.
// Email AND uid must both match; the env var is ignored.
const KEVIN_ID = "79ae1610-097e-4b46-a622-1e952f18e936";
const KEVIN_ALT = { id: "968efed8-54db-48a6-808b-194a7a03a4cb", email: "kevin.f.gordon1@gmail.com" };
const GTESTER = { id: "dd23a3a8-cb45-4866-be11-df72b4767c26", email: "gmoneyvikes@gmail.com" };
{
  assert.equal(COMBO_LOCKS_ACCOUNTS.length, 3);
  const list = comboLocksAllowlist({ VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com, abc-uid" });
  assert.equal(list.has(OWNER_EMAIL), true);
  assert.equal(list.has(KEVIN_ID), true);
  assert.equal(list.has(KEVIN_ALT.email), true);
  assert.equal(list.has(GTESTER.email), true);
  assert.equal(list.has("tester@gmail.com"), false, "env allowlist is ignored");
  assert.equal(list.has("abc-uid"), false);
  assert.equal(list.has(KENNETH_GUIDO_EMAIL), false, "Kenneth does not get Combo Locks");
  assert.equal(list.size, 6);
}

const kevin = { id: KEVIN_ID, email: "Kev120909@gmail.com", user_metadata: { full_name: "Kevin Gordon" } };
assert.equal(canSeeComboLocks(kevin), true);
assert.equal(canSeeComboLocks(kevin, { VITE_COMBO_LOCKS_ALLOWLIST: "" }), true);
assert.equal(canSeeComboLocks(KEVIN_ALT), true);
assert.equal(canSeeComboLocks(GTESTER), true);
assert.equal(canSeeComboLocks({ ...GTESTER, email: "GMoneyVikes@Gmail.com " }), true);
assert.equal(canSeeOwnerTools(kevin), true);
assert.equal(canSeeOwnerTools(GTESTER), false);
assert.equal(canSeeOwnerTools(KEVIN_ALT), false);

assert.equal(canSeeComboLocks(null), false);
assert.equal(canSeeComboLocks({ email: "stranger@gmail.com", id: "u2" }), false);
assert.equal(canSeeComboLocks({ email: OWNER_EMAIL, id: "u-lookalike" }), false, "email alone is not enough");
assert.equal(canSeeComboLocks({ email: OWNER_EMAIL }), false, "uid required");
assert.equal(canSeeComboLocks({ email: "someone@x.com", id: KEVIN_ID }), false, "uid alone is not enough");
assert.equal(canSeeComboLocks({ email: GTESTER.email, id: KEVIN_ALT.id }), false, "pairs do not mix");
assert.equal(canSeeComboLocks({ email: KENNETH_GUIDO_EMAIL, id: "42b5ee16-68d5-4b3b-a931-40aa17cd1a47" }), false);
assert.equal(canSeeOwnerTools({ email: "stranger@gmail.com" }), false);
assert.equal(canSeeOwnerTools(null), false);

assert.equal(canSeeComboLocks({ email: "tester@gmail.com", id: "t1" }, { VITE_COMBO_LOCKS_ALLOWLIST: "tester@gmail.com" }), false);
assert.equal(canSeeComboLocks({ id: "uid-99", email: "x@y.com" }, { VITE_COMBO_LOCKS_ALLOWLIST: "uid-99" }), false);
assert.equal(canSeeOwnerTools({ email: "tester@gmail.com" }), false);

assert.equal(KENNETH_GUIDO_EMAIL, "kmguido97@gmail.com");
const kenneth = { id: "uid-kenneth", email: "kmguido97@gmail.com" };
assert.equal(canSeeNewOddsBoard(kevin), true);
assert.equal(canSeeNewOddsBoard(kenneth), true);
assert.equal(canSeeNewOddsBoard({ email: "KMGuido97@Gmail.com" }), true);
assert.equal(canSeeNewOddsBoard({ email: "stranger@gmail.com" }), false);
assert.equal(canSeeNewOddsBoard(null), false);

{
  const xNoEmail = {
    id: "uid-x",
    email: "",
    app_metadata: { provider: "x" },
    user_metadata: { email: "kev120909@gmail.com", user_name: "someone" },
  };
  assert.equal(canSeeOwnerTools(xNoEmail), false, "X without auth email is not Kevin");
  assert.equal(canSeeNewOddsBoard(xNoEmail), false, "metadata email does not open New Odds Board");
  assert.equal(canSeeComboLocks(xNoEmail), false);
  assert.equal(canSeeUnderdogPredict(xNoEmail), false);
  const xMetaOnly = {
    id: "uid-x2",
    app_metadata: { provider: "x" },
    user_metadata: { email: "kmguido97@gmail.com" },
  };
  assert.equal(canSeeNewOddsBoard(xMetaOnly), false);
  assert.equal(canSeeOwnerTools(xMetaOnly), false);
  assert.equal(canSeeComboLocks({ id: "uid-x", email: null, app_metadata: { provider: "x" } }, { VITE_COMBO_LOCKS_ALLOWLIST: "uid-x" }), false);
  assert.equal(canSeeOwnerTools({ id: "uid-x", email: null, app_metadata: { provider: "x" } }), false, "uid allowlist does not open Live Trading Desk");
  assert.equal(canSeeNewOddsBoard({ id: "fb", email: "kmguido97@gmail.com", app_metadata: { provider: "facebook" } }), true);
  assert.equal(canSeeOwnerTools({ id: "mail", email: "kev120909@gmail.com", app_metadata: { provider: "email" } }), true);
}
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
const tester = GTESTER;
assert.equal(profileShowsComboPnl(kevin), false, "own-profile flag must be explicit");
assert.equal(profileShowsComboPnl(kevin, { isOwner: false }), false);
assert.equal(profileShowsComboPnl(kevin, { isOwner: true }), true);
assert.equal(profileShowsComboPnl(kevin, { isOwner: true }, { VITE_COMBO_LOCKS_ALLOWLIST: "" }), true);
assert.equal(profileShowsComboPnl(stranger, { isOwner: true }), false);
assert.equal(profileShowsComboPnl(stranger, { isOwner: true }, { VITE_COMBO_LOCKS_ALLOWLIST: "stranger@gmail.com" }), false);
assert.equal(profileShowsComboPnl(tester, { isOwner: true }), true);
assert.equal(profileShowsComboPnl(tester, { isOwner: false }), false);
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
assert.deepEqual(parseAppHash("#live-trading-desk"), { tab: "liveDesk", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#desk"), { tab: "liveDesk", lockId: null, cardId: null });
assert.equal(serializeAppHash({ tab: "liveDesk" }), "#live-trading-desk");
assert.deepEqual(parseAppHash("#promo"), { tab: "promo", lockId: null, cardId: null });
assert.deepEqual(parseAppHash("#ev/abc"), { tab: "ev", lockId: null, cardId: "abc" });
assert.equal(initialAppTab("#ev"), "ev");
assert.equal(initialAppTab("#odds"), "odds");
assert.equal(initialAppTab("#promo"), "promo");
assert.equal(initialAppTab(""), "promo");
assert.equal(initialAppTab("#combo"), "promo");
assert.equal(initialAppTab("#live-trading-desk"), "promo");
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
  const kevinDesk = resolveAppHash(parseAppHash("#live-trading-desk"), kevin);
  assert.equal(kevinDesk.tab, "liveDesk");
  assert.equal(kevinDesk.allowed, true);
  const kennethDesk = resolveAppHash(parseAppHash("#desk"), kenneth);
  assert.equal(kennethDesk.tab, "promo");
  assert.equal(kennethDesk.notice, "noaccess");
  assert.equal(kennethDesk.allowed, false);
  const strangerDesk = resolveAppHash(parseAppHash("#live-trading-desk"), stranger);
  assert.equal(strangerDesk.tab, "promo");
  assert.equal(strangerDesk.notice, "noaccess");
  const signedOutDesk = resolveAppHash(parseAppHash("#live-trading-desk"), null);
  assert.equal(signedOutDesk.notice, "signin");
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
  assert.match(app, /activeTab === "liveDesk" && canSeeOwnerTools\(user\) && \([\s\S]*?<LiveTradingDesk/);
  assert.match(app, /href=\{tabHash\("liveDesk"\)\}/);
  assert.match(app, />Live Trading Desk<\/a>/);
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
  // Promo copy that names Combo Locks only renders for Combo Locks accounts.
  for (const m of app.matchAll(/"[^"\n]*Combo Locks[^"\n]*"/g)) {
    const before = app.slice(Math.max(0, m.index - 60), m.index);
    assert.match(before, /canSeeComboLocks\(user\) \? $/, "ungated Combo Locks copy: " + m[0].slice(0, 60));
  }
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
  assert.match(fs.readFileSync(path.join(dir, "ComboLocksView.jsx"), "utf8"), /id=\{"lock-" \+ parlay\.id\}/);
  assert.doesNotMatch(locks, /This tab is private/);
  assert.doesNotMatch(locks, /UNHEDGED_RFQ_LIVE/);

  const envEx = fs.readFileSync(path.join(dir, "..", ".env.example"), "utf8");
  assert.doesNotMatch(envEx, /^VITE_COMBO_LOCKS_ALLOWLIST=/m, "Combo Locks gate is hardcoded, not env");
  assert.match(envEx, /VITE_UNDERDOG_PREDICT_ALLOWLIST=/);
  assert.match(envEx, /\/api\/betstamp-markets is anon/);
  assert.match(envEx, /kev120909@gmail.com/);
  assert.match(envEx, /kmguido97@gmail.com/);
}

console.log("comboAccess.test.js ok");
