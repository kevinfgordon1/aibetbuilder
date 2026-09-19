import assert from "node:assert/strict";
import { transformOddsData } from "./oddsTransform.js";
import { createRequire } from "node:module";
import {
  fmtBoardSize,
  bookInitials,
  pickBestSide,
  bestBooksTitle,
  getOddsBoardCell,
  getBestForGame,
  pickBestFromPriceMap,
  LIVE_BEST_ODDS_MAX_AGE_MS,
  LIVE_BEST_ODDS_BREAK_MAX_AGE_MS,
  isFreshForLiveBestOdds,
  isLiveGameBreak,
  liveBestOddsMaxAgeMs,
  oddsBoardHideKey,
  hideSideFromPriceKey,
  isHiddenOddsCell,
  oddsMoveDirection,
  ODDS_FLASH_MS,
  pickBestSidesByPopularLines,
  pickBestByPopularPoints,
  STACKED_BEST_MAX_LINES,
  normalizeBoardLine,
  formatStackedBestLine,
  isStackedBestMatch,
  marketLinePoint,
} from "./oddsBoard.js";
import { BETSTAMP_TRIAL_BOOKS } from "./betstampBooks.js";

const require = createRequire(import.meta.url);
const { ALL_BOOKS, TRUSTED_BOOK_KEYS } = require("../lib/promo-ev.js");

const selected = new Set(ALL_BOOKS.map((b) => b.key));

// ── fmtBoardSize: compact dollars; hide unknown / zero
{
  assert.equal(fmtBoardSize(354), "$354");
  assert.equal(fmtBoardSize(1250), "$1.3k");
  assert.equal(fmtBoardSize(1000000), "$1.0M");
  assert.equal(fmtBoardSize("80"), "$80");
  assert.equal(fmtBoardSize(null), null);
  assert.equal(fmtBoardSize(0), null);
  assert.equal(fmtBoardSize(-10), null);
  assert.equal(fmtBoardSize("nope"), null);
  assert.equal(fmtBoardSize(undefined), null);
}

// ── oddsMoveDirection: higher American is better for the bettor
{
  assert.equal(oddsMoveDirection(-110, -105), "up");
  assert.equal(oddsMoveDirection(-105, -120), "down");
  assert.equal(oddsMoveDirection(100, 120), "up");
  assert.equal(oddsMoveDirection(150, 130), "down");
  assert.equal(oddsMoveDirection(-105, 100), "up");
  assert.equal(oddsMoveDirection(110, -110), "down");
  assert.equal(oddsMoveDirection(-110, -110), null);
  assert.equal(oddsMoveDirection(null, -110), null);
  assert.equal(oddsMoveDirection(-110, null), null);
  assert.equal(oddsMoveDirection("+120", 130), "up");
  assert.equal(ODDS_FLASH_MS >= 600 && ODDS_FLASH_MS <= 1200, true);
}

// ── bookInitials: favicon fallback
{
  assert.equal(bookInitials("BetOpenly"), "BO");
  assert.equal(bookInitials("Novig"), "NO");
  assert.equal(bookInitials("DraftKings"), "DK");
  assert.equal(bookInitials("theScore Bet"), "TB");
  assert.equal(bookInitials("Hard Rock"), "HR");
  assert.equal(bookInitials("Bovada"), "BO");
  assert.equal(bookInitials(""), "?");
}

// ── pickBestSide: first in list wins ties; size rides with that book
{
  const one = pickBestSide([
    { key: "draftkings", price: 110 },
    { key: "kalshi", price: 120, size: 500 },
    { key: "betopenly", price: 105, size: 354 },
  ]);
  assert.equal(one.price, 120);
  assert.equal(one.primaryKey, "kalshi");
  assert.equal(one.size, 500);
  assert.equal(one.extra, 0);

  const tie = pickBestSide([
    { key: "draftkings", price: 120 },
    { key: "fanduel", price: 115 },
    { key: "kalshi", price: 120, size: 400 },
  ]);
  assert.equal(tie.primaryKey, "draftkings");
  assert.equal(tie.size, null, "primary DK has no size — do not borrow Kalshi");
  assert.equal(tie.extra, 1);
  assert.deepEqual(tie.books.map((b) => b.key), ["draftkings", "kalshi"]);

  assert.equal(pickBestSide([{ key: "dk", price: null }]).price, null);
  assert.equal(bestBooksTitle(tie.books, (k) => ({ draftkings: "DraftKings", kalshi: "Kalshi" }[k])), "DraftKings · Kalshi");
}

