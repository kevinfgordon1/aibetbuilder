// A wider date window (superset of legs) must never show a lower best EV.
import test from "node:test";
import assert from "node:assert/strict";
import { findTopParlaysChunked, diversifyTopParlays, SCAN_DEEP_RESULTS } from "./promoParlayScan.js";
import { visiblePromoAfterDepth, PROMO_DEPTH_WINDOW_MAX } from "./promoListRank.js";

const leg = (name, ev, thin = false) => ({ game: name + " game", name, ev, thin, sport: "nhl" });
// Top-of-book EV = sum; live depth knocks thin legs down hard.
const calc = (ls) => ({ ev: ls.reduce((s, l) => s + l.ev, 0), parlayOdds: 500 });
const depthEv = (p) => p.legs.reduce((s, l) => s + (l.thin ? l.ev - 20 : l.ev), 0);
const rankPage = (head) => head.map((p) => ({ ...p, ev: depthEv(p) })).sort((a, b) => b.ev - a.ev);

async function bestShown(legs, maxResults, window, fixed = true) {
  const scanned = await findTopParlaysChunked(legs, 3, calc, { maxResults: fixed ? SCAN_DEEP_RESULTS : maxResults, yieldFn: async () => {} });
  const base = fixed ? diversifyTopParlays(scanned) : scanned.sort((a, b) => b.ev - a.ev);
  const r = visiblePromoAfterDepth(base, 5, {}, rankPage, Math.min(base.length, window));
  return r.visible[0];
}

test("superset window keeps the narrow window's best combo", async () => {
  const today = [leg("Broncos", 30), leg("Devils", 28), leg("Flames", 31)];
  const extra = Array.from({ length: 14 }, (_, i) => leg("Thin" + i, 35 + i * 0.1, true));
  const narrow = await bestShown(today, 150, PROMO_DEPTH_WINDOW_MAX);
  const wide = await bestShown(today.concat(extra), 150, PROMO_DEPTH_WINDOW_MAX);
  assert.ok(wide.ev >= narrow.ev, `wide ${wide.ev} < narrow ${narrow.ev}`);
  // Old behaviour (depth-check only the first page of 5) loses the combo.
  const old = await bestShown(today.concat(extra), 50, 5, false);
  assert.ok(old.ev < narrow.ev);
});
