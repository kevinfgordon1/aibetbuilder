import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BETSTAMP_BOARD_LIVE_POLL_MS,
  BETSTAMP_BOARD_PREGAME_POLL_MS,
  betstampBoardSnapshotUrl,
  betstampBoardRequestsPerPoll,
  betstampBoardHourlyRequests,
  booksWithBoardData,
  wrapNamespacedStorage,
  betstampOddsBoardColumns,
  withUnderdogPhone,
  underdogSlateForLeague,
  BETSTAMP_BOARD_UNDERDOG_POLL_MS,
  BETSTAMP_BOARD_UNDERDOG_LIVE_POLL_MS,
} from "./betstampProBoard.js";
import { gamesFromFreeFeeds, FREE_FEED_POLL_MS, FREE_FEED_LIVE_POLL_MS } from "./freeFeedBoard.js";
import {
  betstampOddsBoardBooks,
  BETSTAMP_ODDS_BOARD_BOOK_IDS,
  BETSTAMP_TRIAL_BOOKS,
  bookById,
  betstampOddsBoardRequestIds,
} from "./betstampBooks.js";
import {
  canSeeBetstampOddsBoard,
  canSeeNewOddsBoard,
  parseAppHash,
  resolveAppHash,
  serializeAppHash,
} from "./comboAccess.js";

const kevin = { id: "u1", email: "kev120909@gmail.com" };
const kevinCased = { id: "u1", email: "  Kev120909@Gmail.com " };
const kenneth = { id: "u2", email: "kmguido97@gmail.com" };
const stranger = { id: "u3", email: "someone@example.com" };

// Access: Kevin only.
assert.equal(canSeeBetstampOddsBoard(kevin), true);
assert.equal(canSeeBetstampOddsBoard(kevinCased), true);
assert.equal(canSeeBetstampOddsBoard(kenneth), false, "not Kenny");
assert.equal(canSeeNewOddsBoard(kenneth), true, "New Odds Board sharing unchanged");
assert.equal(canSeeBetstampOddsBoard(stranger), false);
assert.equal(canSeeBetstampOddsBoard(null), false);
assert.equal(canSeeBetstampOddsBoard({ id: "kev120909@gmail.com" }), false, "uid is not an email");

// Hash routing + redirect.
assert.equal(parseAppHash("#betstamp-odds-board").tab, "betstampBoard");
assert.equal(serializeAppHash({ tab: "betstampBoard" }), "#betstamp-odds-board");
assert.equal(resolveAppHash(parseAppHash("#betstamp-odds-board"), kevin).tab, "betstampBoard");
for (const u of [kenneth, stranger]) {
  const r = resolveAppHash(parseAppHash("#betstamp-odds-board"), u);
  assert.equal(r.tab, "promo");
  assert.equal(r.allowed, false);
  assert.equal(r.notice, "noaccess");
}
assert.equal(resolveAppHash(parseAppHash("#betstamp-odds-board"), null).notice, "signin");

// Books: Kevin's list, no Underdog / Fliff.
const books = betstampOddsBoardBooks();
const ids = books.map((b) => b.id);
assert.deepEqual(ids, [200, 100, 300, 722, 365, 642, 500, 250, 105, 613, 614, 150, 700, 850, 191, 193, 194]);
assert.ok(!ids.includes(196), "no Betstamp Underdog");
assert.ok(!ids.includes(800), "no Fliff");
assert.ok(!books.some((b) => /fliff|courtside|underdog/i.test(`${b.key} ${b.label}`)));
assert.equal(new Set(books.map((b) => b.key)).size, books.length, "unique keys");
for (const id of BETSTAMP_ODDS_BOARD_BOOK_IDS) assert.ok(bookById(id), `bookById(${id})`);
assert.ok(!BETSTAMP_TRIAL_BOOKS.some((b) => b.id === 722), "extras stay off the Promo / New Odds Board catalog");
assert.equal(bookById(722).key, "fanatics");
assert.equal(bookById(500).key, "betrivers");
// Unentitled books would make the proxy drop every opt-in book on a bare 403.
const reqIds = betstampOddsBoardRequestIds();
assert.ok(!reqIds.includes(105) && !reqIds.includes(850));
assert.ok([722, 500, 614, 700, 200, 191, 193, 194].every((id) => reqIds.includes(id)));

// Polling URL always bypasses the 5-minute cache, never the SSE route.
const u = betstampBoardSnapshotUrl({ league: "NFL", live: false, bookIds: [200, 722] });
assert.match(u, /^\/api\/betstamp-markets\?/);
assert.match(u, /refresh=1/);
assert.match(u, /book_ids=200%2C722/);
assert.match(betstampBoardSnapshotUrl({ league: "NFL", live: true, bookIds: [200] }), /is_live=true/);
assert.equal(betstampBoardRequestsPerPoll("NFL"), 3);
assert.ok(BETSTAMP_BOARD_LIVE_POLL_MS >= 3000 && BETSTAMP_BOARD_LIVE_POLL_MS <= 10000);
assert.ok(BETSTAMP_BOARD_PREGAME_POLL_MS >= BETSTAMP_BOARD_LIVE_POLL_MS);
// 25 req/s cap: one visible tab stays well under 1 req/s.
assert.ok(betstampBoardHourlyRequests(BETSTAMP_BOARD_LIVE_POLL_MS) / 3600 < 1);

// Column hiding.
const withData = booksWithBoardData([
  { bookOdds: { draftkings: { ml_away: -110 }, fanatics: { ml_away: null, tot_over: null }, pinnacle: { tot_under: 105 } } },
  { bookOdds: { betus: {} } },
]);
assert.deepEqual([...withData].sort(), ["draftkings", "pinnacle"]);