// ── transform: size / bet_limit land on bookOdds for ML + spread + total
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -115 }, { name: "Red Sox", price: 105 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: -110, point: -1.5 }, { name: "Red Sox", price: -110, point: 1.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -105, point: 8.5 }, { name: "Under", price: -115, point: 8.5 }] },
        ],
      },
      {
        key: "kalshi",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Yankees", price: -118, size: 900 },
            { name: "Red Sox", price: 120, size: 1250 },
          ],
        }],
      },
      {
        key: "betopenly",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Yankees", price: -112, bet_limit: 354 },
              { name: "Red Sox", price: 110, bet_limit: null },
            ],
          },
          {
            key: "spreads",
            outcomes: [
              { name: "Yankees", price: -105, point: -1.5, bet_limit: 200 },
              { name: "Red Sox", price: -105, point: 1.5, size: 80 },
            ],
          },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: 100, point: 8.5, bet_limit: 50 },
              { name: "Under", price: -120, point: 8.5 },
            ],
          },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const g = data.moneylines[0];
  assert.equal(g.bookOdds.kalshi.ml_away_size, 900);
  assert.equal(g.bookOdds.kalshi.ml_home_size, 1250);
  assert.equal(g.bookOdds.betopenly.ml_away_size, 354);
  assert.equal(g.bookOdds.betopenly.ml_home_size, null, "null bet_limit stays hidden");
  assert.equal(g.bookOdds.draftkings.ml_away_size, null, "soft book with price only");
  assert.equal(g.bookOdds.betopenly.spr_away_size, 200);
  assert.equal(g.bookOdds.betopenly.spr_home_size, 80);
  assert.equal(g.bookOdds.betopenly.tot_over_size, 50);
  assert.equal(g.bookOdds.betopenly.tot_under_size, null);
  assert.equal(g.bookOdds.draftkings.spr_away_size, null);

  const mlBest = getOddsBoardCell({ game: g, bookKey: "best", market: "ml", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(mlBest.top, -112);
  assert.equal(mlBest.topBooks[0].key, "betopenly", "untrusted BetOpenly still wins Best when selected");
  assert.equal(mlBest.topSize, 354);
  assert.equal(mlBest.bot, 120);
  assert.equal(mlBest.botBooks[0].key, "kalshi");
  assert.equal(mlBest.botSize, 1250);

  const openly = getOddsBoardCell({ game: g, bookKey: "betopenly", market: "ml", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(openly.top, -112);
  assert.equal(openly.topSize, 354);
  assert.equal(openly.botSize, null);

  const dk = getOddsBoardCell({ game: g, bookKey: "draftkings", market: "ml", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(dk.topSize, null);
  assert.equal(fmtBoardSize(dk.topSize), null);

  const sprBest = getOddsBoardCell({ game: g, bookKey: "best", market: "spr", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(sprBest.top, -105);
  assert.equal(sprBest.topBooks[0].key, "betopenly");
  assert.equal(sprBest.topSize, 200);
  assert.equal(sprBest.topLine, "-1.5");

  const totCell = getOddsBoardCell({ game: g, bookKey: "betopenly", market: "tot", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(totCell.top, 100);
  assert.equal(totCell.topSize, 50);
  assert.equal(totCell.botSize, null);

  const { bestAway, bestHome } = getBestForGame(g, "ml", selected, ALL_BOOKS);
  assert.equal(bestAway, -112);
  assert.equal(bestHome, 120);
}

// ── soccer 3-way + lay size
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Chelsea",
    home_team: "Arsenal",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Chelsea", price: 280 },
            { name: "Draw", price: 240 },
            { name: "Arsenal", price: -120 },
          ],
        }],
      },
      {
        key: "betopenly",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Chelsea", price: 245, bet_limit: 956 },
              { name: "Draw", price: 250, bet_limit: 4593 },
              { name: "Arsenal", price: 138, bet_limit: 14 },
            ],
          },
          {
            key: "h2h_lay",
            outcomes: [
              { name: "Chelsea", price: 200, bet_limit: 40 },
              { name: "Draw", price: 210, bet_limit: 12 },
              { name: "Arsenal", price: -150, bet_limit: 8 },
            ],
          },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "soccer_epl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const g = data.moneylines[0];
  assert.equal(g.is_three_way, true);
  assert.equal(g.bookOdds.betopenly.ml_draw, 250);
  assert.equal(g.bookOdds.betopenly.ml_draw_size, 4593);
  assert.equal(g.bookOdds.betopenly.ml_away_no_size, 40);

  const best = getOddsBoardCell({ game: g, bookKey: "best", market: "ml", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(best.threeWay, true);
  assert.equal(best.top, 280);
  assert.equal(best.topBooks[0].key, "draftkings");
  assert.equal(best.topSize, null);
  assert.equal(best.mid, 250);
  assert.equal(best.midBooks[0].key, "betopenly");
  assert.equal(best.midSize, 4593);
  assert.equal(best.bot, 138);
  assert.equal(best.botBooks[0].key, "betopenly");
  assert.equal(best.topNo, 200);
  assert.equal(best.topNoSize, 40);

  const nfl = { ...g, sport: "americanfootball_nfl", is_three_way: false };
  const nflCell = getOddsBoardCell({ game: nfl, bookKey: "best", market: "ml", selectedBookKeys: selected, allBooks: ALL_BOOKS });
  assert.equal(nflCell.threeWay, false);
  assert.equal(nflCell.mid, null);
}

// ── championship best-of: logo identity + size of the winning book
{
  const books = pickBestFromPriceMap(
    { draftkings: 400, kalshi: 420, betopenly: 420 },
    { kalshi: 800, betopenly: 50 },
    selected,
    ALL_BOOKS,
  );
  assert.equal(books.price, 420);
  assert.equal(books.primaryKey, "kalshi", "Kalshi is listed before BetOpenly");
  assert.equal(books.size, 800);
  assert.equal(books.extra, 1);
}

// ── deselecting a book drops it from Best
{
  const game = {
    sport: "baseball_mlb",
    bookOdds: {
      draftkings: { ml_away: 110 },
      kalshi: { ml_away: 120, ml_away_size: 500 },
    },
  };
  const onlyDk = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: new Set(["draftkings"]),
    allBooks: ALL_BOOKS,
  });
  assert.equal(onlyDk.top, 110);
  assert.equal(onlyDk.topBooks[0].key, "draftkings");
  assert.equal(onlyDk.topSize, null);
}

// ── live Best Odds: quotes ≥ 60s old cannot win while the game is moving
{
  assert.equal(LIVE_BEST_ODDS_MAX_AGE_MS, 60_000);
  assert.equal(LIVE_BEST_ODDS_BREAK_MAX_AGE_MS, 240_000);
  const now = 1_700_000_000_000;
  assert.equal(isFreshForLiveBestOdds(now - 30_000, now), true);
  assert.equal(isFreshForLiveBestOdds(now - 59_999, now), true);
  assert.equal(isFreshForLiveBestOdds(now - 60_000, now), false);
  assert.equal(isFreshForLiveBestOdds(now - 61_000, now), false);
  assert.equal(isFreshForLiveBestOdds(now - 240_000, now), false);
  assert.equal(isFreshForLiveBestOdds(null, now), false);
  assert.equal(isFreshForLiveBestOdds(undefined, now), false);
  assert.equal(isLiveGameBreak({ is_live: true, status: "halftime" }), true);
  assert.equal(isLiveGameBreak({ is_live: true, status: "HT" }), true);
  assert.equal(isLiveGameBreak({ is_live: true, period: "intermission" }), true);
  assert.equal(isLiveGameBreak({ is_live: true, is_halftime: true }), true);
  assert.equal(isLiveGameBreak({ is_live: true, status: "live", period: "2Q" }), false);
  assert.equal(liveBestOddsMaxAgeMs({ is_live: true, status: "live" }), 60_000);
  assert.equal(liveBestOddsMaxAgeMs({ is_live: true, status: "halftime" }), 240_000);
  assert.equal(liveBestOddsMaxAgeMs({ is_live: false, status: "halftime" }), null);

  const freshPick = pickBestSide([
    { key: "draftkings", price: 120, updatedAt: now - 61_000 },
    { key: "kalshi", price: 105, updatedAt: now - 30_000 },
  ], { nowMs: now, maxAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS });
  assert.equal(freshPick.price, 105);
  assert.equal(freshPick.primaryKey, "kalshi");

  const noneFresh = pickBestSide([
    { key: "draftkings", price: 120, updatedAt: now - 61_000 },
    { key: "kalshi", price: 105, updatedAt: now - 300_000 },
  ], { nowMs: now, maxAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS });
  assert.equal(noneFresh.price, null);
  assert.equal(noneFresh.primaryKey, null);
  assert.deepEqual(noneFresh.books, []);

  const liveGame = {
    sport: "americanfootball_nfl",
    is_live: true,
    bookOdds: {
      draftkings: { ml_away: 110, ml_home: -120, spr_away: 105, spr_home: -115, tot_over: 100, tot_under: -120 },
      kalshi: { ml_away: 100, ml_home: -110, spr_away: -110, spr_home: -105, tot_over: -110, tot_under: -105, ml_away_size: 400 },
    },
    bookLineUpdatedAt: {
      draftkings: {
        ml_away: now - 61_000,
        ml_home: now - 5_000,
        spr_away: now - 300_000,
        spr_home: now - 2_000,
        tot_over: now - 61_000,
        tot_under: now - 1_000,
      },
      kalshi: {
        ml_away: now - 4_000,
        ml_home: now - 300_000,
        spr_away: now - 3_000,
        spr_home: now - 400_000,
        tot_over: now - 8_000,
        tot_under: now - 400_000,
      },
    },
  };
  const liveOpts = { nowMs: now, maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS };

  const mlBest = getOddsBoardCell({
    game: liveGame,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(mlBest.top, 100, "stale DK +110 must not win live Best");
  assert.equal(mlBest.topBooks[0].key, "kalshi");
  assert.equal(mlBest.topSize, 400);
  assert.equal(mlBest.bot, -120, "fresh DK home still wins");
  assert.equal(mlBest.botBooks[0].key, "draftkings");

  const dkCell = getOddsBoardCell({
    game: liveGame,
    bookKey: "draftkings",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(dkCell.top, 110, "stale book cell still displays its price");

  const sprBest = getOddsBoardCell({
    game: liveGame,
    bookKey: "best",
    market: "spr",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(sprBest.top, -110);
  assert.equal(sprBest.topBooks[0].key, "kalshi");
  assert.equal(sprBest.bot, -115);
  assert.equal(sprBest.botBooks[0].key, "draftkings");

  const totBest = getOddsBoardCell({
    game: liveGame,
    bookKey: "best",
    market: "tot",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(totBest.top, -110);
  assert.equal(totBest.topBooks[0].key, "kalshi");
  assert.equal(totBest.bot, -120);
  assert.equal(totBest.botBooks[0].key, "draftkings");

  const allStale = {
    ...liveGame,
    bookLineUpdatedAt: {
      draftkings: { ml_away: now - 61_000 },
      kalshi: { ml_away: now - 300_000 },
    },
  };
  const emptyBest = getOddsBoardCell({
    game: allStale,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(emptyBest.top, null);
  assert.deepEqual(emptyBest.topBooks, []);

  const noTs = {
    sport: "americanfootball_nfl",
    is_live: true,
    bookOdds: { draftkings: { ml_away: 200 } },
  };
  const noTsBest = getOddsBoardCell({
    game: noTs,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(noTsBest.top, null, "live quote with no last-update cannot win Best");

  const trial = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const moving61 = getOddsBoardCell({
    game: {
      ...liveGame,
      status: "live",
      period: "2Q",
      bookOdds: {
        bet365: { spr_away: 210, spr_away_line: -10.5 },
        draftkings: { spr_away: -110, spr_away_line: -3.5 },
      },
      bookLineUpdatedAt: {
        bet365: { spr_away: now - 61_000 },
        draftkings: { spr_away: now - 8_000 },
      },
    },
    bookKey: "best",
    market: "spr",
    selectedBookKeys: trial,
    allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: now,
  });
  assert.equal(moving61.top, -110, "61s bet365 cannot win Best while the game is moving");
  assert.equal(moving61.topBooks[0].key, "draftkings");

  const moving30 = getOddsBoardCell({
    game: {
      ...liveGame,
      status: "live",
      bookOdds: {
        bet365: { spr_away: 210, spr_away_line: -10.5 },
        draftkings: { spr_away: -110, spr_away_line: -3.5 },
      },
      bookLineUpdatedAt: {
        bet365: { spr_away: now - 30_000 },
        draftkings: { spr_away: now - 8_000 },
      },
    },
    bookKey: "best",
    market: "spr",
    selectedBookKeys: trial,
    allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: now,
  });
  assert.equal(moving30.top, 210, "30s quote still wins Best while moving");
  assert.equal(moving30.topBooks[0].key, "bet365");

  const halfGame = {
    ...liveGame,
    status: "halftime",
    period: "HT",
    bookOdds: {
      bet365: { spr_away: 210, spr_away_line: -10.5 },
      draftkings: { spr_away: -110, spr_away_line: -3.5 },
    },
    bookLineUpdatedAt: {
      bet365: { spr_away: now - 150_000 },
      draftkings: { spr_away: now - 8_000 },
    },
  };
  const halfBest = getOddsBoardCell({
    game: halfGame,
    bookKey: "best",
    market: "spr",
    selectedBookKeys: trial,
    allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: now,
  });
  assert.equal(halfBest.top, 210, "2.5 min quote can still win Best at halftime");
  assert.equal(halfBest.topBooks[0].key, "bet365");
  const halfBook = getOddsBoardCell({
    game: halfGame,
    bookKey: "bet365",
    market: "spr",
    selectedBookKeys: trial,
    allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: now,
  });
  assert.equal(halfBook.top, 210, "book cell still shows the older quote + age");

  const pregame = getOddsBoardCell({
    game: { ...liveGame, is_live: false },
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    ...liveOpts,
  });
  assert.equal(pregame.top, 110, "pregame Best still uses the raw number");
  assert.equal(pregame.topBooks[0].key, "draftkings");
  const pregameOld = getOddsBoardCell({
    game: {
      ...liveGame,
      is_live: false,
      bookOdds: { bet365: { spr_away: 210 }, draftkings: { spr_away: -110 } },
      bookLineUpdatedAt: {
        bet365: { spr_away: now - 180_000 },
        draftkings: { spr_away: now - 8_000 },
      },
    },
    bookKey: "best",
    market: "spr",
    selectedBookKeys: trial,
    allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: now,
  });
  assert.equal(pregameOld.top, 210, "pregame is not age-gated");

  // Screenshot: DEN@KC LIVE spread, Single Best. bet365 −10.5 / +218 at 3m
  // was winning KC Best while FD/DK/PX on −7.5 were 1–8s fresh.
  const denKcLiveSpr = {
    id: "den-kc-mnf-spr",
    sport: "americanfootball_nfl",
    is_live: true,
    status: "live",
    period: "2Q",
    bookOdds: {
      fanduel: { spr_away: -130, spr_away_line: 7.5, spr_home: -102, spr_home_line: -7.5 },
      draftkings: { spr_away: -111, spr_away_line: 7.5, spr_home: -119, spr_home_line: -7.5 },
      prophetx: { spr_away: -118, spr_away_line: 7.5, spr_home: 101, spr_home_line: -7.5 },
      bet365: { spr_away: -300, spr_away_line: 10.5, spr_home: 218, spr_home_line: -10.5 },
    },
    bookLineUpdatedAt: {
      fanduel: { spr_away: now - 8_000, spr_home: now - 8_000 },
      draftkings: { spr_away: now - 3_000, spr_home: now - 3_000 },
      prophetx: { spr_away: now - 1_000, spr_home: now - 1_000 },
      bet365: { spr_away: now - 180_000, spr_home: now - 180_000 },
    },
  };
  const denKcBest = getOddsBoardCell({
    game: denKcLiveSpr, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS, nowMs: now,
  });
  assert.equal(denKcBest.bot, 101, "3m bet365 +218 on −10.5 cannot win live Best");
  assert.equal(denKcBest.botBooks[0].key, "prophetx");
  assert.equal(denKcBest.top, -111, "fresh DEN Best is unchanged");
  assert.equal(denKcBest.topBooks[0].key, "draftkings");
  const denKc365 = getOddsBoardCell({
    game: denKcLiveSpr, bookKey: "bet365", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS, nowMs: now,
  });
  assert.equal(denKc365.bot, 218, "bet365 cell still shows the 3m +218");
  assert.equal(denKc365.botLine, "-10.5");
  const denKcHalf = getOddsBoardCell({
    game: { ...denKcLiveSpr, status: "halftime", period: "HT" },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS, nowMs: now,
  });
  assert.equal(denKcHalf.bot, 218, "same 3m +218 can win Best at halftime");
  assert.equal(denKcHalf.botBooks[0].key, "bet365");

  const ungated = getOddsBoardCell({
    game: liveGame,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
  });
  assert.equal(ungated.top, 110, "public board / no freshness opts stays ungated");

  const { bestAway, bestHome } = getBestForGame(liveGame, "ml", selected, ALL_BOOKS, liveOpts);
  assert.equal(bestAway, 100);
  assert.equal(bestHome, -120);
}

// ── hide key: game + market + side + book (not the Best column)
{
  assert.equal(oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "fanduel" }), "den-kc:ml:away:fanduel");
  assert.equal(oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "best" }), null);
  assert.equal(oddsBoardHideKey({ gameId: "", market: "ml", side: "away", bookKey: "fanduel" }), null);
  assert.deepEqual(hideSideFromPriceKey("ml_away"), { market: "ml", side: "away" });
  assert.deepEqual(hideSideFromPriceKey("tot_under"), { market: "tot", side: "under" });
  const keys = new Set([oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "fanduel" })]);
  assert.equal(isHiddenOddsCell(keys, { gameId: "den-kc", market: "ml", side: "away", bookKey: "fanduel" }), true);
  assert.equal(isHiddenOddsCell(keys, { gameId: "den-kc", market: "ml", side: "home", bookKey: "fanduel" }), false);
  assert.equal(isHiddenOddsCell(keys, { gameId: "den-kc", market: "ml", side: "away", bookKey: "draftkings" }), false);
}

// ── pick-best with a hidden book: next-best wins; opposite side unchanged
{
  const skipped = pickBestSide([
    { key: "fanduel", price: 120, hidden: true },
    { key: "draftkings", price: 110 },
    { key: "kalshi", price: 105 },
  ]);
  assert.equal(skipped.price, 110);
  assert.equal(skipped.primaryKey, "draftkings");

  const noneLeft = pickBestSide([
    { key: "fanduel", price: 120, hidden: true },
    { key: "draftkings", price: 110, hidden: true },
  ]);
  assert.equal(noneLeft.price, null);
  assert.equal(noneLeft.primaryKey, null);
  assert.deepEqual(noneLeft.books, []);

  const game = {
    id: "den-kc",
    sport: "americanfootball_nfl",
    bookOdds: {
      fanduel: { ml_away: 120, ml_home: -140, spr_away: 105, spr_home: -115, tot_over: 100, tot_under: -120 },
      draftkings: { ml_away: 110, ml_home: -130, spr_away: -110, spr_home: -105, tot_over: -110, tot_under: -105 },
      kalshi: { ml_away: 105, ml_home: -125 },
    },
  };
  const hiddenAwayFd = new Set([oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "fanduel" })]);
  const mlBest = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: hiddenAwayFd,
  });
  assert.equal(mlBest.top, 110, "hidden FanDuel +120 drops; DK +110 is next-best");
  assert.equal(mlBest.topBooks[0].key, "draftkings");
  assert.equal(mlBest.bot, -125, "home side still includes FanDuel and Kalshi");
  assert.equal(mlBest.botBooks[0].key, "kalshi");

  const fdCell = getOddsBoardCell({
    game,
    bookKey: "fanduel",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: hiddenAwayFd,
  });
  assert.equal(fdCell.top, 120, "hidden square still shows its price");
  assert.equal(fdCell.bot, -140);

  const otherGame = getOddsBoardCell({
    game: { ...game, id: "buf-mia" },
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: hiddenAwayFd,
  });
  assert.equal(otherGame.top, 120, "hide is scoped to that game id");
  assert.equal(otherGame.topBooks[0].key, "fanduel");

  const allAwayHidden = new Set([
    oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "fanduel" }),
    oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "draftkings" }),
    oddsBoardHideKey({ gameId: "den-kc", market: "ml", side: "away", bookKey: "kalshi" }),
  ]);
  const emptyBest = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: allAwayHidden,
  });
  assert.equal(emptyBest.top, null, "no eligible book → Best shows —");
  assert.deepEqual(emptyBest.topBooks, []);
  assert.equal(emptyBest.bot, -125);

  const sprHidden = new Set([oddsBoardHideKey({ gameId: "den-kc", market: "spr", side: "away", bookKey: "fanduel" })]);
  const sprBest = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "spr",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: sprHidden,
  });
  assert.equal(sprBest.top, -110);
  assert.equal(sprBest.topBooks[0].key, "draftkings");
  assert.equal(sprBest.bot, -105, "home spread still uses DK; FanDuel home was never hidden");

  const totHidden = new Set([oddsBoardHideKey({ gameId: "den-kc", market: "tot", side: "over", bookKey: "fanduel" })]);
  const totBest = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "tot",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    hiddenKeys: totHidden,
  });
  assert.equal(totBest.top, -110);
  assert.equal(totBest.topBooks[0].key, "draftkings");

  const { bestAway, bestHome } = getBestForGame(game, "ml", selected, ALL_BOOKS, { hiddenKeys: hiddenAwayFd });
  assert.equal(bestAway, 110);
  assert.equal(bestHome, -125);

  const ungated = getOddsBoardCell({
    game,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
  });
  assert.equal(ungated.top, 120, "omitting hiddenKeys leaves public / default Best unchanged");
}

