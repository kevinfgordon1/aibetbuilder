import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toAmericanOdds, gameVisibleOnBoard } from "./betstampNormalize.js";
import {
  freeFeedBooks,
  gamesFromFreeFeeds,
  kalshiQuotesFromBoardBody,
  mainLaddersFromGame,
  mergeVenueQuotes,
  quoteMergeKey,
} from "./freeFeedBoard.js";

const now = Date.parse("2026-09-22T18:00:00Z");

assert.deepEqual(freeFeedBooks(null).map((b) => b.key), ["polymarket", "kalshi", "novig", "fourcasters"]);
assert.deepEqual(
  freeFeedBooks({ email: "kev120909@gmail.com" }).map((b) => b.key),
  ["polymarket", "kalshi", "novig", "fourcasters", "underdog_predict"],
);
assert.equal(freeFeedBooks(null).some((b) => b.key === "draftkings" || b.key === "fanduel" || b.key === "prophetx"), false);

const poly = {
  book: "polymarket",
  book_id: 193,
  league: "NFL",
  away: "Falcons",
  home: "Packers",
  side: "Falcons",
  bet_type: "moneyline",
  odds: 0.285,
  is_live: false,
  start: "2026-09-25T00:15:00Z",
  updated_at: "2026-09-22T17:00:00.000Z",
  token_id: "tok-away",
};
const polyHome = {
  ...poly,
  side: "Packers",
  odds: 0.72,
  token_id: "tok-home",
};
const kalshi = {
  book: "kalshi",
  book_id: 194,
  league: "NFL",
  away: "Atlanta",
  home: "Green Bay",
  side: "Green Bay",
  bet_type: "moneyline",
  odds: 0.72,
  is_live: false,
  updated_at: "2026-09-22T17:05:00.000Z",
  ticker: "KXNFLGAME-26SEP24ATLGB-GB",
};
const underdog = {
  ok: true,
  games: [{
    sport: "NFL",
    away: "Atlanta Falcons",
    home: "Green Bay Packers",
    scheduledAt: "2026-09-25T00:15:00Z",
    status: "scheduled",
    live: false,
    lines: [
      { name: "Atlanta Falcons", american: 245, market: "h2h" },
      { name: "Green Bay Packers", american: -280, market: "h2h" },
      { name: "Atlanta Falcons", american: -110, market: "spreads", point: 3.5 },
      { name: "Green Bay Packers", american: -110, market: "spreads", point: -3.5 },
      { name: "Over", american: -105, market: "totals", point: 47.5, choice: "higher" },
      { name: "Under", american: -115, market: "totals", point: 47.5, choice: "lower" },
    ],
  }],
};

const games = gamesFromFreeFeeds({
  league: "NFL",
  polymarket: [poly, polyHome],
  kalshi: [kalshi],
  underdog,
  nowMs: now,
});
assert.equal(games.length, 1, "city, nickname, and full name are one fixture");
assert.equal(games[0].id, "ff:NFL:ATL:GB");
assert.equal(games[0].away, "Atlanta Falcons");
assert.equal(games[0].home, "Green Bay Packers");
assert.equal(games[0].is_live, false);
assert.equal(games[0].bookOdds.polymarket.ml_away, toAmericanOdds(0.285));
assert.equal(games[0].bookOdds.polymarket.ml_home, toAmericanOdds(0.72));
assert.equal(games[0].bookOdds.kalshi.ml_home, toAmericanOdds(0.72));
assert.equal(games[0].bookOdds.kalshi.ml_away, null);

