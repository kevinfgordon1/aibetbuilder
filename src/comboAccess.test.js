import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNER_EMAIL,
  COMBO_LOCKS_ALLOWLIST_ENV,
  parseComboLocksAllowlist,
  comboLocksAllowlist,
  canSeeComboLocks,
  canSeeOwnerTools,
  profileShowsComboPnl,
  parseAppHash,
  comboLockHash,
  profileHash,
  clearComboHash,
  serializeAppHash,
  resolveAppHash,
} from "./comboAccess.js";

assert.equal(OWNER_EMAIL, "kev120909@gmail.com");
assert.equal(COMBO_LOCKS_ALLOWLIST_ENV, "VITE_COMBO_LOCKS_ALLOWLIST");

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
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  const profile = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  const landing = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const landingSlice = landing.slice(landing.indexOf("function LandingFull"), landing.indexOf("function SendToComboLocksButton"));

  assert.match(app, /canSeeComboLocks\(user\)/);
  assert.match(app, /canSeeOwnerTools\(user\)/);
  assert.match(app, /VITE_COMBO_LOCKS_ALLOWLIST|comboAccess/);
  assert.match(app, /activeTab === "combo" && canSeeComboLocks\(user\) && <ComboLocks/);
  assert.match(app, /activeTab === "missTape" && canSeeOwnerTools\(user\) && <ComboTape/);
  assert.match(app, /activeTab === "unhedged" && canSeeOwnerTools\(user\) && <UnhedgedTape/);
  assert.match(app, /<button style=\{tabStyle\("combo"\)\} onClick=\{\(\) => setActiveTab\("combo"\)\}>Combo Locks<\/button>/);
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
  assert.match(envEx, /kev120909@gmail.com/);
}

console.log("comboAccess.test.js ok");
