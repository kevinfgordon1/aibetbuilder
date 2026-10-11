// Promo Builder session exclusions: same identity parlayLegKey already uses
// (game + name). Kept in sessionStorage for the tab session, across filter,
// book, boost, refresh and Optimize! changes. "N hidden · Restore" clears.

export function promoLegIdentity(leg) {
  return `${leg.game}\0${leg.name}`;
}

export function filterExcludedLegs(legs, excluded) {
  if (!excluded || excluded.size === 0) return legs;
  return legs.filter((l) => !excluded.has(promoLegIdentity(l)));
}

export function filterParlaysByExcluded(parlays, excluded) {
  if (!excluded || excluded.size === 0) return parlays;
  return parlays.filter((p) => !(p.legs || []).some((l) => excluded.has(promoLegIdentity(l))));
}

export const EXCLUDED_LEGS_SESSION_KEY = "promoExcludedLegs";

export function loadSessionExcludedLegs(storage = typeof window !== "undefined" ? window.sessionStorage : null) {
  try {
    const raw = storage && storage.getItem(EXCLUDED_LEGS_SESSION_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveSessionExcludedLegs(excluded, storage = typeof window !== "undefined" ? window.sessionStorage : null) {
  try {
    if (!storage) return;
    if (!excluded || excluded.size === 0) storage.removeItem(EXCLUDED_LEGS_SESSION_KEY);
    else storage.setItem(EXCLUDED_LEGS_SESSION_KEY, JSON.stringify([...excluded]));
  } catch { /* storage full / blocked */ }
}