// Live Kalshi titles are city or truncated city ("Los Angeles C", "New York G"),
// while Underdog uses the full club name. Both sides of an NFL moneyline join.
const abbreviated = gamesFromFreeFeeds({
  league: "NFL",
  kalshi: [
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Los Angeles C",
      home: "Buffalo",
      side: "Los Angeles C",
      bet_type: "moneyline",
      odds: 0.25,
      ticker: "KXNFLGAME-26SEP27LACBUF-LAC",
    },
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Los Angeles C",
      home: "Buffalo",
      side: "Buffalo",
      bet_type: "moneyline",
      odds: 0.76,
      ticker: "KXNFLGAME-26SEP27LACBUF-BUF",
    },
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Seattle",
      home: "Washington",
      side: "Seattle",
      bet_type: "moneyline",
      odds: 0.76,
      ticker: "KXNFLGAME-26SEP27SEAWAS-SEA",
    },
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Tennessee",
      home: "New York G",
      side: "New York G",
      bet_type: "moneyline",
      odds: 0.57,
      ticker: "KXNFLGAME-26SEP27TENNYG-NYG",
    },
  ],
  underdog: {
    ok: true,
    games: [
      {
        sport: "NFL",
        away: "Los Angeles Chargers",
        home: "Buffalo Bills",
        scheduledAt: "2026-09-27T17:00:00Z",
        lines: [{ name: "Los Angeles Chargers", american: 300, market: "h2h" }],
      },
      {
        sport: "NFL",
        away: "Seattle Seahawks",
        home: "Washington Commanders",
        scheduledAt: "2026-09-27T17:00:00Z",
        lines: [{ name: "Seattle Seahawks", american: -300, market: "h2h" }],
      },
      {
        sport: "NFL",
        away: "Tennessee Titans",
        home: "New York Giants",
        scheduledAt: "2026-09-27T17:00:00Z",
        lines: [{ name: "New York Giants", american: -130, market: "h2h" }],
      },
    ],
  },
  nowMs: now,
});
assert.equal(abbreviated.length, 3);
const chargers = abbreviated.find((g) => g.awayAbbr === "LAC");
const seahawks = abbreviated.find((g) => g.awayAbbr === "SEA");
const titans = abbreviated.find((g) => g.awayAbbr === "TEN");
assert.equal(chargers.bookOdds.kalshi.ml_away, toAmericanOdds(0.25));
assert.equal(chargers.bookOdds.kalshi.ml_home, toAmericanOdds(0.76));
assert.equal(chargers.bookOdds.underdog_predict.ml_away, 300);
assert.equal(seahawks.bookOdds.kalshi.ml_away, toAmericanOdds(0.76));
assert.equal(titans.home, "New York Giants");
assert.equal(titans.bookOdds.kalshi.ml_home, toAmericanOdds(0.57));

// Production SSE shape: book 194, city names, 0–1 yes-ask. Snapshot JSON
// must paint American odds on the Underdog Falcons @ Packers row.
const boardBody = {
  ok: true,
  league: "NFL",
  quotes: [
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Atlanta",
      home: "Green Bay",
      side: "Green Bay",
      bet_type: "moneyline",
      is_live: false,
      odds: 0.69,
      ticker: "KXNFLGAME-26SEP24ATLGB-GB",
      start: "2026-09-25T03:15:00Z",
    },
    {
      book: "kalshi",
      book_id: 194,
      league: "NFL",
      away: "Atlanta",
      home: "Green Bay",
      side: "Atlanta",
      bet_type: "moneyline",
      is_live: false,
      odds: 0.32,
      ticker: "KXNFLGAME-26SEP24ATLGB-ATL",
      start: "2026-09-25T03:15:00Z",
    },
  ],
};
assert.equal(kalshiQuotesFromBoardBody(null), null);
assert.equal(kalshiQuotesFromBoardBody({ quotes: [] }), null);
const fromBoard = kalshiQuotesFromBoardBody(boardBody);
const fromPayload = gamesFromFreeFeeds({
  league: "NFL",
  kalshi: fromBoard,
  underdog,
  nowMs: now,
});
assert.equal(fromPayload.length, 1);
assert.equal(fromPayload[0].id, "ff:NFL:ATL:GB");
assert.equal(fromPayload[0].bookOdds.kalshi.ml_home, toAmericanOdds(0.69));
assert.equal(fromPayload[0].bookOdds.kalshi.ml_away, toAmericanOdds(0.32));
assert.equal(fromPayload[0].bookOdds.underdog_predict.ml_away, 245);
assert.equal(games[0].bookOdds.underdog_predict.ml_away, 245);
assert.equal(games[0].bookOdds.underdog_predict.ml_home, -280);
assert.equal(games[0].bookOdds.underdog_predict.spr_away, -110);
assert.equal(games[0].bookOdds.underdog_predict.spr_away_line, 3.5);
assert.equal(games[0].bookOdds.underdog_predict.tot_over, -105);
assert.equal(games[0].bookOdds.draftkings, undefined);
assert.equal(gameVisibleOnBoard(games[0], { liveOnly: false, now }), true);
assert.equal(gameVisibleOnBoard(games[0], { liveOnly: true, now }), false);

const ladders = mainLaddersFromGame(games[0]);
assert.equal(ladders.moneyline.isMain, true);
assert.equal(ladders.spreads.length, 1);
assert.equal(ladders.spreads[0].line, 3.5);
assert.equal(ladders.totals[0].line, 47.5);

