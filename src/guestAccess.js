// Logged-out visitors can use the public tool. Sign-in is reserved for
// actions that save or page past the first results. Copy link and Share image
// stay open to guests: both run in the browser (no server auth), and every
// shared link is free marketing.

export const GUEST_EXPLAINER_COPY = "Got a sportsbook boost or free bet? We find the bet where it's worth the most. Pick your book, see the best bet, place it yourself. Free to sign in.";

export const PUBLIC_APP_TABS = Object.freeze(["promo", "ev", "odds"]);

export const GUEST_GATED_ACTIONS = Object.freeze([
  "show-more",
  "save",
  "combo",
  "profile",
]);

export function isPublicAppTab(tab) {
  return PUBLIC_APP_TABS.includes(tab);
}

export function guestActionNeedsSignIn(action) {
  return GUEST_GATED_ACTIONS.includes(action);
}

function legWord(numLegs) {
  const n = Number(numLegs);
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  return count === 1 ? "1 leg" : `${count} legs`;
}

function money(stake) {
  const n = Number(stake);
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n)}`;
}

/**
 * One-line mobile summary of the Promo controls.
 * First visit (logged out or signed in) collapses to
 * "DraftKings · 30% boost · $100 · 3 legs — Edit".
 */
export function promoControlSummary({ bookLabel, promoType, boostPct, stake, numLegs } = {}) {
  const book = bookLabel || "Sportsbook";
  let promoBit = "No promo";
  if (promoType === "boost") {
    const pct = Number(boostPct);
    promoBit = `${Number.isFinite(pct) ? pct : 0}% boost`;
  } else if (promoType === "freebet") promoBit = "Free bet";
  else if (promoType === "nosweat") promoBit = "No sweat";
  return `${book} · ${promoBit} · ${money(stake)} · ${legWord(numLegs)}`;
}

// Signed-out visitors see this many ranked picks in full; the rest blur.
export const GUEST_FULL_PICKS = 2;
export const GUEST_PICKS_GATE_COPY = "Sign in free to see all picks";

export const GUEST_SOFT_PROMPT_TITLE = "Browsing as a guest";
export const GUEST_SOFT_PROMPT_COPY = "You’re browsing as a guest. Sign in free to save your boosts and unlock the rest of the picks. No card.";
export const GUEST_SOFT_PROMPT_OPTIMIZES = 2;
export const GUEST_SOFT_PROMPT_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
// supabase-js session slot. Not the PKCE verifier (sb-…-auth-token-code-verifier).
const STORED_AUTH_KEY = /^sb-.+-auth-token$/;
const SOFT_LOCAL_KEY = "abb_soft_signin_prompt_at";
const SOFT_SESSION_KEY = "abb_soft_signin_prompt_session";

function safeStore(kind) {
  try { return typeof window !== "undefined" ? window[kind] : null; } catch { return null; }
}

/** True when localStorage still holds a Supabase session that may be restoring. */
export function hasStoredAuthSession(storage) {
  if (!storage || typeof storage.length !== "number" || typeof storage.key !== "function") return false;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !STORED_AUTH_KEY.test(key)) continue;
      const value = storage.getItem(key);
      if (value && (value.includes("access_token") || value.includes("refresh_token"))) return true;
    }
  } catch { return false; }
  return false;
}

/**
 * Soft guest tip only. Hard gates use askSignIn directly.
 * Auth must be finished, the visitor must be signed out, and no sb-*-auth-token
 * may still be sitting in storage (a refresh can still be in flight).
 */
export function canShowGuestSoftPrompt({ user, authLoading, storage } = {}) {
  if (authLoading) return false;
  if (user) return false;
  if (hasStoredAuthSession(storage)) return false;
  return true;
}

// Pure check, storage injectable for tests.
export function shouldShowSoftPrompt(nowMs, { local = safeStore("localStorage"), session = safeStore("sessionStorage") } = {}) {
  try {
    if (session?.getItem(SOFT_SESSION_KEY)) return false;
    const last = Number(local?.getItem(SOFT_LOCAL_KEY));
    if (Number.isFinite(last) && last > 0 && nowMs - last < GUEST_SOFT_PROMPT_QUIET_MS) return false;
  } catch { /* storage blocked: still show once */ }
  return true;
}

export function markSoftPromptShown(nowMs, { local = safeStore("localStorage"), session = safeStore("sessionStorage") } = {}) {
  try { session?.setItem(SOFT_SESSION_KEY, "1"); } catch {}
  try { local?.setItem(SOFT_LOCAL_KEY, String(nowMs)); } catch {}
}
