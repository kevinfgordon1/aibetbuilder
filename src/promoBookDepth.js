// Browser client for /api/book-depth. Cache + inflight dedupe so expanding
// BEST PICK twice does not re-hit venues. Sportsbooks never call the API.

export const DEPTH_VENUES = new Set(["kalshi", "polymarket", "prophetx", "novig"]);
const TTL_MS = 45 * 1000;
const cache = new Map();
const inflight = new Map();

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

export async function fetchPromoBookDepth(legs, { fetchImpl } = {}) {
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

  const inflightKey = missing.map(depthCacheKey).sort().join("\n");
  let pending = inflight.get(inflightKey);
  if (!pending) {
    const doFetch = fetchImpl || fetch;
    pending = doFetch("/api/book-depth", {
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
        if (!r || !r.ok) return [];
        const json = await r.json();
        return Array.isArray(json.results) ? json.results : [];
      })
      .catch(() => [])
      .finally(() => inflight.delete(inflightKey));
    inflight.set(inflightKey, pending);
  }

  const results = await pending;
  for (const row of results) {
    const key = row && row.key;
    const levels = Array.isArray(row && row.levels) ? row.levels : [];
    if (!key) continue;
    cache.set(key, { at: Date.now(), levels });
    out[key] = levels;
  }
  return out;
}

export function _resetPromoBookDepthCache() {
  cache.clear();
  inflight.clear();
}
