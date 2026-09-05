import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_PREFS_KEY,
  DEFAULT_PROFILE_SPORTS,
  DEFAULT_PROFILE_BOOK,
  identityFromUser,
  defaultProfilePrefs,
  normalizeProfilePrefs,
  seedProfilePrefs,
  loadProfilePrefs,
  saveProfilePrefs,
  profileDisplayName,
  profilePrefsStorageKey,
} from "./userProfile.js";

const allowedSports = new Set(["baseball_mlb", "americanfootball_ncaaf", "americanfootball_nfl"]);
const allowedBooks = new Set(["draftkings", "fanduel"]);

const googleUser = {
  id: "uid-kevin",
  email: "kev120909@gmail.com",
  app_metadata: { provider: "google" },
  user_metadata: {
    full_name: "Kevin Gordon",
    avatar_url: "https://lh3.googleusercontent.com/a/kevin",
  },
};

{
  const ident = identityFromUser(googleUser);
  assert.equal(ident.name, "Kevin Gordon");
  assert.equal(ident.email, "kev120909@gmail.com");
  assert.equal(ident.avatar, "https://lh3.googleusercontent.com/a/kevin");
  assert.equal(ident.provider, "google");
}

assert.deepEqual(defaultProfilePrefs().sports, DEFAULT_PROFILE_SPORTS);
assert.equal(defaultProfilePrefs().promoBook, DEFAULT_PROFILE_BOOK);

{
  const seeded = seedProfilePrefs(googleUser, null, { allowedSports, allowedBooks });
  assert.equal(seeded.displayName, "Kevin Gordon");
  assert.deepEqual(seeded.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(seeded.promoBook, "draftkings");
  assert.equal(seeded.identity.email, "kev120909@gmail.com");
}

{
  const saved = normalizeProfilePrefs({
    displayName: " KG ",
    sports: ["americanfootball_nfl", "not-a-sport"],
    promoBook: "fanduel",
  }, { allowedSports, allowedBooks });
  assert.equal(saved.displayName, "KG");
  assert.deepEqual(saved.sports, ["americanfootball_nfl"]);
  assert.equal(saved.promoBook, "fanduel");
}

{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  saveProfilePrefs(googleUser, {
    displayName: "Kevin",
    sports: ["baseball_mlb"],
    promoBook: "fanduel",
  }, { storage, allowedSports, allowedBooks });
  assert.equal(store.has(profilePrefsStorageKey("uid-kevin")), true);
  const loaded = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.equal(loaded.displayName, "Kevin");
  assert.deepEqual(loaded.sports, ["baseball_mlb"]);
  assert.equal(loaded.promoBook, "fanduel");
}

assert.equal(profileDisplayName(googleUser, { displayName: "" }), "Kevin Gordon");
assert.equal(profileDisplayName(googleUser, { displayName: "KG" }), "KG");
assert.equal(PROFILE_PREFS_KEY, "aibetbuilder.profilePrefs");

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const ui = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(ui, /canSeeLocks/);
  assert.match(ui, /isOwner/);
  assert.match(ui, /buildComboStatement/);
  assert.match(ui, /onOpenLock/);
  assert.match(ui, /comboLockHash/);
  assert.doesNotMatch(ui, /billing|credit card|kalshi key|polymarket key/i);
  assert.match(app, /loadProfilePrefs/);
  assert.match(app, /saveProfilePrefs/);
  assert.match(app, /UserProfile/);
}

console.log("userProfile.test.js ok");
