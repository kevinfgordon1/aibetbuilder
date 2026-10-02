import { getOddsBoardCell } from "./oddsBoard.js";
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
  holdPolymarketOtbCells,
  POLYMARKET_OTB_HOLD_MS,
  withNovigQuotes,
  novigSlateFromQuotes,
  BETSTAMP_BOARD_PINNED_BOOK_KEYS,
} from "./betstampProBoard.js";
import { gamesFromBetstampSnapshot as pmHoldSnapshot } from "./betstampNormalize.js";
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
assert.deepEqual(ids, [200, 100, 300, 400, 722, 365, 642, 500, 250, 105, 613, 614, 150, 700, 850, 191, 193, 194]);
assert.equal(bookById(400).key, "betmgm", "BetMGM next to DraftKings / FanDuel / Caesars");
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
assert.ok([722, 500, 614, 700, 200, 191, 193, 194, 400].every((id) => reqIds.includes(id)));

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
assert.equal(cols[cols.length - 2].key, "novig", "Novig sits between Kalshi and Underdog Predict");
assert.equal(cols[cols.length - 3].key, "kalshi");
assert.deepEqual(cols.slice(0, -2).map((b) => b.id), ids, "Betstamp columns unchanged");
assert.ok(!betstampOddsBoardRequestIds().includes(195), "Novig is never requested from Betstamp");
assert.ok(!cols.some((b) => /fliff|courtside/i.test(`${b.key} ${b.label}`)), "no Fliff / Courtside column");
assert.deepEqual([...BETSTAMP_BOARD_PINNED_BOOK_KEYS].sort(), ["betmgm", "betus", "novig"]);
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

