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
} from "./betstampProBoard.js";
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

console.log("betstampProBoard tests passed");
