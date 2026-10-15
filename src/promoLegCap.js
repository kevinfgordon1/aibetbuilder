// Monotonic leg cap for the parlay scan.
// Date windows nest: today ⊂ 48h ⊂ 7d ⊂ any. A plain "top N by edge" cap on
// a wider window can push out a leg the narrower window kept, so 7 Days could
// miss Today's best parlay. Keep the union of each nested window's top-N, so
// every leg a narrower window keeps is still kept in the wider one.
import { isWithinDateRange } from "./dateRange.js";

export const NESTED_DATE_RANGES = ["today", "48h", "7d", "any"];

// Hard ceiling keeps C(n,3) bounded (~0.8s at 400 legs). Narrow windows are
// filled first, so Today / 48h legs are always the ones kept.
export const LEG_CAP_CEILING = 400;

export function capLegsMonotonic(sortedLegs, dateRange, cap, now = new Date(), ceiling = LEG_CAP_CEILING) {
  const list = Array.isArray(sortedLegs) ? sortedLegs : [];
  const n = Number(cap);
  if (!Number.isFinite(n) || n < 0 || list.length <= n) return list.slice();
  const idx = NESTED_DATE_RANGES.indexOf(dateRange || "any");
  const ranges = idx < 0 ? [dateRange] : NESTED_DATE_RANGES.slice(0, idx + 1);
  const keep = new Set();
  for (const r of ranges) {
    let taken = 0;
    for (const leg of list) {
      if (taken >= n || keep.size >= ceiling) break;
      if (!isWithinDateRange(leg && leg.commence_time, r, now)) continue;
      if (!keep.has(leg)) keep.add(leg);
      taken++;
    }
  }
  return list.filter((l) => keep.has(l)); // stays in edge order
}