const phoneOnly = gamesFromFreeFeeds({ league: "NFL", underdog, nowMs: now });
assert.equal(phoneOnly.length, 1);
assert.equal(phoneOnly[0].bookOdds.polymarket.ml_away, null, "missing book is an empty cell");
assert.equal(phoneOnly[0].bookOdds.novig.ml_away, null, "Novig with no quote is an empty cell");
assert.equal(phoneOnly[0].bookOdds.fourcasters.ml_away, null, "4Casters with no quote is an empty cell");
assert.equal(phoneOnly[0].bookOdds.underdog_predict.ml_away, 245);

const withNovig = gamesFromFreeFeeds({
  league: "NFL",
  novig: [
    {
      book: "novig",
      book_id: 195,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Atlanta Falcons",
      bet_type: "moneyline",
      odds: 0.285,
      is_live: false,
      start: "2026-09-25T00:15:00Z",
      updated_at: now,
      token_id: "nv-away",
    },
    {
      book: "novig",
      book_id: 195,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Green Bay Packers",
      bet_type: "moneyline",
      odds: 0.72,
      is_live: false,
      updated_at: now,
      token_id: "nv-home",
    },
    {
      book: "novig",
      book_id: 195,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Atlanta Falcons",
      bet_type: "spread",
      odds: 0.52,
      line: 3.5,
      is_live: false,
      updated_at: now,
      token_id: "nv-spr-away",
    },
    {
      book: "novig",
      book_id: 195,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Over",
      bet_type: "total",
      odds: 0.48,
      line: 47.5,
      is_live: false,
      updated_at: now,
      token_id: "nv-over",
    },
  ],
  nowMs: now,
});
assert.equal(withNovig.length, 1);
assert.equal(withNovig[0].id, "ff:NFL:ATL:GB");
assert.equal(withNovig[0].bookOdds.novig.ml_away, toAmericanOdds(0.285));
assert.equal(withNovig[0].bookOdds.novig.ml_home, toAmericanOdds(0.72));
assert.equal(withNovig[0].bookOdds.novig.spr_away, toAmericanOdds(0.52));
assert.equal(withNovig[0].bookOdds.novig.spr_away_line, 3.5);
assert.equal(withNovig[0].bookOdds.novig.tot_over, toAmericanOdds(0.48));
assert.equal(withNovig[0].bookOdds.novig.tot_line, 47.5);

const withFourcasters = gamesFromFreeFeeds({
  league: "NFL",
  fourcasters: [
    {
      book: "fourcasters",
      book_id: 197,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Atlanta Falcons",
      bet_type: "moneyline",
      odds: 150,
      is_live: false,
      start: "2026-09-25T00:15:00Z",
      updated_at: now,
      token_id: "fc-away",
    },
    {
      book: "fourcasters",
      book_id: 197,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Green Bay Packers",
      bet_type: "moneyline",
      odds: -170,
      is_live: false,
      updated_at: now,
      token_id: "fc-home",
    },
    {
      book: "fourcasters",
      book_id: 197,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Atlanta Falcons",
      bet_type: "spread",
      odds: -110,
      line: 3.5,
      is_live: false,
      updated_at: now,
      token_id: "fc-spr-away",
    },
    {
      book: "fourcasters",
      book_id: 197,
      league: "NFL",
      away: "Atlanta Falcons",
      home: "Green Bay Packers",
      side: "Over",
      bet_type: "total",
      odds: -105,
      line: 47.5,
      is_live: false,
      updated_at: now,
      token_id: "fc-over",
    },
  ],
  nowMs: now,
});
assert.equal(withFourcasters.length, 1);
assert.equal(withFourcasters[0].id, "ff:NFL:ATL:GB");
assert.equal(withFourcasters[0].bookOdds.fourcasters.ml_away, 150);
assert.equal(withFourcasters[0].bookOdds.fourcasters.ml_home, -170);
assert.equal(withFourcasters[0].bookOdds.fourcasters.spr_away, -110);
assert.equal(withFourcasters[0].bookOdds.fourcasters.spr_away_line, 3.5);
assert.equal(withFourcasters[0].bookOdds.fourcasters.tot_over, -105);
assert.equal(withFourcasters[0].bookOdds.fourcasters.tot_line, 47.5);

