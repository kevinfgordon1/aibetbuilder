// User profile identity + editable Promo defaults.
// Seeded from Google/Gmail sign-in (name, email, avatar). Prefs persist per
// auth uid in localStorage and on the Supabase user (user_metadata) so
// dismissed announcements follow the account across devices.
// Billing / exchange-key vault is parked.

export const PROFILE_PREFS_KEY = "aibetbuilder.profilePrefs";
export const PROFILE_PREFS_META_KEY = "aibetbuilderPrefs";

// First-time / unsaved prefs only. Saved sports win once the user customizes.
export const DEFAULT_PROFILE_SPORTS = ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"];
export const DEFAULT_PROFILE_BOOK = "draftkings";

export function profilePrefsStorageKey(userId) {
  return PROFILE_PREFS_KEY + "." + String(userId || "");
}

export function identityFromUser(user) {
  const meta = (user && user.user_metadata) || {};
  const name = String(meta.full_name || meta.name || "").trim();
  const email = String((user && user.email) || meta.email || "").trim();
  const avatar = String(meta.avatar_url || meta.picture || "").trim();
  return {
    id: user && user.id ? String(user.id) : "",
    name,
    email,
    avatar,
    provider: (user && user.app_metadata && user.app_metadata.provider) || "google",
  };
}

export function defaultProfilePrefs() {
  return {
    displayName: "",
    sports: DEFAULT_PROFILE_SPORTS.slice(),
    promoBook: DEFAULT_PROFILE_BOOK,
    seenAnnouncementId: "",
  };
}

export function persistableProfilePrefs(prefs) {
  const next = normalizeProfilePrefs(prefs);
  return {
    displayName: next.displayName,
    sports: next.sports,
    promoBook: next.promoBook,
    seenAnnouncementId: next.seenAnnouncementId,
  };
}

export function mergeProfilePrefSources(local, remote) {
  const a = local && typeof local === "object" ? local : {};
  const b = remote && typeof remote === "object" ? remote : {};
  const out = { ...a };
  if (typeof b.displayName === "string" && b.displayName.trim()) out.displayName = b.displayName;
  if (Array.isArray(b.sports) && b.sports.length) out.sports = b.sports;
  if (typeof b.promoBook === "string" && b.promoBook) out.promoBook = b.promoBook;
  if (typeof b.seenAnnouncementId === "string" && b.seenAnnouncementId.trim()) {
    out.seenAnnouncementId = b.seenAnnouncementId.trim();
  }
  return out;
}

function sanitizeSports(sports, allowedKeys) {
  const raw = Array.isArray(sports) ? sports : [];
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys || []);
  const out = [];
  const seen = new Set();
  for (const key of raw) {
    if (typeof key !== "string" || !key) continue;
    if (allowed.size && !allowed.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.length ? out : DEFAULT_PROFILE_SPORTS.slice();
}

export function normalizeProfilePrefs(raw, { allowedSports, allowedBooks } = {}) {
  const base = defaultProfilePrefs();
  const src = raw && typeof raw === "object" ? raw : {};
  const sports = sanitizeSports(src.sports, allowedSports);
  const book = typeof src.promoBook === "string" ? src.promoBook : base.promoBook;
  const books = allowedBooks instanceof Set ? allowedBooks : new Set(allowedBooks || []);
  const seen = typeof src.seenAnnouncementId === "string" ? src.seenAnnouncementId.trim() : "";
  return {
    displayName: typeof src.displayName === "string" ? src.displayName.trim() : "",
    sports,
    promoBook: books.size && !books.has(book) ? DEFAULT_PROFILE_BOOK : (book || DEFAULT_PROFILE_BOOK),
    seenAnnouncementId: seen,
  };
}

export function seedProfilePrefs(user, saved, opts) {
  const ident = identityFromUser(user);
  const prefs = normalizeProfilePrefs(saved, opts);
  if (!prefs.displayName && ident.name) prefs.displayName = ident.name;
  return { ...prefs, identity: ident };
}

export function loadProfilePrefs(user, { storage, allowedSports, allowedBooks } = {}) {
  const ident = identityFromUser(user);
  if (!ident.id) return seedProfilePrefs(user, null, { allowedSports, allowedBooks });
  let parsed = null;
  try {
    const store = storage ?? globalThis.localStorage;
    const raw = store && store.getItem(profilePrefsStorageKey(ident.id));
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const remote = user && user.user_metadata && user.user_metadata[PROFILE_PREFS_META_KEY];
  const merged = mergeProfilePrefSources(parsed, remote);
  return seedProfilePrefs(user, merged, { allowedSports, allowedBooks });
}

export function saveProfilePrefs(user, prefs, { storage, allowedSports, allowedBooks } = {}) {
  const ident = identityFromUser(user);
  if (!ident.id) return normalizeProfilePrefs(prefs, { allowedSports, allowedBooks });
  const next = normalizeProfilePrefs(prefs, { allowedSports, allowedBooks });
  try {
    const store = storage ?? globalThis.localStorage;
    if (store) {
      store.setItem(profilePrefsStorageKey(ident.id), JSON.stringify(persistableProfilePrefs(next)));
    }
  } catch {
    // quota / privacy mode
  }
  return next;
}

export async function persistProfilePrefsRemote(client, user, prefs) {
  const ident = identityFromUser(user);
  if (!ident.id || !client || !client.auth || typeof client.auth.updateUser !== "function") {
    return { persisted: false };
  }
  try {
    const { error } = await client.auth.updateUser({
      data: { [PROFILE_PREFS_META_KEY]: persistableProfilePrefs(prefs) },
    });
    if (error) return { persisted: false, error };
    return { persisted: true };
  } catch (error) {
    return { persisted: false, error };
  }
}

export function profileDisplayName(user, prefs) {
  const fromPrefs = prefs && String(prefs.displayName || "").trim();
  if (fromPrefs) return fromPrefs;
  const ident = identityFromUser(user);
  if (ident.name) return ident.name;
  if (ident.email) return ident.email.split("@")[0];
  return "Signed in";
}