// Novig column: relay quotes, matched like the Underdog column.
{
  const stamp = "2026-09-29T01:04:33.794Z";
  const q = (extra) => ({
    book: "novig", book_id: 195, league: "NFL", away: "Philadelphia Eagles", home: "Chicago Bears",
    is_alt: false, is_live: false, start: "2026-09-29T00:15:00.000Z", updated_at: stamp, ...extra,
  });
  const quotes = [
    q({ bet_type: "moneyline", side: "Chicago Bears", odds: 0.535, american: -115, size: 812.5 }),
    q({ bet_type: "moneyline", side: "Philadelphia Eagles", odds: 0.5, american: -100, size: 40 }),
    q({ bet_type: "spread", side: "Chicago Bears", line: 2.5, odds: 0.48, american: 108, market_id: "s1" }),
    q({ bet_type: "spread", side: "Philadelphia Eagles", line: -2.5, odds: 0.53, american: -113, market_id: "s1" }),
    // Lopsided alt spread: not the main.
    q({ bet_type: "spread", side: "Chicago Bears", line: 10.5, odds: 0.9, american: -900, market_id: "s2" }),
    q({ bet_type: "spread", side: "Philadelphia Eagles", line: -10.5, odds: 0.12, american: 733, market_id: "s2" }),
    q({ bet_type: "total", side: "Over", side_type: "Over", line: 42.5, odds: 0.505, american: -102, market_id: "t1", updated_at: "2026-09-28T22:48:48.627Z" }),
    q({ bet_type: "total", side: "Under", side_type: "Under", line: 42.5, odds: 0.5, american: -100, market_id: "t1", updated_at: "2026-09-28T22:48:48.627Z" }),
    // Another league / next week's rematch never attach.
    q({ league: "NCAAF", bet_type: "moneyline", side: "Chicago Bears", odds: 0.1, american: 900 }),
    { ...q({ bet_type: "moneyline", side: "Chicago Bears", odds: 0.2, american: 400 }), start: "2026-10-06T00:15:00.000Z" },
  ];
  assert.equal(novigSlateFromQuotes(quotes, "NFL").games.length, 2);
  const [ng] = withNovigQuotes([bsGame], quotes, "NFL");
  const nv = ng.bookOdds.novig;
  assert.deepEqual(
    [nv.ml_away, nv.ml_home, nv.spr_away, nv.spr_away_line, nv.spr_home, nv.spr_home_line, nv.tot_line, nv.tot_over, nv.tot_under],
    [-100, -115, -113, -2.5, 108, 2.5, 42.5, -102, -100],
  );
  assert.equal(nv.ml_home_size, 812.5, "Novig size rides along");
  assert.equal(ng.bookOdds.draftkings.ml_away, -200, "Betstamp cells untouched");
  assert.equal(ng.bookLineUpdatedAt.novig.ml_home, Date.parse(stamp), "age badge = Novig book change time");
  assert.equal(ng.bookLineUpdatedAt.novig.tot_over, Date.parse("2026-09-28T22:48:48.627Z"));
  assert.ok(booksWithBoardData([ng]).has("novig"));
  // Underdog cells survive a Novig repaint and vice versa.
  const both = withNovigQuotes(withUnderdogPhone([bsGame], phone, "NFL"), quotes, "NFL")[0];
  assert.equal(both.bookOdds.underdog_predict.ml_away, -205);
  assert.equal(withUnderdogPhone([both], phone, "NFL")[0].bookOdds.novig.ml_home, -115);
  // No stream yet: leave games alone. Empty book: clear.
  assert.equal(withNovigQuotes([bsGame], null, "NFL")[0], bsGame);
  assert.equal(withNovigQuotes([ng], [], "NFL")[0].bookOdds.novig.ml_home, null);
  // A different night never attaches (same kickoff window as Underdog).
  const nextWeekOnly = quotes.filter((x) => x.start === "2026-10-06T00:15:00.000Z");
  assert.equal(withNovigQuotes([bsGame], nextWeekOnly, "NFL")[0].bookOdds.novig.ml_home, null);
  assert.equal(withNovigQuotes([nextWeek], quotes, "NFL")[0].bookOdds.novig.ml_home, 400);
  // LIVE Novig quotes are painted after the live taker fee (0.03·P·(1−P) on
  // top of the ask); the raw ask rides along for the hover. Pregame stays raw.
  {
    const lq = (extra) => q({ is_live: true, ...extra });
    const [lv] = withNovigQuotes([bsGame], [
      lq({ bet_type: "moneyline", side: "Chicago Bears", odds: 0.295, american: 239 }),
      lq({ bet_type: "moneyline", side: "Philadelphia Eagles", odds: 0.71, american: -245, fee_coefficient: 0.03 }),
    ], "NFL");
    assert.equal(lv.bookOdds.novig.ml_home, 232);
    assert.equal(lv.bookOdds.novig.ml_home_raw, 239);
    assert.equal(lv.bookOdds.novig.ml_away, -252);
    assert.equal(lv.bookOdds.novig.ml_away_raw, -245);
    assert.equal(nv.ml_home_raw, undefined, "pregame Novig has no fee tag");
    // The Best column ranks on the all-in Novig price.
    assert.equal(lv.bookOdds.draftkings.ml_away, -200);
    const best = (price) => getOddsBoardCell({
      game: { ...lv, bookOdds: { draftkings: { ml_home: price }, novig: lv.bookOdds.novig } },
      bookKey: "best", market: "ml", selectedBookKeys: new Set(["draftkings", "novig"]), allBooks: [{ key: "draftkings" }, { key: "novig" }],
    });
    assert.equal(best(235).bot, 235, "a +235 book beats Novig +232 all-in (+239 raw would have won)");
    assert.equal(best(235).botBooks[0].key, "draftkings");
    assert.equal(best(225).bot, 232);
    assert.equal(best(225).botBooks[0].key, "novig");
  }
  // No `american` on the quote: derive from the 0–1 ask.
  const [derived] = withNovigQuotes([bsGame], [q({ bet_type: "moneyline", side: "Chicago Bears", odds: 0.6 })], "NFL");
  assert.equal(derived.bookOdds.novig.ml_home, -150);
  assert.match(board, /novigStreamUrl\(/);
  assert.match(board, /withNovigQuotes\(/);
}

console.log("betstampProBoard tests passed");

// Polymarket (193) OTB hold: the snapshot rebuild keeps the last good 193
// price for up to 60s when the cell's row is a 193 OTB substitute.
{
  assert.equal(POLYMARKET_OTB_HOLD_MS, 60_000);
  const fid = "019e2c24-13fb-76fb-9ad8-b88cb1074cb2";
  const fixtures = [{
    id: fid, league: "NFL", date: "2026-09-29T00:15:00Z", status: "created",
    home_abbr: "CHI", away_abbr: "PHI", home_team: "Chicago Bears", away_team: "Philadelphia Eagles",
  }];
  const row = (bet_type, side_type, odds, extra = {}) => ({
    odd_provider_id: 193, odds, number: 0, bet_type, side_type,
    side: side_type === "Away" ? "PHI" : side_type === "Home" ? "CHI" : side_type,
    period: "FT", is_alt: false, is_live: false, is_otb: false, fixture_id: fid,
    updated_at: "2026-09-28T21:14:38Z", ...extra,
  });
  const goodMarkets = [
    row("Moneyline", "Away", 1.5348723),
    row("Moneyline", "Home", 2.62016743),
    row("Spread", "Away", 2.03053931, { number: -3.5 }),
    row("Spread", "Home", 1.84347089, { number: 3.5 }),
    row("Total", "Over", 1.99, { number: 42.5 }),
    row("Total", "Under", 1.878, { number: 42.5 }),
  ];
  const t0 = Date.parse("2026-09-28T21:15:00Z");
  const memory = new Map();
  const build = (markets, nowMs) => holdPolymarketOtbCells(
    pmHoldSnapshot({ markets, fixtures, teams: [], nowMs }), markets, memory, { nowMs },
  );
  const g0 = build(goodMarkets, t0)[0];
  assert.equal(g0.bookOdds.polymarket.ml_away, -187);

  const otbMarkets = goodMarkets.map((m) => (
    m.bet_type === "Moneyline" && m.side_type === "Away"
      ? { ...m, odds: 1.11751, is_otb: true, provider_market_id: "4866730" }
      : m.bet_type === "Spread" && m.side_type === "Home"
        ? { ...m, odds: 1.5, is_otb: true }
        : m
  ));
  const g1 = build(otbMarkets, t0 + 15_000)[0];
  assert.equal(g1.bookOdds.polymarket.ml_away, -187, "OTB ML falls back to last good price, never -851");
  assert.equal(g1.bookOdds.polymarket.ml_home, 162);
  assert.equal(g1.bookOdds.polymarket.spr_home, decimalToAmericanLocal(1.84347089), "OTB spread held");
  assert.equal(g1.bookOdds.polymarket.spr_home_line, 3.5);

  const g2 = build(otbMarkets, t0 + 55_000)[0];
  assert.equal(g2.bookOdds.polymarket.ml_away, -187, "still held inside 60s of the last good print");
  const g3 = build(otbMarkets, t0 + 61_000)[0];
  assert.equal(g3.bookOdds.polymarket.ml_away, null, "hold expires after 60s: blank, not -851");

  // A row that is simply gone (not a 193 OTB row) is not held.
  const mem2 = new Map();
  const b2 = (markets, nowMs) => holdPolymarketOtbCells(
    pmHoldSnapshot({ markets, fixtures, teams: [], nowMs }), markets, mem2, { nowMs },
  );
  b2(goodMarkets, t0);
  const gone = b2(goodMarkets.filter((m) => !(m.bet_type === "Moneyline" && m.side_type === "Away")), t0 + 5_000)[0];
  assert.equal(gone.bookOdds.polymarket.ml_away, null);

  // Spread moved: the held line must agree with the live opposite side.
  const mem3 = new Map();
  const b3 = (markets, nowMs) => holdPolymarketOtbCells(
    pmHoldSnapshot({ markets, fixtures, teams: [], nowMs }), markets, mem3, { nowMs },
  );
  b3(goodMarkets, t0);
  const moved = goodMarkets.map((m) => (
    m.bet_type === "Spread" && m.side_type === "Away" ? { ...m, number: -2.5, is_otb: true }
      : m.bet_type === "Spread" && m.side_type === "Home" ? { ...m, number: 2.5, odds: 1.95 } : m
  ));
  const gm = b3(moved, t0 + 5_000)[0];
  assert.equal(gm.bookOdds.polymarket.spr_away, null, "held -3.5 price is not paired with a +2.5 home line");

  // No memory → no-op, same array.
  const plain = pmHoldSnapshot({ markets: goodMarkets, fixtures, teams: [], nowMs: t0 });
  assert.equal(holdPolymarketOtbCells(plain, goodMarkets, null), plain);
}

function decimalToAmericanLocal(d) {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
