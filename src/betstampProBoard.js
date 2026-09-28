// Betstamp Odds Board (Kevin only) polling + column helpers.
//
// Live-update design: this board never opens /api/betstamp-stream. The
// Betstamp trial key allows ONE upstream SSE connection per key, and
// api/betstamp-stream.js opens a fresh upstream for every browser request (it
// does not fan out one upstream to many clients). A second SSE client would
// hit "connection limit reached" or bump whoever holds the slot. Instead the
// board polls REST snapshots through /api/betstamp-markets with refresh=1 so
// the 5-minute Promo cache does not freeze prices. Each poll is 3 upstream
// GETs per league (markets + fixtures + teams), far under 25 req/s.

import { betstampSnapshotUrl } from "./betstampLive.js";

// LIVE: every 5s → 3 × 720 = 2,160 Betstamp GETs per visible hour.
// Pregame: every 15s → 720 GETs per visible hour. Hidden tabs skip polls.
export const BETSTAMP_BOARD_LIVE_POLL_MS = 5_000;
export const BETSTAMP_BOARD_PREGAME_POLL_MS = 15_000;
export const BETSTAMP_BOARD_GETS_PER_LEAGUE = 3;

export function betstampBoardSnapshotUrl({ league, live, bookIds } = {}) {
  // refresh=1 always: pregame would otherwise read a 5-minute cached snapshot.
  return betstampSnapshotUrl({ league, live: !!live, bookIds, refresh: true });
}

export function betstampBoardRequestsPerPoll(league) {
  const n = String(league || "NFL").split(/[,\s]+/).filter(Boolean).length || 1;
  return n * BETSTAMP_BOARD_GETS_PER_LEAGUE;
}

/** Betstamp GETs per hour of a visible tab at the given poll interval. */
export function betstampBoardHourlyRequests(pollMs, league = "NFL") {
  if (!(pollMs > 0)) return 0;
  return Math.round((3_600_000 / pollMs) * betstampBoardRequestsPerPoll(league));
}

const PRICE_FIELDS = ["ml_away", "ml_home", "ml_draw", "spr_away", "spr_home", "tot_over", "tot_under"];

/** Book keys with at least one priced main-line cell on any game. */
export function booksWithBoardData(games) {
  const out = new Set();
  for (const g of games || []) {
    const odds = g && g.bookOdds;
    if (!odds || typeof odds !== "object") continue;
    for (const [key, row] of Object.entries(odds)) {
      if (out.has(key) || !row) continue;
      if (PRICE_FIELDS.some((f) => row[f] != null && Number.isFinite(Number(row[f])))) out.add(key);
    }
  }
  return out;
}

/**
 * localStorage wrapper that prefixes keys, so this board's drag order does
 * not overwrite the New Odds Board's saved order (same oddsBoardOrder.js).
 */
export function wrapNamespacedStorage(namespace, storage) {
  const ns = String(namespace || "board");
  const store = () => storage ?? globalThis.localStorage;
  return {
    getItem(key) {
      const s = store();
      return s ? s.getItem(`${ns}:${key}`) : null;
    },
    setItem(key, value) {
      const s = store();
      if (s) s.setItem(`${ns}:${key}`, value);
    },
  };
}
