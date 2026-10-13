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
