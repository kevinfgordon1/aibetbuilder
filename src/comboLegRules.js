// Leg rules for a Combo Lock (client + mirrored by the DB trigger in
// sql/20261012_combo_single_leg.sql). 1 leg = single-leg lock (hedge rests on
// Kalshi + Polymarket single markets); 2+ legs = combo.
export const MIN_LOCK_LEGS = 1;
export const MAX_LOCK_LEGS = 12;

export function lockLegsError(legs) {
  const list = Array.isArray(legs) ? legs : [];
  if (list.length < MIN_LOCK_LEGS) return "Pick at least 1 leg (game + market).";
  if (list.length > MAX_LOCK_LEGS) return `A lock can have at most ${MAX_LOCK_LEGS} legs.`;
  const seen = new Set();
  for (const l of list) {
    const t = String((l && l.ticker) || "").trim();
    const side = String((l && l.side) || "").toLowerCase();
    if (!t || (side !== "yes" && side !== "no")) return "Every leg needs a market and a side.";
    if (seen.has(t)) return "The same market is picked twice.";
    seen.add(t);
  }
  return "";
}

export function isSingleLegLock(parlay) {
  const legs = Array.isArray(parlay && parlay.legs) ? parlay.legs.filter((l) => l && l.ticker) : [];
  return legs.length === 1;
}
