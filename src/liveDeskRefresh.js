// Live Trading Desk refresh budget.
//
// A healthy poll is 12s. Cloudflare 1015 / HTTP 429 from Polymarket US
// stretches the next poll into 30–60s with jitter so a shared Vercel egress
// IP is not retried on the same cadence that tripped the edge. The tab
// still skips the network while hidden; that check lives in the component.

export const DESK_REFRESH_MS = 12000;
export const DESK_BACKOFF_MIN_MS = 30000;
export const DESK_BACKOFF_MAX_MS = 60000;
const DEFAULT_RETRY_AFTER_SEC = 45;

export function deskRateLimitMessage(retryAfterSec) {
  const n = Number(retryAfterSec);
  const seconds = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_RETRY_AFTER_SEC;
  return "Polymarket is rate-limiting us, retrying in " + seconds + "s";
}

export function isDeskRateLimit(value) {
  if (value == null || value === false) return false;
  if (typeof value === "number") return value === 429;
  if (typeof value === "string") {
    return /error 1015|you are being rate limited|"error_code"\s*:\s*1015/i.test(value);
  }
  if (typeof value !== "object") return false;
  if (value.rateLimited === true) return true;
  if (Number(value.error_code) === 1015 || Number(value.errorCode) === 1015) return true;
  if (typeof value.title === "string" && /error 1015|rate limited/i.test(value.title)) return true;
  if (typeof value.message === "string" && isDeskRateLimit(value.message)) return true;
  if (typeof value.error === "string" && isDeskRateLimit(value.error)) return true;
  if (Number(value.status) === 429 || Number(value.statusCode) === 429) return true;
  return false;
}

// Honor a server retryAfter when it falls in the backoff window. Values
// outside 30–60s are clamped, then jittered by ±5s and clamped again.
export function deskBackoffMs(retryAfterSec, rand = Math.random) {
  const hinted = Number(retryAfterSec);
  const baseSec = Number.isFinite(hinted) && hinted > 0 ? hinted : DEFAULT_RETRY_AFTER_SEC;
  const clamped = Math.min(DESK_BACKOFF_MAX_MS, Math.max(DESK_BACKOFF_MIN_MS, baseSec * 1000));
  const unit = typeof rand === "function" ? Number(rand()) : Number(rand);
  const u = Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0.5;
  const jittered = clamped + (u - 0.5) * 10000;
  return Math.round(Math.min(DESK_BACKOFF_MAX_MS, Math.max(DESK_BACKOFF_MIN_MS, jittered)));
}

export function deskRefreshDelayMs(input, rand) {
  if (!input || !input.rateLimited) return DESK_REFRESH_MS;
  return deskBackoffMs(input.retryAfter, rand);
}

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

// A failed positions/orders section keeps the last good rows and marks them
// stale. A successful empty list replaces them. The NFL slate still replaces
// the dropdown when it arrived, including when the account calls failed.
export function mergeDeskBoard(prev, data) {
  const prior = prev && typeof prev === "object" ? prev : {};
  const next = data && typeof data === "object" ? data : {};
  const section = next.sectionErrors && typeof next.sectionErrors === "object" ? next.sectionErrors : {};
  const positionsFailed = !!section.positions || !Array.isArray(next.positions);
  const ordersFailed = !!section.orders || !Array.isArray(next.orders);
  const activityFailed = !!section.activity || !Array.isArray(next.activity);
  const priorPositions = asRows(prior.positions);
  const priorOrders = asRows(prior.orders);
  const priorActivity = asRows(prior.activity);
  const positions = positionsFailed ? priorPositions : next.positions;
  const orders = ordersFailed ? priorOrders : next.orders;
  const activity = activityFailed ? priorActivity : next.activity;
  const fillsFailed = !!section.fills || !Array.isArray(next.fills);
  const fills = fillsFailed ? asRows(prior.fills) : next.fills;
  const incomingGames = Array.isArray(next.games) ? next.games : null;
  const priorGames = asRows(prior.games);
  const games = incomingGames && (incomingGames.length || !next.gamesError)
    ? incomingGames
    : (priorGames.length ? priorGames : (incomingGames || []));
  const keepMarket = !next.market && prior.market && (next.rateLimited || positionsFailed || ordersFailed);
  const market = keepMarket ? prior.market : (next.market || null);
  return {
    board: {
      ...prior,
      ...next,
      positions,
      orders,
      activity,
      fills,
      games,
      market,
    },
    freshness: {
      positionsFailed,
      ordersFailed,
      positionsStale: positionsFailed && positions.length > 0,
      ordersStale: ordersFailed && orders.length > 0,
      fillsStale: fillsFailed && fills.length > 0,
    },
  };
}