// ── hidden is an extra layer on live stale exclusion
{
  const now = 1_700_000_000_000;
  const liveGame = {
    id: "den-kc-live",
    sport: "americanfootball_nfl",
    is_live: true,
    bookOdds: {
      fanduel: { ml_away: 130 },
      draftkings: { ml_away: 120 },
      kalshi: { ml_away: 100 },
    },
    bookLineUpdatedAt: {
      fanduel: { ml_away: now - 1_000 },
      draftkings: { ml_away: now - 61_000 },
      kalshi: { ml_away: now - 2_000 },
    },
  };
  const hiddenFd = new Set([oddsBoardHideKey({ gameId: "den-kc-live", market: "ml", side: "away", bookKey: "fanduel" })]);
  const best = getOddsBoardCell({
    game: liveGame,
    bookKey: "best",
    market: "ml",
    selectedBookKeys: selected,
    allBooks: ALL_BOOKS,
    nowMs: now,
    maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS,
    hiddenKeys: hiddenFd,
  });
  assert.equal(best.top, 100, "hidden fresh FD and stale DK skip; Kalshi wins");
  assert.equal(best.topBooks[0].key, "kalshi");
}

// ── stacked Best helpers: line normalize + popularity ranking
{
  assert.equal(STACKED_BEST_MAX_LINES, 2);
  assert.equal(normalizeBoardLine(3.5), 3.5);
  assert.equal(normalizeBoardLine("+2.5"), 2.5);
  assert.equal(normalizeBoardLine(null), null);
  assert.equal(formatStackedBestLine("spr", 3.5), "+3.5");
  assert.equal(formatStackedBestLine("spr", -3.5), "-3.5");
  assert.equal(formatStackedBestLine("tot", 47.5, "over"), "o47.5");
  assert.equal(formatStackedBestLine("tot", 47.5, "under"), "u47.5");
  assert.equal(marketLinePoint("tot", 47.5), 47.5);
  assert.equal(marketLinePoint("spr", 6.5), 6.5);
  assert.equal(marketLinePoint("spr", -6.5), 6.5);
  assert.equal(isStackedBestMatch([{ line: 3.5, price: -105 }], -105, 3.5), true);
  assert.equal(isStackedBestMatch([{ line: 3.5, price: -105 }], -105, 2.5), false);

  const ranked = pickBestSidesByPopularLines([
    { key: "fanduel", price: -105, line: 3.5 },
    { key: "draftkings", price: -110, line: 3.5 },
    { key: "pinnacle", price: -108, line: 3.5 },
    { key: "betcris", price: -105, line: 2.5 },
    { key: "bet365", price: -140, line: 2.5 },
    { key: "kalshi", price: 120, line: 7 },
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].line, 3.5);
  assert.equal(ranked[0].count, 3);
  assert.equal(ranked[0].price, -105);
  assert.equal(ranked[0].primaryKey, "fanduel");
  assert.equal(ranked[1].line, 2.5);
  assert.equal(ranked[1].count, 2);
  assert.equal(ranked[1].price, -105);
  assert.equal(ranked[1].primaryKey, "betcris");

  const tiedCount = pickBestSidesByPopularLines([
    { key: "a", price: -110, line: 3 },
    { key: "b", price: -110, line: 3 },
    { key: "c", price: -110, line: 7 },
    { key: "d", price: -105, line: 7 },
    { key: "e", price: -110, line: 3.5 },
  ]);
  assert.equal(tiedCount.length, 2);
  assert.equal(tiedCount[0].line, 3, "same book count: line closer to median/consensus first");
  assert.equal(tiedCount[1].line, 7);
}

