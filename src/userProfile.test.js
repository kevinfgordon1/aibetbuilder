import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_PREFS_KEY,
  DEFAULT_PROFILE_SPORTS,
  PROFILE_SPORTS_V2,
  isLegacyDefaultSports,
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

const allowedSports = new Set(["baseball_mlb", "americanfootball_ncaaf", "americanfootball_nfl", "basketball_nba", "icehockey_nhl"]);
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

// MLB offseason default: no MLB, NHL on.
assert.deepEqual(DEFAULT_PROFILE_SPORTS, [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "basketball_nba",
  "icehockey_nhl",
]);
assert.ok(!DEFAULT_PROFILE_SPORTS.includes("baseball_mlb"));
{
  // One-time v3 migration: saved lists that exactly equal an old default
  // (v1 MLB/NFL/NCAAF or v2 MLB/NFL/NCAAF/NBA, any order) move to the new
  // default; custom picks are untouched.
  const NEW = DEFAULT_PROFILE_SPORTS;
  // v1 default saved before the NBA upgrade goes straight to the new default
  // (composes with the old pre-NBA upgrade — never lands on the MLB v2 set).
  const legacy = normalizeProfilePrefs({ sports: ["americanfootball_nfl", "baseball_mlb", "americanfootball_ncaaf"] }, { allowedSports, allowedBooks });
  assert.deepEqual(legacy.sports, NEW);
  assert.equal(legacy.sportsDefaultsVersion, 3);
  // v1 set re-saved at v2 is still an old default -> migrates once.
  const resavedV1 = normalizeProfilePrefs({ sports: ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"], sportsDefaultsVersion: 2 }, { allowedSports, allowedBooks });
  assert.deepEqual(resavedV1.sports, NEW);
  // v2 default, any order, saved at v2 or with no version -> new default.
  const savedV2 = normalizeProfilePrefs({ sports: ["basketball_nba", "americanfootball_ncaaf", "baseball_mlb", "americanfootball_nfl"], sportsDefaultsVersion: 2 }, { allowedSports, allowedBooks });
  assert.deepEqual(savedV2.sports, NEW);
  const unversionedV2 = normalizeProfilePrefs({ sports: PROFILE_SPORTS_V2.slice() }, { allowedSports, allowedBooks });
  assert.deepEqual(unversionedV2.sports, NEW);
  // Duplicates don't defeat the exact match.
  const dupV2 = normalizeProfilePrefs({ sports: [...PROFILE_SPORTS_V2, "basketball_nba"], sportsDefaultsVersion: 2 }, { allowedSports, allowedBooks });
  assert.deepEqual(dupV2.sports, NEW);
  // Custom picks are left alone (subsets, supersets, MLB-only, etc.).
  for (const pick of [
    ["americanfootball_nfl"],
    ["baseball_mlb"],
    ["baseball_mlb", "americanfootball_nfl"],
    ["baseball_mlb", "americanfootball_nfl", "basketball_nba"],
    [...PROFILE_SPORTS_V2, "icehockey_nhl"],
    ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf", "icehockey_nhl"],
  ]) {
    const kept = normalizeProfilePrefs({ sports: pick.slice(), sportsDefaultsVersion: 2 }, { allowedSports, allowedBooks });
    assert.deepEqual(kept.sports, pick, "custom pick kept: " + pick.join(","));
  }
  // Runs once: a list saved at v3 is never migrated, even if it equals an old default.
  const chosenV2 = normalizeProfilePrefs({ sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 3 }, { allowedSports, allowedBooks });
  assert.deepEqual(chosenV2.sports, PROFILE_SPORTS_V2);
  const chosenV1 = normalizeProfilePrefs({ sports: ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"], sportsDefaultsVersion: 3 }, { allowedSports, allowedBooks });
  assert.deepEqual(chosenV1.sports, ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"]);
  // Idempotent: normalizing the migrated result again is a no-op.
  assert.deepEqual(normalizeProfilePrefs(savedV2, { allowedSports, allowedBooks }).sports, NEW);
  // If NHL isn't an allowed sport, migrated users get the rest of the new default.
  const noNhl = new Set(["baseball_mlb", "americanfootball_ncaaf", "americanfootball_nfl", "basketball_nba"]);
  const migratedNoNhl = normalizeProfilePrefs({ sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 2 }, { allowedSports: noNhl, allowedBooks });
  assert.deepEqual(migratedNoNhl.sports, ["americanfootball_nfl", "americanfootball_ncaaf", "basketball_nba"]);
  assert.equal(isLegacyDefaultSports(["americanfootball_nfl", "americanfootball_ncaaf", "baseball_mlb"]), true);
  assert.equal(isLegacyDefaultSports(DEFAULT_PROFILE_SPORTS), false);
  assert.equal(isLegacyDefaultSports([]), false);
}

{
  // Load path: localStorage old default -> migrated, flagged stale so App
  // persists once; after saving, the flag clears and a re-pick of MLB sticks.
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  store.set(profilePrefsStorageKey("uid-kevin"), JSON.stringify({ sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 2, promoBook: "fanduel" }));
  const first = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.deepEqual(first.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(first.promoBook, "fanduel");
  assert.equal(first.sportsDefaultsStale, true);
  saveProfilePrefs(googleUser, first, { storage, allowedSports, allowedBooks });
  assert.equal(JSON.parse(store.get(profilePrefsStorageKey("uid-kevin"))).sportsDefaultsVersion, 3);
  const second = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.deepEqual(second.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(second.sportsDefaultsStale, false);
  // User deliberately picks the old v2 set again -> kept (migration ran already).
  saveProfilePrefs(googleUser, { ...second, sports: PROFILE_SPORTS_V2.slice() }, { storage, allowedSports, allowedBooks });
  const third = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.deepEqual(third.sports, PROFILE_SPORTS_V2);
  assert.equal(third.sportsDefaultsStale, false);
  // Fresh user with nothing saved: new default, nothing to persist.
  const fresh = loadProfilePrefs({ ...googleUser, id: "uid-new" }, { storage, allowedSports, allowedBooks });
  assert.deepEqual(fresh.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(fresh.sportsDefaultsStale, false);
}

{
  // Supabase profile (user_metadata) old default -> migrated + flagged; custom remote kept.
  const storage = { getItem: () => null, setItem: () => {} };
  const remoteOld = { ...googleUser, user_metadata: { ...googleUser.user_metadata, [PROFILE_PREFS_META_KEY]: { sports: ["americanfootball_ncaaf", "baseball_mlb", "americanfootball_nfl"], sportsDefaultsVersion: 2 } } };
  const a = loadProfilePrefs(remoteOld, { storage, allowedSports, allowedBooks });
  assert.deepEqual(a.sports, DEFAULT_PROFILE_SPORTS);
  assert.equal(a.sportsDefaultsStale, true);
  const remoteCustom = { ...googleUser, user_metadata: { ...googleUser.user_metadata, [PROFILE_PREFS_META_KEY]: { sports: ["baseball_mlb"], sportsDefaultsVersion: 2 } } };
  const b = loadProfilePrefs(remoteCustom, { storage, allowedSports, allowedBooks });
  assert.deepEqual(b.sports, ["baseball_mlb"]);
  assert.equal(b.sportsDefaultsStale, true); // stamps v3 once, sports unchanged
  const remoteNew = { ...googleUser, user_metadata: { ...googleUser.user_metadata, [PROFILE_PREFS_META_KEY]: { sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 3 } } };
  const c = loadProfilePrefs(remoteNew, { storage, allowedSports, allowedBooks });
  assert.deepEqual(c.sports, PROFILE_SPORTS_V2);
  assert.equal(c.sportsDefaultsStale, false);
}

{
  // A newer local version is not undone by a stale remote old default
  // (e.g. local save succeeded, Supabase write failed).
  const merged = mergeProfilePrefSources(
    { sports: ["baseball_mlb", "americanfootball_nfl"], sportsDefaultsVersion: 3 },
    { sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 2 },
  );
  assert.deepEqual(merged.sports, ["baseball_mlb", "americanfootball_nfl"]);
  assert.equal(merged.sportsDefaultsVersion, 3);
  // Same or newer remote version still wins (cross-device sync).
  const sameVer = mergeProfilePrefSources(
    { sports: ["baseball_mlb"], sportsDefaultsVersion: 3 },
    { sports: ["americanfootball_nfl"], sportsDefaultsVersion: 3 },
  );
  assert.deepEqual(sameVer.sports, ["americanfootball_nfl"]);
  const newerRemote = mergeProfilePrefSources(
    { sports: PROFILE_SPORTS_V2.slice(), sportsDefaultsVersion: 2 },
    { sports: ["americanfootball_nfl"], sportsDefaultsVersion: 3 },
  );
  assert.deepEqual(newerRemote.sports, ["americanfootball_nfl"]);
}

{
  // App persists the one-time migration to both localStorage and Supabase.
  const appSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"), "utf8");
  assert.match(appSrc, /if \(loaded\.sportsDefaultsStale\) \{[\s\S]{0,300}saveProfilePrefs\(user, loaded[\s\S]{0,200}persistProfilePrefsRemote\(supabase, user, migrated\)/);
}
assert.deepEqual(defaultProfilePrefs().sports, DEFAULT_PROFILE_SPORTS);
assert.equal(defaultProfilePrefs().promoBook, DEFAULT_PROFILE_BOOK);
assert.equal(defaultProfilePrefs().seenAnnouncementId, "");
assert.equal(defaultProfilePrefs().seenTargetedAlertId, "");

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
  assert.equal(saved.seenTargetedAlertId, "");
}

{
  const soccerAllowed = new Set([
    "baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf",
    "soccer_epl", "soccer_usa_mls",
  ]);
  const one = normalizeProfilePrefs({ sports: ["soccer_epl"] }, { allowedSports: soccerAllowed });
  assert.deepEqual(one.sports, ["soccer_epl", "soccer_usa_mls"]);
  const other = normalizeProfilePrefs({ sports: ["baseball_mlb", "soccer_usa_mls"] }, { allowedSports: soccerAllowed });
  assert.deepEqual(other.sports, ["baseball_mlb", "soccer_usa_mls", "soccer_epl"]);
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
    seenTargetedAlertId: "kenneth-new-odds-board",
  }, { storage, allowedSports, allowedBooks });
  assert.equal(store.has(profilePrefsStorageKey("uid-kevin")), true);
  const loaded = loadProfilePrefs(googleUser, { storage, allowedSports, allowedBooks });
  assert.equal(loaded.displayName, "Kevin");
  assert.deepEqual(loaded.sports, ["baseball_mlb"]);
  assert.equal(loaded.promoBook, "fanduel");
  assert.equal(loaded.seenAnnouncementId, "blast-1");
  assert.equal(loaded.seenTargetedAlertId, "kenneth-new-odds-board");
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
    { seenAnnouncementId: "local-old", seenTargetedAlertId: "local-alert", sports: ["baseball_mlb"] },
    { seenAnnouncementId: "remote-new", seenTargetedAlertId: "remote-alert", promoBook: "fanduel" },
  );
  assert.equal(merged.seenAnnouncementId, "remote-new");
  assert.equal(merged.seenTargetedAlertId, "remote-alert");
  assert.deepEqual(merged.sports, ["baseball_mlb"]);
  assert.equal(merged.promoBook, "fanduel");
}

{
  const remoteUser = {
    ...googleUser,
    user_metadata: {
      ...googleUser.user_metadata,
      [PROFILE_PREFS_META_KEY]: {
        seenAnnouncementId: "from-supabase",
        seenTargetedAlertId: "from-supabase-alert",
      },
    },
  };
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  const loaded = loadProfilePrefs(remoteUser, { storage, allowedSports, allowedBooks });
  assert.equal(loaded.seenAnnouncementId, "from-supabase");
  assert.equal(loaded.seenTargetedAlertId, "from-supabase-alert");
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
    seenTargetedAlertId: "kenneth-new-odds-board",
  });
  assert.equal(result.persisted, true);
  assert.equal(payload.data[PROFILE_PREFS_META_KEY].seenAnnouncementId, "blast-1");
  assert.equal(payload.data[PROFILE_PREFS_META_KEY].seenTargetedAlertId, "kenneth-new-odds-board");
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
  const board = fs.readFileSync(path.join(dir, "StatementBoard.jsx"), "utf8");
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(ui, /canSeeLocks/);
  assert.match(ui, /isOwner = false/);
  assert.match(ui, /profileShowsComboPnl/);
  assert.match(ui, /canSeeOwnerTools\(user\)/);
  assert.match(ui, /WhatsNewComposer/);
  assert.match(ui, /buildComboStatement/);
  assert.match(ui, /StatementBoard/);
  assert.match(ui, /useStatementView/);
  assert.match(ui, /downloadStatementCsv/);
  assert.match(ui, /onOpenLock/);
  assert.match(ui, /comboLockHash/);
  assert.match(board, /STATEMENT_DATE_FILTERS/);
  assert.match(board, /STATEMENT_KIND_FILTERS/);
  assert.match(board, /STATEMENT_RESULT_FILTERS/);
  assert.match(board, /statementCsv/);
  assert.match(board, /setSearchQuery\(searchInput\), 150/);
  assert.match(board, /stmt-row/);
  assert.match(board, /stmt-sub/);
  assert.match(board, /Open lock/);
  assert.doesNotMatch(ui, /<th>Kind<\/th>/);
  assert.doesNotMatch(board, /<th>Kind<\/th>/);
  assert.doesNotMatch(ui, /billing|credit card|kalshi key|polymarket key/i);
  assert.match(app, /loadProfilePrefs/);
  assert.match(app, /saveProfilePrefs/);
  assert.match(app, /UserProfile/);
  assert.match(app, /canSeeLocks=\{canSeeComboLocks\(user\)\}/);
  assert.match(app, /isOwner=\{Boolean\(user\)\}/);
}

console.log("userProfile.test.js ok");
