import test from "node:test";
import assert from "node:assert/strict";
import { fetchPromoBookDepth, depthCacheKey, unknownDepthKeys, _resetPromoBookDepthCache, DEPTH_UNKNOWN } from "./promoBookDepth.js";
import { visiblePromoAfterDepth, promoDepthNoticeKind } from "./promoListRank.js";

const leg = (name) => ({ bestOppBook: "kalshi", sport: "americanfootball_ncaaf", game: "A @ B", bestOppName: name, market: "ML" });
const ok = (json) => ({ ok: true, json: async () => json });

test("failed depth request retries, then marks legs unknown (not empty)", async () => {
  _resetPromoBookDepthCache();
  const l = leg("A");
  let calls = 0;
  const map = await fetchPromoBookDepth([l], { retryDelayMs: 0, fetchImpl: async () => { calls++; return { ok: false, status: 504 }; } });
  assert.equal(calls, 3, "1 try + 2 retries");
  assert.equal(map[depthCacheKey(l)], undefined, "no fake empty ladder");
  assert.ok(unknownDepthKeys(map).has(depthCacheKey(l)));
  assert.deepEqual(Object.keys(map), []);
});

test("unknown legs are not cached: next call refetches and recovers", async () => {
  _resetPromoBookDepthCache();
  const l = leg("A");
  const key = depthCacheKey(l);
  await fetchPromoBookDepth([l], { retryDelayMs: 0, fetchImpl: async () => { throw new Error("network"); } });
  const map = await fetchPromoBookDepth([l], { retryDelayMs: 0, fetchImpl: async () => ok({ results: [{ key, levels: [{ american: -150, size: 9000 }] }] }) });
  assert.equal(map[key].length, 1);
  assert.equal(unknownDepthKeys(map).size, 0);
});

test("transient row from API = unknown; real empty = known-thin", async () => {
  _resetPromoBookDepthCache();
  const a = leg("A"), b = leg("B");
  const map = await fetchPromoBookDepth([a, b], { retryDelayMs: 0, fetchImpl: async () => ok({ results: [
    { key: depthCacheKey(a), levels: [], reason: "error:kalshi_catalog_429", transient: true },
    { key: depthCacheKey(b), levels: [], reason: "kalshi_orderbook_empty" },
  ] }) });
  assert.ok(unknownDepthKeys(map).has(depthCacheKey(a)));
  assert.deepEqual(map[depthCacheKey(b)], []);
});

test("transient failure falls back to last good ladder when recent", async () => {
  _resetPromoBookDepthCache();
  const a = leg("A");
  const key = depthCacheKey(a);
  await fetchPromoBookDepth([a], { fetchImpl: async () => ok({ results: [{ key, levels: [{ american: -150, size: 9000 }] }] }) });
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 1000;
  try {
    const map = await fetchPromoBookDepth([a], { retryDelayMs: 0, fetchImpl: async () => ({ ok: false, status: 429 }) });
    assert.equal(map[key].length, 1);
    assert.equal(unknownDepthKeys(map).size, 0);
  } finally { Date.now = realNow; }
});

test("picks dropped only because depth is unknown count as unknown, not hidden", () => {
  const picks = [{ id: 1, k: "x" }, { id: 2, k: "y" }, { id: 3, k: "z" }];
  const ladders = { y: [] };
  Object.defineProperty(ladders, DEPTH_UNKNOWN, { value: new Set(["x", "z"]), enumerable: false });
  const rankPage = (head, map) => head.filter((p) => Array.isArray(map[p.k]) && map[p.k].length); // missing/empty → dropped
  const r = visiblePromoAfterDepth(picks, 10, ladders, rankPage, 10, { keysOfPick: (p) => [p.k] });
  assert.equal(r.visible.length, 0);
  assert.equal(r.unknown, 2);
  assert.equal(r.hidden, 1);
  assert.equal(promoDepthNoticeKind(r), "unavailable");
});

test("thin notice only when every dropped pick was measured", () => {
  const picks = [{ id: 1, k: "x" }];
  const r = visiblePromoAfterDepth(picks, 10, { x: [] }, (h) => h.filter(() => false), 10, { keysOfPick: (p) => [p.k] });
  assert.equal(r.unknown, 0);
  assert.equal(r.hidden, 1);
  assert.equal(promoDepthNoticeKind(r), "thin");
  assert.equal(promoDepthNoticeKind(r, { allChecked: false }), null);
  assert.equal(promoDepthNoticeKind({ checking: true }), "checking");
  assert.equal(promoDepthNoticeKind({ visible: [{}], hidden: 3 }), null);
});
