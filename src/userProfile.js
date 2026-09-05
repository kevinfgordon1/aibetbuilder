// User profile identity + editable Promo defaults.
// Seeded from Google/Gmail sign-in (name, email, avatar). Prefs persist per
// auth uid in localStorage. Billing / exchange-key vault is parked.

export const PROFILE_PREFS_KEY = "aibetbuilder.profilePrefs";

export const DEFAULT_PROFILE_SPORTS = ["baseball_mlb", "americanfootball_ncaaf"];
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
  };
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
  return {
    displayName: typeof src.displayName === "string" ? src.displayName.trim() : "",
    sports,
    promoBook: books.size && !books.has(book) ? DEFAULT_PROFILE_BOOK : (book || DEFAULT_PROFILE_BOOK),
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
  return seedProfilePrefs(user, parsed, { allowedSports, allowedBooks });
}

export function saveProfilePrefs(user, prefs, { storage, allowedSports, allowedBooks } = {}) {
  const ident = identityFromUser(user);
  if (!ident.id) return normalizeProfilePrefs(prefs, { allowedSports, allowedBooks });
  const next = normalizeProfilePrefs(prefs, { allowedSports, allowedBooks });
  try {
    const store = storage ?? globalThis.localStorage;
    if (store) {
      store.setItem(profilePrefsStorageKey(ident.id), JSON.stringify({
        displayName: next.displayName,
        sports: next.sports,
        promoBook: next.promoBook,
      }));
    }
  } catch {
    // quota / privacy mode
  }
  return next;
}

export function profileDisplayName(user, prefs) {
  const fromPrefs = prefs && String(prefs.displayName || "").trim();
  if (fromPrefs) return fromPrefs;
  const ident = identityFromUser(user);
  if (ident.name) return ident.name;
  if (ident.email) return ident.email.split("@")[0];
  return "Signed in";
}
