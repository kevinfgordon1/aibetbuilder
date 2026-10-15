import test from "node:test";
import assert from "node:assert/strict";
import { holdDepthRankWhilePending } from "./promoListRank.js";
import { fetchPromoBookDepth, depthCacheKey, _resetPromoBookDepthCache } from "./promoBookDepth.js";

test("pending ladders keep last depth-ranked page for same filters", () => {
  const prev = { filtersKey: "k", result: { visible: [], rest: [] } };
  const raw = { visible: [{ id: 1 }], rest: [] };
  assert.equal(holdDepthRankWhilePending(raw, null, prev, "k"), prev.result);
  assert.equal(holdDepthRankWhilePending(raw, null, prev, "other"), raw);
  assert.equal(holdDepthRankWhilePending(raw, {}, prev, "k"), raw);
  assert.equal(holdDepthRankWhilePending(raw, null, null, "k"), raw);
});

test("transient empty ladder keeps last known depth", async () => {
  _resetPromoBookDepthCache();
  const leg = { bestOppBook: "kalshi", sport: "nhl", game: "A @ B", bestOppName: "A", market: "ML" };
  const key = depthCacheKey(leg);
  const mk = (levels) => async () => ({ ok: true, json: async () => ({ results: [{ key, levels }] }) });
  const first = await fetchPromoBookDepth([leg], { fetchImpl: mk([{ american: -150, size: 900 }]) });
  assert.equal(first[key].length, 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 1000; // past 45s cache TTL
  try {
    const second = await fetchPromoBookDepth([leg], { fetchImpl: mk([]) });
    assert.equal(second[key].length, 1);
  } finally { Date.now = realNow; }
});

import { visiblePromoAfterDepth, nextPromoDepthWindow, maskUncheckedWhileHidingThin } from "./promoListRank.js";

test("depth filter dropping the whole page backfills from a wider window", () => {
  const base = Array.from({ length: 50 }, (_, i) => ({ id: i }));
  const rank = (head) => head.filter((p) => p.id >= 7); // first 7 are thin
  const page = visiblePromoAfterDepth(base, 5, {}, rank, 5);
  assert.equal(page.visible.length, 0);
  assert.equal(page.hidden, 5);
  assert.equal(page.needsWiderWindow, true);
  const w = nextPromoDepthWindow(5, 5, 50);
  assert.equal(w, 20);
  const wide = visiblePromoAfterDepth(base, 5, {}, rank, w);
  assert.deepEqual(wide.visible.map((p) => p.id), [7, 8, 9, 10, 11]);
  assert.equal(wide.rest.length, 50 - 7 - 5);
  assert.equal(wide.hidden, 7);
  assert.equal(wide.needsWiderWindow, false);
});

test("first load with Hide low liquidity shows checking, not raw picks", () => {
  const pending = visiblePromoAfterDepth([{ id: 1 }], 5, null, (h) => h, 5);
  assert.equal(maskUncheckedWhileHidingThin(pending, true).visible.length, 0);
  assert.equal(maskUncheckedWhileHidingThin(pending, true).checking, true);
  assert.equal(maskUncheckedWhileHidingThin(pending, false).visible.length, 1);
});
