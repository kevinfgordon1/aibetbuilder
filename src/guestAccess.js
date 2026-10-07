// Logged-out visitors can use the public tool. Sign-in is reserved for
// actions that save, share, or page past the first results.

export const GUEST_EXPLAINER_COPY = "Got a sportsbook boost or free bet? We find the bet where it's worth the most. Pick your book, see the best bet, place it yourself. Free to sign in.";

export const PUBLIC_APP_TABS = Object.freeze(["promo", "ev", "odds"]);

export const GUEST_GATED_ACTIONS = Object.freeze([
  "show-more",
  "copy-link",
  "share-image",
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
