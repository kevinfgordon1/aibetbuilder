// Combo Locks visibility — private until Kevin opens it up.
//
// Auth identity: Google/Gmail via Supabase. Kevin signs in as kev120909@gmail.com
// (OWNER_EMAIL). Allow extra testers with VITE_COMBO_LOCKS_ALLOWLIST (comma-
// separated emails and/or Supabase auth uids). Kevin's email is always included
// so a missing env var cannot lock him out.
//
// This is a UI/route gate only. combo_* rows stay behind existing Supabase RLS.
// Do not use this list to expand Miss tape / Unhedged — those stay OWNER_EMAIL.

export const OWNER_EMAIL = "kev120909@gmail.com";

/** Vite public env: comma / space / semicolon separated emails or auth uids. */
export const COMBO_LOCKS_ALLOWLIST_ENV = "VITE_COMBO_LOCKS_ALLOWLIST";

function readEnvAllowlist(env) {
  if (env && typeof env === "object") {
    const direct = env[COMBO_LOCKS_ALLOWLIST_ENV] ?? env.COMBO_LOCKS_ALLOWLIST;
    if (direct != null && String(direct).trim()) return String(direct);
  }
  try {
    const vite = typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env[COMBO_LOCKS_ALLOWLIST_ENV]
      : "";
    if (vite != null && String(vite).trim()) return String(vite);
  } catch (_) { /* node tests without Vite */ }
  return "";
}

export function parseComboLocksAllowlist(raw) {
  if (raw == null || raw === "") return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function comboLocksAllowlist(env) {
  const items = new Set([OWNER_EMAIL.toLowerCase()]);
  for (const token of parseComboLocksAllowlist(readEnvAllowlist(env))) {
    items.add(token.toLowerCase());
  }
  return items;
}

function userTokens(user) {
  if (!user) return [];
  const out = [];
  if (user.email) out.push(String(user.email).trim().toLowerCase());
  if (user.id) out.push(String(user.id).trim().toLowerCase());
  return out.filter(Boolean);
}

/** True when this signed-in user may see Combo Locks UI, routes, and lock P/L. */
export function canSeeComboLocks(user, env) {
  if (!user) return false;
  const allowed = comboLocksAllowlist(env);
  return userTokens(user).some((t) => allowed.has(t));
}

/**
 * Profile Combo Locks P/L / statement / history.
 * Same allowlist as the Combo Locks tab (canSeeComboLocks). isOwner is the
 * signed-in user's own profile — default false so a public/other-player
 * profile cannot leak lock P/L even when the subject is Kevin.
 */
export function profileShowsComboPnl(user, { isOwner = false } = {}, env) {
  return !!(isOwner && canSeeComboLocks(user, env));
}

/** Miss tape / Unhedged stay owner-only — do not expand Combo Locks via these. */
export function canSeeOwnerTools(user) {
  if (!user || !user.email) return false;
  return String(user.email).trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

/** Public + gated tab slugs written into the hash. Aliases normalize on parse. */
export const APP_HASH_TABS = Object.freeze({
  promo: "promo",
  ev: "ev",
  odds: "odds",
  combo: "combo",
  missTape: "missTape",
  miss: "missTape",
  "miss-tape": "missTape",
  unhedged: "unhedged",
  profile: "profile",
});

export function emptyAppRoute() {
  return { tab: null, lockId: null, cardId: null };
}

function decodeHashSeg(seg) {
  try {
    return decodeURIComponent(seg);
  } catch (_) {
    return seg;
  }
}

export function parseAppHash(hash) {
  const raw = String(hash == null ? "" : hash).replace(/^#/, "").trim();
  if (!raw) return emptyAppRoute();
  const parts = raw.split("/").filter((p) => p !== "");
  const slug = parts[0];
  const tab = APP_HASH_TABS[slug] || null;
  if (!tab) return emptyAppRoute();
  const rest = parts.slice(1);
  if (tab === "combo") {
    if (!rest.length) return { tab: "combo", lockId: null, cardId: null };
    return { tab: "combo", lockId: decodeHashSeg(rest[0]), cardId: null };
  }
  if (tab === "promo" || tab === "ev") {
    if (!rest.length) return { tab, lockId: null, cardId: null };
    return { tab, lockId: null, cardId: decodeHashSeg(rest.join("/")) };
  }
  return { tab, lockId: null, cardId: null };
}

export function serializeAppHash({ tab = null, lockId = null, cardId = null } = {}) {
  const resolved = APP_HASH_TABS[tab] || null;
  if (!resolved) return "";
  if (resolved === "combo") {
    if (!lockId) return "#combo";
    return "#combo/" + encodeURIComponent(String(lockId));
  }
  if (resolved === "promo" || resolved === "ev") {
    if (!cardId) return "#" + resolved;
    return "#" + resolved + "/" + encodeURIComponent(String(cardId));
  }
  if (resolved === "missTape") return "#missTape";
  return "#" + resolved;
}

export function comboLockHash(lockId) {
  return serializeAppHash({ tab: "combo", lockId });
}

export function profileHash() {
  return serializeAppHash({ tab: "profile" });
}

export function tabHash(tab, extra = {}) {
  return serializeAppHash({ tab, ...extra });
}

/** Strip a Combo Locks hash without advertising the feature. */
export function clearComboHash(hash) {
  const parsed = parseAppHash(hash);
  if (parsed.tab === "combo") return "";
  return hash == null ? "" : String(hash);
}

/**
 * Gate a parsed hash for the current user. Combo / owner tabs never keep
 * lock ids or land on those views unless the user is allowed. Denied links
 * fall back to Promo with a soft sign-in / no-access notice — no lock copy.
 */
export function resolveAppHash(parsed, user) {
  const route = parsed && typeof parsed === "object" ? parsed : emptyAppRoute();
  const tab = route.tab;
  if (!tab) {
    return { tab: "promo", lockId: null, cardId: null, notice: null, allowed: true };
  }
  if (tab === "combo") {
    if (canSeeComboLocks(user)) {
      return { tab: "combo", lockId: route.lockId || null, cardId: null, notice: null, allowed: true };
    }
    return {
      tab: "promo",
      lockId: null,
      cardId: null,
      notice: user ? "noaccess" : "signin",
      allowed: false,
    };
  }
  if (tab === "missTape" || tab === "unhedged") {
    if (canSeeOwnerTools(user)) {
      return { tab, lockId: null, cardId: null, notice: null, allowed: true };
    }
    return {
      tab: "promo",
      lockId: null,
      cardId: null,
      notice: user ? "noaccess" : "signin",
      allowed: false,
    };
  }
  if (tab === "profile") {
    if (user) return { tab: "profile", lockId: null, cardId: null, notice: null, allowed: true };
    return { tab: "promo", lockId: null, cardId: null, notice: "signin", allowed: false };
  }
  return {
    tab,
    lockId: null,
    cardId: route.cardId || null,
    notice: null,
    allowed: true,
  };
}

export function hashesEqual(a, b) {
  const left = serializeAppHash(typeof a === "string" ? parseAppHash(a) : (a || {}));
  const right = serializeAppHash(typeof b === "string" ? parseAppHash(b) : (b || {}));
  return left === right;
}