// ── DEN@KC-style: 3.5 majority + 2.5 minority; single vs stacked
{
  const trial = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const denKc = {
    id: "den-kc-spr",
    sport: "americanfootball_nfl",
    bookOdds: {
      fanduel: { spr_away: -105, spr_away_line: 3.5, spr_home: -115, spr_home_line: -3.5, tot_over: -110, tot_under: -110, tot_line: 47.5 },
      draftkings: { spr_away: -144, spr_away_line: 3.5, spr_home: 108, spr_home_line: -3.5, tot_over: -108, tot_under: -112, tot_line: 47.5 },
      williamhill_us: { spr_away: -133, spr_away_line: 3.5, spr_home: 101, spr_home_line: -3.5, tot_over: -105, tot_under: -115, tot_line: 48 },
      pinnacle: { spr_away: -141, spr_away_line: 3.5, spr_home: 107, spr_home_line: -3.5, tot_over: -110, tot_under: -110, tot_line: 47.5 },
      betonlineag: { spr_away: -154, spr_away_line: 3.5, spr_home: 121, spr_home_line: -3.5 },
      betcris: { spr_away: -105, spr_away_line: 2.5, spr_home: -121, spr_home_line: -2.5, tot_over: -102, tot_under: -118, tot_line: 46.5 },
      circa: { spr_away: -127, spr_away_line: 3.5, spr_home: 104, spr_home_line: -3.5 },
      bet365: { spr_away: -140, spr_away_line: 2.5, spr_home: 100, spr_home_line: -2.5, tot_over: 100, tot_under: -120, tot_line: 46.5 },
      kalshi: { spr_away: -127, spr_away_line: 3.5, spr_home: 105, spr_home_line: -3.5, tot_over: -110, tot_under: -110, tot_line: 47.5 },
    },
  };

  const singleSpr = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
  });
  assert.equal(singleSpr.top, -105, "single Best still apples-to-oranges juice across lines");
  assert.equal(singleSpr.topLine, "+3.5", "single Best still labels the DK line");
  assert.equal(singleSpr.topStacks, null, "default / Single view does not stack");
  assert.equal(singleSpr.bot, 121);

  const stackedSpr = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(stackedSpr.topStacks.length, 2);
  assert.equal(stackedSpr.topStacks[0].line, 3.5);
  assert.equal(stackedSpr.topStacks[0].count, 7);
  assert.equal(stackedSpr.topStacks[0].price, -105);
  assert.equal(stackedSpr.topStacks[0].primaryKey, "fanduel");
  assert.equal(stackedSpr.topStacks[0].lineLabel, "+3.5");
  assert.equal(stackedSpr.topStacks[1].line, 2.5);
  assert.equal(stackedSpr.topStacks[1].count, 2);
  assert.equal(stackedSpr.topStacks[1].price, -105);
  assert.equal(stackedSpr.topStacks[1].primaryKey, "betcris");
  assert.equal(stackedSpr.top, -105, "primary cell fields follow the popular line");
  assert.equal(stackedSpr.topLine, "+3.5");
  assert.equal(stackedSpr.botStacks[0].line, -3.5);
  assert.equal(stackedSpr.botStacks[0].price, 121);
  assert.equal(stackedSpr.botStacks[0].primaryKey, "betonlineag");
  assert.equal(stackedSpr.botStacks[1].line, -2.5);
  assert.equal(stackedSpr.botStacks[1].price, 100);
  assert.equal(stackedSpr.botStacks[1].primaryKey, "bet365");
  assert.equal(stackedSpr.pointStacks.length, 2);
  assert.equal(stackedSpr.pointStacks[0].point, 3.5);
  assert.equal(stackedSpr.pointStacks[0].top.line, 3.5);
  assert.equal(stackedSpr.pointStacks[0].bot.line, -3.5);
  assert.equal(stackedSpr.pointStacks[1].point, 2.5);
  assert.equal(stackedSpr.pointStacks[1].top.line, 2.5);
  assert.equal(stackedSpr.pointStacks[1].bot.line, -2.5);

  const singleTot = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "tot",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
  });
  assert.equal(singleTot.top, 100, "single totals still pick juice across 47.5 / 48 / 46.5");
  assert.equal(singleTot.topLine, "o47.5", "single Best still labels the DK total");
  assert.equal(singleTot.topStacks, null);

  const stackedTot = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "tot",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(stackedTot.topStacks.length, 2);
  assert.equal(stackedTot.topStacks[0].line, 47.5);
  assert.equal(stackedTot.topStacks[0].count, 4);
  assert.equal(stackedTot.topStacks[0].price, -108);
  assert.equal(stackedTot.topStacks[0].primaryKey, "draftkings");
  assert.equal(stackedTot.topStacks[0].lineLabel, "o47.5");
  assert.equal(stackedTot.topStacks[1].line, 46.5);
  assert.equal(stackedTot.topStacks[1].count, 2);
  assert.equal(stackedTot.topStacks[1].price, 100);
  assert.equal(stackedTot.topStacks[1].primaryKey, "bet365");
  assert.equal(stackedTot.botStacks[0].lineLabel, "u47.5");
  assert.equal(stackedTot.botStacks[0].price, -110);
  assert.equal(stackedTot.pointStacks[0].point, 47.5);
  assert.equal(stackedTot.pointStacks[0].top.lineLabel, "o47.5");
  assert.equal(stackedTot.pointStacks[0].bot.lineLabel, "u47.5");
  assert.equal(stackedTot.pointStacks[1].point, 46.5);
  assert.equal(stackedTot.pointStacks[1].top.lineLabel, "o46.5");
  assert.equal(stackedTot.pointStacks[1].bot.lineLabel, "u46.5");

  const onlyOneLine = getOddsBoardCell({
    game: {
      id: "one-line",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { spr_away: -110, spr_away_line: 3.5 },
        draftkings: { spr_away: -105, spr_away_line: 3.5 },
      },
    },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(onlyOneLine.topStacks.length, 1, "one distinct line → one Best chip");
  assert.equal(onlyOneLine.topStacks[0].price, -105);
  assert.equal(onlyOneLine.topLine, "+3.5");
  assert.equal(onlyOneLine.botStacks[0].price, null, "missing home at that point → —");
  assert.equal(onlyOneLine.botStacks[0].lineLabel, "-3.5");

  const threeLines = getOddsBoardCell({
    game: {
      id: "three-lines",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { spr_away: -110, spr_away_line: 3.5 },
        draftkings: { spr_away: -108, spr_away_line: 3.5 },
        pinnacle: { spr_away: -112, spr_away_line: 3.5 },
        williamhill_us: { spr_away: -105, spr_away_line: 2.5 },
        betonlineag: { spr_away: -115, spr_away_line: 2.5 },
        kalshi: { spr_away: 120, spr_away_line: 7 },
      },
    },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(threeLines.topStacks.length, 2, "three distinct lines → only the two most popular");
  assert.deepEqual(threeLines.topStacks.map((s) => s.line), [3.5, 2.5]);
  assert.equal(threeLines.topStacks[0].price, -108);
  assert.equal(threeLines.topStacks[1].price, -105);

  const mlStacked = getOddsBoardCell({
    game: {
      id: "den-kc-ml",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { ml_away: -105, ml_home: -115 },
        draftkings: { ml_away: -110, ml_home: -110 },
        betcris: { ml_away: 100, ml_home: -120 },
      },
    },
    bookKey: "best", market: "ml",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(mlStacked.top, 100, "moneyline stays a single Best even in Top 2 view");
  assert.equal(mlStacked.topBooks[0].key, "betcris");
  assert.equal(mlStacked.topStacks, null);
  assert.equal(mlStacked.bot, -110);

  const hidden2p5 = new Set([
    oddsBoardHideKey({ gameId: "den-kc-spr", market: "spr", side: "away", bookKey: "betcris" }),
    oddsBoardHideKey({ gameId: "den-kc-spr", market: "spr", side: "away", bookKey: "bet365" }),
  ]);
  const stackedHidden = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true, hiddenKeys: hidden2p5,
  });
  assert.equal(stackedHidden.pointStacks.length, 2, "home −2.5 still counts the 2.5 point after hiding away 2.5");
  assert.equal(stackedHidden.topStacks[0].line, 3.5);
  assert.equal(stackedHidden.topStacks[1].line, 2.5);
  assert.equal(stackedHidden.topStacks[1].price, null, "away 2.5 is hidden so that half is empty");
  assert.equal(stackedHidden.botStacks[1].line, -2.5);
  assert.equal(stackedHidden.botStacks[1].price, 100);
  const hideBoth2p5 = new Set([
    ...hidden2p5,
    oddsBoardHideKey({ gameId: "den-kc-spr", market: "spr", side: "home", bookKey: "betcris" }),
    oddsBoardHideKey({ gameId: "den-kc-spr", market: "spr", side: "home", bookKey: "bet365" }),
  ]);
  const stackedHiddenBoth = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true, hiddenKeys: hideBoth2p5,
  });
  assert.equal(stackedHiddenBoth.pointStacks.length, 1, "hiding both sides of 2.5 drops that point");
  assert.equal(stackedHiddenBoth.topStacks[0].line, 3.5);
  const stackedHideFd = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
    hiddenKeys: new Set([oddsBoardHideKey({ gameId: "den-kc-spr", market: "spr", side: "away", bookKey: "fanduel" })]),
  });
  assert.equal(stackedHideFd.topStacks[0].price, -127, "hidden FanDuel -105 drops; Circa/Kalshi -127 is next on 3.5");
  assert.equal(stackedHideFd.topStacks[1].line, 2.5);

  const no2p5Cols = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: new Set(["fanduel", "draftkings", "pinnacle"]),
    allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.equal(no2p5Cols.topStacks.length, 1, "toggled-off 2.5 books do not count");
  assert.equal(no2p5Cols.topStacks[0].line, 3.5);

  const now = 1_700_000_000_000;
  const liveSplit = {
    id: "den-kc-live-stack",
    sport: "americanfootball_nfl",
    is_live: true,
    bookOdds: {
      fanduel: { spr_away: -102, spr_away_line: 3.5 },
      draftkings: { spr_away: -110, spr_away_line: 3.5 },
      pinnacle: { spr_away: -108, spr_away_line: 3.5 },
      circa: { spr_away: -120, spr_away_line: 3.5 },
      betcris: { spr_away: -105, spr_away_line: 2.5 },
      bet365: { spr_away: 110, spr_away_line: 2.5 },
    },
    bookLineUpdatedAt: {
      fanduel: { spr_away: now - 241_000 },
      draftkings: { spr_away: now - 2_000 },
      pinnacle: { spr_away: now - 3_000 },
      circa: { spr_away: now - 5_000 },
      betcris: { spr_away: now - 1_000 },
      bet365: { spr_away: now - 4_000 },
    },
  };
  const stackedLive = getOddsBoardCell({
    game: liveSplit, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
    nowMs: now, maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS,
  });
  assert.equal(stackedLive.topStacks.length, 2);
  assert.equal(stackedLive.topStacks[0].line, 3.5);
  assert.equal(stackedLive.topStacks[0].count, 3, "stale FanDuel does not count toward 3.5 popularity");
  assert.equal(stackedLive.topStacks[0].price, -108);
  assert.equal(stackedLive.topStacks[0].primaryKey, "pinnacle");
  assert.equal(stackedLive.topStacks[1].line, 2.5);
  assert.equal(stackedLive.topStacks[1].price, 110, "stale juice on another line cannot leak into 2.5 Best");
  assert.equal(isStackedBestMatch(stackedLive.topStacks, -108, 3.5), true);
  assert.equal(isStackedBestMatch(stackedLive.topStacks, -110, 3.5), false);
  assert.equal(isStackedBestMatch(stackedLive.topStacks, 110, 2.5), true);
  assert.equal(isStackedBestMatch(stackedLive.topStacks, -102, 3.5), false);

  const { bestAway, awayStacks, pointStacks } = getBestForGame(denKc, "spr", trial, BETSTAMP_TRIAL_BOOKS, { stackedBest: true });
  assert.equal(bestAway, -105);
  assert.equal(awayStacks[0].line, 3.5);
  assert.equal(awayStacks[1].line, 2.5);
  assert.equal(pointStacks[0].point, 3.5);
  assert.equal(pointStacks[0].bot.line, -3.5);

  const ungated = getOddsBoardCell({
    game: denKc, bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
  });
  assert.equal(ungated.topStacks, null, "omitting stackedBest leaves Single / public Best unchanged");
  assert.equal(ungated.pointStacks, null);
}

