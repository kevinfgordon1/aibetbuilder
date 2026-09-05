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

/** Miss tape / Unhedged stay owner-only — do not expand Combo Locks via these. */
export function canSeeOwnerTools(user) {
  if (!user || !user.email) return false;
  return String(user.email).trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

export function parseAppHash(hash) {
  const raw = String(hash == null ? "" : hash).replace(/^#/, "").trim();
  if (!raw) return { tab: null, lockId: null };
  if (raw === "profile") return { tab: "profile", lockId: null };
  if (raw === "combo") return { tab: "combo", lockId: null };
  const combo = /^combo\/([^/?#]+)$/.exec(raw);
  if (combo) {
    try {
      return { tab: "combo", lockId: decodeURIComponent(combo[1]) };
    } catch (_) {
      return { tab: "combo", lockId: combo[1] };
    }
  }
  return { tab: null, lockId: null };
}

export function comboLockHash(lockId) {
  if (!lockId) return "#combo";
  return "#combo/" + encodeURIComponent(String(lockId));
}

export function profileHash() {
  return "#profile";
}

/** Strip a Combo Locks hash without advertising the feature. */
export function clearComboHash(hash) {
  const parsed = parseAppHash(hash);
  if (parsed.tab === "combo") return "";
  return hash == null ? "" : String(hash);
}