const live = gamesFromFreeFeeds({
  league: "NFL",
  polymarket: [{ ...poly, is_live: true, start: "2026-09-22T17:00:00Z" }],
  kalshi: [{ ...kalshi, start: "2026-09-22T17:00:00Z" }],
  nowMs: now,
});
assert.equal(live.length, 1);
assert.equal(live[0].is_live, true);
assert.equal(live[0].bookOdds.kalshi.ml_home, toAmericanOdds(0.72), "Kalshi still paints after kickoff");
assert.equal(gameVisibleOnBoard(live[0], { liveOnly: true, now }), true);
assert.equal(gameVisibleOnBoard(live[0], { liveOnly: false, now }), false);

const kicked = gamesFromFreeFeeds({
  league: "NFL",
  kalshi: [{ ...kalshi, is_live: false, start: "2026-09-22T17:30:00Z" }],
  nowMs: now,
});
assert.equal(kicked[0].is_live, true, "open quote after kickoff stays on LIVE");

const finished = gamesFromFreeFeeds({
  league: "NFL",
  kalshi: [{ ...kalshi, start: "2026-09-22T06:00:00Z" }],
  nowMs: now,
});
assert.equal(finished.length, 0, "a quote from long after kickoff is not a pregame row");

const otherLeague = gamesFromFreeFeeds({
  league: "NFL",
  polymarket: [{ ...poly, league: "MLB", away: "Braves", home: "Mets", side: "Braves" }],
  nowMs: now,
});
assert.equal(otherLeague.length, 0);

const ncaaf = gamesFromFreeFeeds({
  league: "NCAAF",
  polymarket: [{
    book: "polymarket",
    book_id: 193,
    league: "NCAAF",
    away: "Rebels",
    home: "Gators",
    side: "Rebels",
    bet_type: "moneyline",
    odds: 0.44,
    is_live: false,
    start: "2026-09-26T19:30:00Z",
    updated_at: "2026-09-22T17:00:00.000Z",
    token_id: "reb",
  }],
  underdog: {
    games: [{
      sport: "NCAAF",
      away: "Ole Miss Rebels",
      home: "Florida Gators",
      scheduledAt: "2026-09-26T19:30:00Z",
      lines: [
        { name: "Ole Miss Rebels", american: 127, market: "h2h" },
        { name: "Florida Gators", american: -157, market: "h2h" },
      ],
    }],
  },
  nowMs: now,
});
assert.equal(ncaaf.length, 1);
assert.equal(ncaaf[0].bookOdds.underdog_predict.ml_away, 127);
assert.equal(ncaaf[0].bookOdds.polymarket.ml_away, toAmericanOdds(0.44));
assert.match(ncaaf[0].away, /Ole Miss/);

const merged = mergeVenueQuotes(
  [poly],
  [{ ...poly, odds: 0.3, updated_at: "2026-09-22T17:10:00.000Z" }],
);
assert.equal(merged.length, 1);
assert.equal(merged[0].odds, 0.3);
assert.equal(quoteMergeKey(poly), "tok-away");
const withKalshi = mergeVenueQuotes(merged, [kalshi]);
assert.equal(withKalshi.length, 2);

const board = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "BetstampOddsBoard.jsx"), "utf8");
assert.match(board, /gamesFromFreeFeeds/);
assert.match(board, /polymarketStreamUrl/);
assert.match(board, /kalshiStreamUrl/);
assert.match(board, /kalshiBoardUrl/);
assert.match(board, /kalshiQuotesFromBoardBody/);
const venueLive = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "venueLive.js"), "utf8");
assert.match(venueLive, /\/api\/kalshi-board/);
assert.match(board, /novigStreamUrl/);
assert.match(board, /fourcastersStreamUrl/);
assert.match(board, /novig_needs_credentials/);
assert.match(board, /fourcasters_needs_credentials/);
assert.match(board, /fetchUnderdogPhone/);
assert.match(board, /data-free-feeds="polymarket,kalshi,novig,fourcasters,underdog"/);
assert.doesNotMatch(board, /\/api\/betstamp-stream/);
assert.doesNotMatch(board, /\/api\/betstamp-markets/);
assert.doesNotMatch(board, /betstampSnapshotUrl|betstampStreamUrl/);
assert.doesNotMatch(board, /BETSTAMP_API_KEY/);
assert.doesNotMatch(board, /data-betstamp-missing-key/);
assert.doesNotMatch(board, /Invalid API key/);

console.log("freeFeedBoard.test.js ok");
