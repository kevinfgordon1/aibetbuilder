// Promo Builder "Min depth per leg" (owner-only, canSeeOwnerTools).
//
// Depth = dollar STAKE resting at the leg's best opposing price (the top
// American band of the bestOppBook ladder; sizes are $ stake, see
// lib/book-depth.js). It does NOT change how the best opposing price is
// chosen (inverse method: best price across Kalshi / Polymarket / Novig /
// ProphetX after each venue's fee). It only gates whether that price
// qualifies. A leg whose best opposing price has less than the minimum at
// that price is dropped from the scan pool and from ranked picks.
// Sportsbook opposing prices have no depth feed → they never qualify while
// a minimum is set. 0 / blank = off (current behavior).

import { resolvePmBookLevels, isPmBlendVenue } from "./blendAskLadder.js";
import { depthCacheKey } from "./promoBookDepth.js";

export const MIN_LEG_DEPTH_LABEL = "Min depth per leg";
const STORAGE_PREFIX = "abb.promoMinLegDepth.";

export function parseMinLegDepth(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function storageKey(user) {
  const id = user && (user.email || user.id);
  return id ? STORAGE_PREFIX + String(id).trim().toLowerCase() : null;
}

export function loadMinLegDepth(user, storage = globalThis.localStorage) {
  const key = storageKey(user);
  if (!key || !storage) return 0;
  try { return parseMinLegDepth(storage.getItem(key)); } catch { return 0; }
}

export function saveMinLegDepth(user, value, storage = globalThis.localStorage) {
  const key = storageKey(user);
  if (!key || !storage) return;
  try {
    const n = parseMinLegDepth(value);
    if (n > 0) storage.setItem(key, String(n));
    else storage.removeItem(key);
  } catch { /* private mode */ }
}

// $ stake at the top American band of the best opposing venue, or null when
// unknown (sportsbook / no ladder / no bestOppSize).
export function topBandDepthUsd(leg, levels) {
  if (!leg || !isPmBlendVenue(leg.bestOppBook)) return null;
  const ladder = resolvePmBookLevels(leg, levels);
  if (!ladder.length) return null;
  const topAm = ladder[0].american;
  let size = 0;
  for (const lvl of ladder) {
    if (lvl.american !== topAm) break;
    size += lvl.size;
  }
  return size;
}

export function legMeetsMinDepth(leg, minDepth, levels) {
  const min = parseMinLegDepth(minDepth);
  if (!min) return true;
  const d = topBandDepthUsd(leg, levels);
  return d != null && d + 0.5 >= min;
}

// Scan pool: uses the stored ladder / bestOppSize carried on each leg.
export function filterLegsByMinDepth(legs, minDepth) {
  const list = Array.isArray(legs) ? legs : [];
  if (!parseMinLegDepth(minDepth)) return list;
  return list.filter((l) => legMeetsMinDepth(l, minDepth, null));
}

// Ranked picks: re-check with the live page ladders when loaded.
export function filterPicksByMinDepth(picks, minDepth, laddersByKey) {
  const list = Array.isArray(picks) ? picks : [];
  if (!parseMinLegDepth(minDepth)) return list;
  return list.filter((p) => (p && p.legs || []).every((l) => {
    const raw = { ...l, bestOpp: l.bestOppQuoted != null ? l.bestOppQuoted : l.bestOpp };
    const lv = laddersByKey ? laddersByKey[depthCacheKey(raw)] : null;
    return legMeetsMinDepth(raw, minDepth, lv);
  }));
}
