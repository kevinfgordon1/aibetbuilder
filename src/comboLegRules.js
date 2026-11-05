// Leg rules for a Combo Lock (client + mirrored by the DB trigger in
// sql/20261012_combo_single_leg.sql, upper bound dropped in
// supabase/migrations/20261105040000_combo_legs_no_max.sql). 1 leg = single-leg
// lock (hedge rests on Kalshi + Polymarket single markets); 2+ legs = combo.
// No maximum leg count: the only Combo Locks limits are the user's contract cap
// and the cash in their prediction-market account.
export const MIN_LOCK_LEGS = 1;

export function lockLegsError(legs) {
  const list = Array.isArray(legs) ? legs : [];
  if (list.length < MIN_LOCK_LEGS) return "Pick at least 1 leg (game + market).";
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
