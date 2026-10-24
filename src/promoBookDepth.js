// Browser client for /api/book-depth. Cache + inflight dedupe so expanding
// BEST PICK twice does not re-hit venues. Sportsbooks never call the API.

import { applyPmBlendToLegs } from "./blendAskLadder.js";

export const DEPTH_VENUES = new Set(["kalshi", "polymarket", "prophetx", "novig"]);
const TTL_MS = 45 * 1000;
const cache = new Map();
const inflight = new Map();
// Last non-empty ladder per key. A venue that answers with no levels for a
// market it had depth on moments ago is treated as "unknown", not "thin", so
// Hide low liquidity does not flip picks in and out on each refresh.
const STICKY_MS = 3 * 60 * 1000;
const lastGood = new Map();

// Keys the last fetch could not read (request failed, rate limited, timed
// out, or the venue answered with a transient error) and that have no recent
// good ladder. Callers must treat these legs as "depth unknown", never thin.
// Returned on the ladder map under this symbol (Object.keys ignores it).
export const DEPTH_UNKNOWN = Symbol.for("abb.depthUnknown");
export function unknownDepthKeys(map) {
  const s = map && map[DEPTH_UNKNOWN];
  return s instanceof Set ? s : EMPTY_SET;
}
const EMPTY_SET = new Set();
const CHUNK_RETRIES = 2;
const CHUNK_RETRY_BASE_MS = 400;
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function depthCacheKey(leg) {
  if (!leg) return "";
  return [leg.bestOppBook, leg.sport, leg.game, leg.bestOppName || leg.name, leg.market].join("|");
}

export function venueHasDepthApi(bookKey) {
  return DEPTH_VENUES.has(String(bookKey || "").toLowerCase());
}

export function legsNeedingDepth(legs) {
  return (legs || []).filter((l) => venueHasDepthApi(l && l.bestOppBook));
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.levels;
}

// /api/book-depth slices to MAX_LEGS (8). A visible promo page can name more
// unique PM legs than that, so chunk or the later cards never get a ladder.
const DEPTH_BATCH = 8;

// One POST. Resolves { ok, results }; ok=false when the request itself failed
// (network, non-2xx, function timeout) or the API reported a top-level error.
function postDepthChunk(missing, doFetch) {
  return doFetch("/api/book-depth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        legs: missing.map((l) => ({
          bestOppBook: l.bestOppBook,
          sport: l.sport,
          market: l.market,
          game: l.game,
          bestOppName: l.bestOppName,
          name: l.name,
          commence_time: l.commence_time,
        })),
      }),
    })
    .then(async (r) => {
      if (!r || !r.ok) return { ok: false, results: [] };
      const json = await r.json();
      const results = Array.isArray(json && json.results) ? json.results : [];
      return { ok: !(json && json.error) || results.length > 0, results };
    })
    .catch(() => ({ ok: false, results: [] }));
}

async function fetchDepthChunk(missing, fetchImpl, retryDelayMs = CHUNK_RETRY_BASE_MS) {
  const inflightKey = missing.map(depthCacheKey).sort().join("\n");
  let pending = inflight.get(inflightKey);
  if (!pending) {
    const doFetch = fetchImpl || fetch;
    pending = (async () => {
      let res = await postDepthChunk(missing, doFetch);
      for (let i = 0; i < CHUNK_RETRIES && !res.ok; i++) {
        await wait(retryDelayMs * (2 ** i));
        res = await postDepthChunk(missing, doFetch);
      }
      return res;
    })().finally(() => inflight.delete(inflightKey));
    inflight.set(inflightKey, pending);
  }

  const { results } = await pending;
  const out = {};
  const unknown = new Set();
  const seen = new Set();
  const now = Date.now();
  for (const row of results) {
    const key = row && row.key;
    if (!key) continue;
    seen.add(key);
    let levels = Array.isArray(row.levels) ? row.levels : [];
    const prev = lastGood.get(key);
    const prevFresh = prev && now - prev.at <= STICKY_MS ? prev.levels : null;
    if (levels.length) {
      lastGood.set(key, { at: now, levels });
    } else if (prevFresh) {
      levels = prevFresh;
    } else if (row.transient) {
      // Venue could not be read: unknown, and never cached as empty.
      unknown.add(key);
      continue;
    }
    cache.set(key, { at: now, levels });
    out[key] = levels;
  }
  // Legs the API never answered for (request failed after retries).
  for (const leg of missing) {
    const key = depthCacheKey(leg);
    if (seen.has(key)) continue;
    const prev = lastGood.get(key);
    if (prev && now - prev.at <= STICKY_MS) out[key] = prev.levels;
    else unknown.add(key);
  }
  return { out, unknown };
}

export async function fetchPromoBookDepth(legs, { fetchImpl, retryDelayMs } = {}) {
  const wanted = legsNeedingDepth(legs);
  if (!wanted.length) return {};
  const out = {};
  const missing = [];
  for (const leg of wanted) {
    const key = depthCacheKey(leg);
    const cached = readCache(key);
    if (cached) out[key] = cached;
    else missing.push(leg);
  }
  if (!missing.length) return out;

  const chunks = [];
  for (let i = 0; i < missing.length; i += DEPTH_BATCH) chunks.push(missing.slice(i, i + DEPTH_BATCH));
  const parts = await Promise.all(chunks.map((chunk) => fetchDepthChunk(chunk, fetchImpl, retryDelayMs)));
  const unknown = new Set();
  for (const part of parts) {
    Object.assign(out, part.out);
    for (const k of part.unknown) unknown.add(k);
  }
  if (unknown.size) Object.defineProperty(out, DEPTH_UNKNOWN, { value: unknown, enumerable: false });
  return out;
}

export function _resetPromoBookDepthCache() {
  cache.clear();
  inflight.clear();
  lastGood.clear();
}

// Overlay bestOpp from a real ladder or top-of-book size. Never invents books.
// PM legs walk to $500 profit (excl. stake) for 1-leg and multi-leg.
export function applyBlendToLegs(legs, laddersByKey, ctx = {}) {
  return applyPmBlendToLegs(legs, laddersByKey, ctx);
}
