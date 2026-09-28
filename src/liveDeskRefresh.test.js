import assert from "node:assert/strict";
import {
  DESK_REFRESH_MS,
  DESK_BACKOFF_MIN_MS,
  DESK_BACKOFF_MAX_MS,
  deskBackoffMs,
  deskRefreshDelayMs,
  deskRateLimitMessage,
  isDeskRateLimit,
  mergeDeskBoard,
} from "./liveDeskRefresh.js";

assert.equal(DESK_REFRESH_MS, 12000);
assert.equal(DESK_BACKOFF_MIN_MS, 30000);
assert.equal(DESK_BACKOFF_MAX_MS, 60000);
assert.equal(deskRefreshDelayMs({ rateLimited: false, retryAfter: 45 }), 12000);
assert.equal(deskRefreshDelayMs(null), 12000);
assert.equal(deskRefreshDelayMs({ rateLimited: true, retryAfter: 45 }, () => 0.5), 45000);
assert.equal(deskBackoffMs(45, () => 0), 40000);
assert.equal(deskBackoffMs(45, () => 1), 50000);
assert.equal(deskBackoffMs(10, () => 0), 30000);
assert.equal(deskBackoffMs(10, () => 1), 35000);
assert.equal(deskBackoffMs(120, () => 0), 55000);
assert.equal(deskBackoffMs(120, () => 1), 60000);
assert.equal(deskBackoffMs(null, () => 0.5), 45000);
assert.equal(deskRateLimitMessage(37), "Polymarket is rate-limiting us, retrying in 37s");
assert.equal(deskRateLimitMessage(null), "Polymarket is rate-limiting us, retrying in 45s");

for (const hinted of [null, 1, 10, 30, 45, 60, 90, 120]) {
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const ms = deskBackoffMs(hinted, () => u);
    assert.ok(ms >= DESK_BACKOFF_MIN_MS && ms <= DESK_BACKOFF_MAX_MS, hinted + " @" + u + " -> " + ms);
  }
}
assert.equal(deskRefreshDelayMs({ rateLimited: true, retryAfter: 37 }, () => 0.5), 37000);

assert.equal(
  isDeskRateLimit('{"title":"Error 1015: You are being rate limited","status":429,"error_code":1015}'),
  true,
);
assert.equal(isDeskRateLimit({ title: "Error 1015: You are being rate limited", status: 429, error_code: 1015 }), true);
assert.equal(isDeskRateLimit({ rateLimited: true, retryAfter: 37 }), true);
assert.equal(isDeskRateLimit("Sign in required."), false);
assert.equal(isDeskRateLimit("Polymarket is rate-limiting us, retrying in 42s"), false);

const prev = {
  positions: [{ slug: "aec-nfl-lar-den-2026-09-27", team: "Rams" }],
  orders: [{ id: "o1" }],
  activity: [{ id: "t1" }],
  games: [],
  market: { slug: "aec-nfl-lar-den-2026-09-27", title: "LAR @ DEN" },
};
const merged = mergeDeskBoard(prev, {
  ok: true,
  rateLimited: true,
  retryAfter: 37,
  positions: null,
  orders: null,
  activity: null,
  market: null,
  games: [{ id: "nfl-lar-den-2026-09-27", label: "NFL · LAR @ DEN" }],
  gamesError: "",
  sectionErrors: {
    positions: "Polymarket is rate-limiting us, retrying in 37s",
    orders: "Polymarket is rate-limiting us, retrying in 37s",
    activity: "Polymarket is rate-limiting us, retrying in 37s",
  },
});
assert.equal(merged.board.positions[0].team, "Rams");
assert.equal(merged.board.orders[0].id, "o1");
assert.equal(merged.board.activity[0].id, "t1");
assert.equal(merged.freshness.positionsStale, true);
assert.equal(merged.freshness.ordersStale, true);
assert.equal(merged.freshness.positionsFailed, true);
assert.equal(merged.board.games[0].id, "nfl-lar-den-2026-09-27");
assert.equal(merged.board.market.title, "LAR @ DEN");

const cleared = mergeDeskBoard(merged.board, {
  positions: [],
  orders: [],
  activity: [],
  games: [{ id: "nfl-lar-den-2026-09-27" }],
  gamesError: "",
  market: null,
  rateLimited: false,
  sectionErrors: { positions: "", orders: "", activity: "" },
});
assert.equal(cleared.board.positions.length, 0);
assert.equal(cleared.board.orders.length, 0);
assert.equal(cleared.freshness.positionsStale, false);
assert.equal(cleared.freshness.positionsFailed, false);
assert.equal(cleared.freshness.ordersStale, false);
assert.equal(cleared.board.market, null);
assert.equal(cleared.board.games[0].id, "nfl-lar-den-2026-09-27");

const emptyFirst = mergeDeskBoard(null, {
  positions: null,
  orders: null,
  activity: null,
  games: [{ id: "nfl-lar-den-2026-09-27" }],
  gamesError: "",
  sectionErrors: { positions: "Polymarket is rate-limiting us, retrying in 37s", orders: "", activity: "" },
});
assert.equal(emptyFirst.board.positions.length, 0);
assert.equal(emptyFirst.freshness.positionsFailed, true);
assert.equal(emptyFirst.freshness.positionsStale, false);
assert.equal(emptyFirst.board.games[0].id, "nfl-lar-den-2026-09-27");

console.log("liveDeskRefresh.test.js ok");