// ── Top 2 pairs both sides of the same |point| (totals + spreads)
{
  const trial = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));

  const uniqueCount = pickBestByPopularPoints(
    [
      { key: "fanduel", price: -110, line: 47.5 },
      { key: "draftkings", price: -108, line: 47.5 },
    ],
    [
      { key: "fanduel", price: -110, line: 47.5 },
      { key: "draftkings", price: -112, line: 47.5 },
      { key: "kalshi", price: 101, line: 45.5 },
    ],
    null,
    { market: "tot" },
  );
  assert.equal(uniqueCount[0].point, 47.5);
  assert.equal(uniqueCount[0].count, 2, "a book quoting both over and under 47.5 counts once");
  assert.equal(uniqueCount[1].point, 45.5);
  assert.equal(uniqueCount[1].count, 1);
  assert.equal(uniqueCount[1].top.price, null, "no over at 45.5 → empty half");
  assert.equal(uniqueCount[1].top.lineLabel, "o45.5");
  assert.equal(uniqueCount[1].bot.price, 101);
  assert.equal(uniqueCount[1].bot.lineLabel, "u45.5");

  const denKcTot = {
    id: "den-kc-tot-pair",
    sport: "americanfootball_nfl",
    bookOdds: {
      fanduel: { tot_over: -110, tot_under: -110, tot_line: 47.5 },
      draftkings: { tot_over: -108, tot_under: -102, tot_line: 47.5 },
      pinnacle: { tot_over: -111, tot_under: -109, tot_line: 47.5 },
      williamhill_us: { tot_over: -105, tot_under: -115, tot_line: 47.5 },
      betonlineag: { tot_over: -107, tot_under: -113, tot_line: 47.5 },
      kalshi: { tot_over: 101, tot_under: -127, tot_line: 45.5 },
      prophetx: { tot_over: 102, tot_under: -102, tot_line: 47.5 },
    },
  };
  const pairedTot = getOddsBoardCell({
    game: denKcTot, bookKey: "best", market: "tot",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.deepEqual(pairedTot.pointStacks.map((b) => b.point), [47.5, 45.5]);
  assert.equal(pairedTot.pointStacks[0].top.lineLabel, "o47.5");
  assert.equal(pairedTot.pointStacks[0].top.price, 102);
  assert.equal(pairedTot.pointStacks[0].top.primaryKey, "prophetx");
  assert.equal(pairedTot.pointStacks[0].bot.lineLabel, "u47.5");
  assert.equal(pairedTot.pointStacks[0].bot.price, -102);
  assert.equal(pairedTot.pointStacks[0].bot.primaryKey, "draftkings");
  assert.equal(pairedTot.pointStacks[1].top.lineLabel, "o45.5");
  assert.equal(pairedTot.pointStacks[1].top.price, 101);
  assert.equal(pairedTot.pointStacks[1].top.primaryKey, "kalshi");
  assert.equal(pairedTot.pointStacks[1].bot.lineLabel, "u45.5");
  assert.equal(pairedTot.pointStacks[1].bot.price, -127);
  assert.equal(pairedTot.topStacks[0].line, pairedTot.botStacks[0].line);
  assert.equal(pairedTot.topStacks[1].line, pairedTot.botStacks[1].line);

  const mismatchTot = getOddsBoardCell({
    game: {
      id: "tot-mismatch",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { tot_over: -110, tot_under: -110, tot_line: 47.5 },
        draftkings: { tot_over: -108, tot_under: -112, tot_line: 47.5 },
        pinnacle: { tot_over: -111, tot_under: -109, tot_line: 47.5 },
        kalshi: { tot_over: 100, tot_line: 45.5 },
        bet365: { tot_over: 101, tot_line: 45.5 },
        betcris: { tot_under: -115, tot_line: 48.5 },
        circa: { tot_under: -118, tot_line: 48.5 },
        betonlineag: { tot_under: -104, tot_line: 48.5 },
        williamhill_us: { tot_under: -120, tot_line: 48.5 },
      },
    },
    bookKey: "best", market: "tot",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.deepEqual(mismatchTot.pointStacks.map((b) => b.point), [48.5, 47.5], "union book count picks 48.5 over the overs-only 45.5");
  assert.equal(mismatchTot.pointStacks[0].top.price, null, "no over quotes at 48.5 → —");
  assert.equal(mismatchTot.pointStacks[0].top.lineLabel, "o48.5");
  assert.equal(mismatchTot.pointStacks[0].bot.price, -104);
  assert.equal(mismatchTot.pointStacks[0].bot.primaryKey, "betonlineag");
  assert.equal(mismatchTot.pointStacks[1].top.lineLabel, "o47.5");
  assert.equal(mismatchTot.pointStacks[1].bot.lineLabel, "u47.5");
  assert.equal(mismatchTot.topStacks.some((s) => s.line === 45.5), false, "per-side 45.5 does not leak in");

  const singleMismatch = getOddsBoardCell({
    game: {
      id: "tot-mismatch",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { tot_over: -110, tot_under: -110, tot_line: 47.5 },
        draftkings: { tot_over: -108, tot_under: -112, tot_line: 47.5 },
        pinnacle: { tot_over: -111, tot_under: -109, tot_line: 47.5 },
        kalshi: { tot_over: 100, tot_line: 45.5 },
        bet365: { tot_over: 101, tot_line: 45.5 },
        betcris: { tot_under: -115, tot_line: 48.5 },
        circa: { tot_under: -118, tot_line: 48.5 },
        betonlineag: { tot_under: -104, tot_line: 48.5 },
        williamhill_us: { tot_under: -120, tot_line: 48.5 },
      },
    },
    bookKey: "best", market: "tot",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
  });
  assert.equal(singleMismatch.top, 101, "Single totals still pick juice across lines");
  assert.equal(singleMismatch.topStacks, null);
  assert.equal(singleMismatch.pointStacks, null);
  assert.equal(singleMismatch.topLine, "o47.5", "Single still labels the DK total");

  const pairedSpr = getOddsBoardCell({
    game: {
      id: "spr-pair",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { spr_away: -110, spr_away_line: 6.5, spr_home: -110, spr_home_line: -6.5 },
        draftkings: { spr_away: -105, spr_away_line: 6.5, spr_home: -115, spr_home_line: -6.5 },
        pinnacle: { spr_away: -108, spr_away_line: 6.5, spr_home: -112, spr_home_line: -6.5 },
        williamhill_us: { spr_away: -114, spr_away_line: 6.5, spr_home: -106, spr_home_line: -6.5 },
        betonlineag: { spr_away: -120, spr_away_line: 6.5, spr_home: 100, spr_home_line: -6.5 },
        kalshi: { spr_away: 105, spr_away_line: 10.5, spr_home: -125, spr_home_line: -10.5 },
        bet365: { spr_away: -102, spr_away_line: 10.5, spr_home: -118, spr_home_line: -10.5 },
      },
    },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.deepEqual(pairedSpr.pointStacks.map((b) => b.point), [6.5, 10.5]);
  assert.equal(pairedSpr.pointStacks[0].top.lineLabel, "+6.5");
  assert.equal(pairedSpr.pointStacks[0].top.price, -105);
  assert.equal(pairedSpr.pointStacks[0].bot.lineLabel, "-6.5");
  assert.equal(pairedSpr.pointStacks[0].bot.price, 100);
  assert.equal(pairedSpr.pointStacks[1].top.lineLabel, "+10.5");
  assert.equal(pairedSpr.pointStacks[1].bot.lineLabel, "-10.5");
  assert.equal(pairedSpr.pointStacks[1].top.price, 105);
  assert.equal(pairedSpr.pointStacks[1].bot.price, -118);

  const mismatchSpr = getOddsBoardCell({
    game: {
      id: "spr-mismatch",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { spr_away: -110, spr_away_line: 6.5, spr_home: -110, spr_home_line: -6.5 },
        draftkings: { spr_away: -108, spr_away_line: 6.5, spr_home: -112, spr_home_line: -6.5 },
        pinnacle: { spr_away: -111, spr_away_line: 6.5, spr_home: -109, spr_home_line: -6.5 },
        kalshi: { spr_away: 102, spr_away_line: 10.5 },
        bet365: { spr_away: 100, spr_away_line: 10.5 },
        betcris: { spr_home: 105, spr_home_line: -3.5 },
        circa: { spr_home: 101, spr_home_line: -3.5 },
        betonlineag: { spr_home: 110, spr_home_line: -3.5 },
      },
    },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.deepEqual(mismatchSpr.pointStacks.map((b) => b.point), [6.5, 3.5], "home-only 3.5 beats away-only 10.5 on unique books");
  assert.equal(mismatchSpr.pointStacks[0].top.lineLabel, "+6.5");
  assert.equal(mismatchSpr.pointStacks[0].bot.lineLabel, "-6.5");
  assert.equal(mismatchSpr.pointStacks[1].top.price, null, "no away +3.5 → —");
  assert.equal(mismatchSpr.pointStacks[1].top.lineLabel, "+3.5");
  assert.equal(mismatchSpr.pointStacks[1].bot.lineLabel, "-3.5");
  assert.equal(mismatchSpr.pointStacks[1].bot.price, 110);
  assert.equal(mismatchSpr.topStacks.some((s) => s.line === 10.5), false);

  const favAway = getOddsBoardCell({
    game: {
      id: "spr-fav-away",
      sport: "americanfootball_nfl",
      bookOdds: {
        fanduel: { spr_away: -110, spr_away_line: -3.5, spr_home: -110, spr_home_line: 3.5 },
        draftkings: { spr_away: -105, spr_away_line: -3.5, spr_home: -115, spr_home_line: 3.5 },
        pinnacle: { spr_away: -108, spr_away_line: -3.5, spr_home: -112, spr_home_line: 3.5 },
        kalshi: { spr_away: 104, spr_away_line: -7.5, spr_home: -124, spr_home_line: 7.5 },
      },
    },
    bookKey: "best", market: "spr",
    selectedBookKeys: trial, allBooks: BETSTAMP_TRIAL_BOOKS,
    stackedBest: true,
  });
  assert.deepEqual(favAway.pointStacks.map((b) => b.point), [3.5, 7.5]);
  assert.equal(favAway.pointStacks[0].top.lineLabel, "-3.5", "favorite away keeps the minus");
  assert.equal(favAway.pointStacks[0].bot.lineLabel, "+3.5");
  assert.equal(favAway.pointStacks[0].top.price, -105);
}

console.log("oddsBoard.test.js ok");
