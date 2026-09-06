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
  persistProfilePrefsRemote,
  mergeProfilePrefSources,
  PROFILE_PREFS_META_KEY,
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

assert.deepEqual(DEFAULT_PROFILE_SPORTS, [
  "baseball_mlb",
  "americanfootball_nfl",
  "americanfootball_ncaaf",
]);
assert.deepEqual(defaultProfilePrefs().sports, DEFAULT_PROFILE_SPORTS);
assert.equal(defaultProfilePrefs().promoBook, DEFAULT_PROFILE_BOOK);
assert.equal(defaultProfilePrefs().seenAnnouncementId, "");

{
  const seeded = seedProfilePrefs(googleUser, null, { allowedSports, allowedBooks });
  assert.equal(seeded.displayName, "Kevin Gordon");
  assert.deepEqual(seeded.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(seeded.promoBook, "draftkings");
  assert.equal(seeded.identity.email, "kev120909@gmail.com");
}

{
  const missing = normalizeProfilePrefs({}, { allowedSports, allowedBooks });
  assert.deepEqual(missing.sports, DEFAULT_PROFILE_SPORTS);
  const empty = normalizeProfilePrefs({ sports: [] }, { allowedSports, allowedBooks });
  assert.deepEqual(empty.sports, DEFAULT_PROFILE_SPORTS);
}

{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  const firstLoad = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.deepEqual(firstLoad.sports, DEFAULT_PROFILE_SPORTS);
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
  assert.equal(saved.seenAnnouncementId, "");
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
    seenAnnouncementId: "blast-1",
  }, { storage, allowedSports, allowedBooks });
  assert.equal(store.has(profilePrefsStorageKey("uid-kevin")), true);
  const loaded = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.equal(loaded.displayName, "Kevin");
  assert.deepEqual(loaded.sports, ["baseball_mlb"]);
  assert.equal(loaded.promoBook, "fanduel");
  assert.equal(loaded.seenAnnouncementId, "blast-1");
}

{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  saveProfilePrefs(googleUser, {
    sports: ["baseball_mlb", "americanfootball_ncaaf"],
    promoBook: "draftkings",
  }, { storage, allowedSports, allowedBooks });
  const loaded = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.deepEqual(loaded.sports, ["baseball_mlb", "americanfootball_ncaaf"]);
}

{
  const merged = mergeProfilePrefSources(
    { seenAnnouncementId: "local-old", sports: ["baseball_mlb"] },
    { seenAnnouncementId: "remote-new", promoBook: "fanduel" },
  );
  assert.equal(merged.seenAnnouncementId, "remote-new");
  assert.deepEqual(merged.sports, ["baseball_mlb"]);
  assert.equal(merged.promoBook, "fanduel");
}

{
  const remoteUser = {
    ...googleUser,
    user_metadata: {
      ...googleUser.user_metadata,
      [PROFILE_PREFS_META_KEY]: { seenAnnouncementId: "from-supabase" },
    },
  };
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  const loaded = loadProfilePrefs(remoteUser, { storage, allowedSports, allowedBooks });
  assert.equal(loaded.seenAnnouncementId, "from-supabase");
}

{
  let payload = null;
  const client = {
    auth: {
      updateUser: async (body) => {
        payload = body;
        return { data: { user: googleUser }, error: null };
      },
    },
  };
  const result = await persistProfilePrefsRemote(client, googleUser, {
    displayName: "Kevin",
    sports: ["baseball_mlb"],
    promoBook: "fanduel",
    seenAnnouncementId: "blast-1",
  });
  assert.equal(result.persisted, true);
  assert.equal(payload.data[PROFILE_PREFS_META_KEY].seenAnnouncementId, "blast-1");
}

{
  const client = { auth: { updateUser: async () => { throw new Error("offline"); } } };
  const result = await persistProfilePrefsRemote(client, googleUser, { seenAnnouncementId: "x" });
  assert.equal(result.persisted, false);
}

assert.equal(profileDisplayName(googleUser, { displayName: "" }), "Kevin Gordon");
assert.equal(profileDisplayName(googleUser, { displayName: "KG" }), "KG");
assert.equal(PROFILE_PREFS_KEY, "aibetbuilder.profilePrefs");

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const ui = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(ui, /canSeeLocks/);
  assert.match(ui, /isOwner = false/);
  assert.match(ui, /profileShowsComboPnl/);
  assert.match(ui, /canSeeOwnerTools\(user\)/);
  assert.match(ui, /WhatsNewComposer/);
  assert.match(ui, /buildComboStatement/);
  assert.match(ui, /applyStatementFilters/);
  assert.match(ui, /onOpenLock/);
  assert.match(ui, /comboLockHash/);
  assert.match(ui, /STATEMENT_DATE_FILTERS/);
  assert.match(ui, /STATEMENT_KIND_FILTERS/);
  assert.match(ui, /STATEMENT_RESULT_FILTERS/);
  assert.match(ui, /statementCsv/);
  assert.match(ui, /setSearchQuery\(searchInput\), 150/);
  assert.match(ui, /stmt-row/);
  assert.match(ui, /stmt-sub/);
  assert.match(ui, /Open lock/);
  assert.doesNotMatch(ui, /<th>Kind<\/th>/);
  assert.doesNotMatch(ui, /billing|credit card|kalshi key|polymarket key/i);
  assert.match(app, /loadProfilePrefs/);
  assert.match(app, /saveProfilePrefs/);
  assert.match(app, /UserProfile/);
  assert.match(app, /canSeeLocks=\{canSeeComboLocks\(user\)\}/);
  assert.match(app, /isOwner=\{Boolean\(user\)\}/);
}

console.log("userProfile.test.js ok");