// Namespaced order storage.
const mem = new Map();
const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
const ns = wrapNamespacedStorage("betstampOddsBoard", fake);
ns.setItem("k", "v");
assert.equal(mem.get("betstampOddsBoard:k"), "v");
assert.equal(ns.getItem("k"), "v");
assert.equal(fake.getItem("k"), null);

// The board must not open the Betstamp SSE proxy (one-connection trial key).
const board = readFileSync(new URL("./BetstampProOddsBoard.jsx", import.meta.url), "utf8");
assert.ok(!/betstampStreamUrl|\/api\/betstamp-stream/.test(board.replace(/\/\/.*$/gm, "")), "no Betstamp SSE in the board");
assert.match(board, /className="nob-theme"/);

// App wiring: tab hidden and body gated.
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
assert.match(app, /canSeeBetstampOddsBoard\(user\) && \(\s*<a[^>]*betstampBoard/);
assert.match(app, /activeTab === "betstampBoard" && canSeeBetstampOddsBoard\(user\)/);
assert.match(app, /activeTab === "betstampBoard" && !canSeeBetstampOddsBoard\(user\)\) \{\s*setActiveTab\("promo"\)/);

// Underdog Predict column: phone feed, same matching as the New Odds Board.
const cols = betstampOddsBoardColumns();
assert.equal(cols[cols.length - 1].key, "underdog_predict", "Underdog Predict is the last column");
assert.deepEqual(cols.slice(0, -1).map((b) => b.id), ids, "Betstamp columns unchanged");
assert.ok(!betstampOddsBoardRequestIds().includes(196), "never asks Betstamp for book 196");
assert.equal(BETSTAMP_BOARD_UNDERDOG_POLL_MS, FREE_FEED_POLL_MS, "same pregame cadence as the New Odds Board");
assert.equal(BETSTAMP_BOARD_UNDERDOG_LIVE_POLL_MS, FREE_FEED_LIVE_POLL_MS, "same LIVE cadence as the New Odds Board");
const t0 = Date.parse("2026-09-28T20:00:00Z");
const phone = {
  ok: true,
  games: [
    {
      matchId: 179003, sport: "NFL", away: "Philadelphia Eagles", home: "Chicago Bears",
      scheduledAt: "2026-09-29T00:15:00Z", status: "scheduled", live: false,
      lines: [
        { market: "h2h", name: "Philadelphia Eagles", choice: "away", american: -205, updatedAt: t0 },
        { market: "h2h", name: "Chicago Bears", choice: "home", american: 163, updatedAt: t0 },
        { market: "spreads", name: "Philadelphia Eagles", point: -3.5, choice: "away", american: -109, updatedAt: t0 },
        { market: "spreads", name: "Chicago Bears", point: 3.5, choice: "home", american: -113, updatedAt: t0 },
        { market: "totals", name: "PHI @ CHI", point: 41.5, choice: "higher", american: -118, updatedAt: t0 },
        { market: "totals", name: "PHI @ CHI", point: 41.5, choice: "lower", american: -105, updatedAt: t0 },
      ],
    },
    // Same team names in another league must not attach on the NFL board.
    {
      matchId: 1, sport: "NCAAF", away: "Philadelphia Eagles", home: "Chicago Bears",
      scheduledAt: "2026-09-29T00:10:00Z", lines: [{ market: "h2h", name: "Philadelphia Eagles", american: 999 }],
    },
  ],
};
assert.equal(underdogSlateForLeague(phone, "NFL").games.length, 1);
const bsGame = {
  id: "bs-1", league: "NFL", away_team: "Philadelphia Eagles", home_team: "Chicago Bears",
  commence_time: "2026-09-29T00:15:00Z",
  bookOdds: { draftkings: { ml_away: -200, ml_home: 170 } },
};
const [painted] = withUnderdogPhone([bsGame], phone, "NFL");
assert.equal(painted.bookOdds.draftkings.ml_away, -200, "Betstamp cells untouched");
const ud = painted.bookOdds.underdog_predict;
assert.deepEqual(
  [ud.ml_away, ud.ml_home, ud.spr_away, ud.spr_away_line, ud.spr_home, ud.spr_home_line, ud.tot_line, ud.tot_over, ud.tot_under],
  [-205, 163, -109, -3.5, -113, 3.5, 41.5, -118, -105],
);
// Identical Underdog cells to the New Odds Board for the same slate.
const nob = gamesFromFreeFeeds({ league: "NFL", underdog: phone, nowMs: t0 })
  .find((g) => /Eagles/.test(g.away_team || g.away));
assert.deepEqual(ud, nob.bookOdds.underdog_predict, "same Underdog cells as the New Odds Board");
assert.equal(withUnderdogPhone([bsGame], null, "NFL")[0], bsGame, "no slate yet: leave games alone");
const cleared = withUnderdogPhone([painted], { ok: false, games: [] }, "NFL")[0].bookOdds.underdog_predict;
assert.equal(cleared.ml_away, null, "failed phone poll clears Underdog cells");
// A different night never attaches.
const nextWeek = { ...bsGame, commence_time: "2026-10-06T00:15:00Z" };
assert.equal(withUnderdogPhone([nextWeek], phone, "NFL")[0].bookOdds.underdog_predict.ml_away, null);
assert.ok(booksWithBoardData([painted]).has("underdog_predict"), "Underdog column shows when priced");
assert.match(board, /fetchUnderdogPhone/);
assert.match(board, /withUnderdogPhone\(/);
assert.match(board, /betstampOddsBoardColumns\(\)/);

console.log("betstampProBoard tests passed");
