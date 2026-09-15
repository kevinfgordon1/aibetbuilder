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
  isFreshForLiveBestOdds,
  oddsBoardHideKey,
  hideSideFromPriceKey,
  isHiddenOddsCell,
} from "./oddsBoard.js";

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

// ── live Best Odds: quotes ≥ 4 minutes old cannot win
{
  assert.equal(LIVE_BEST_ODDS_MAX_AGE_MS, 240_000);
  const now = 1_700_000_000_000;
  assert.equal(isFreshForLiveBestOdds(now - 239_999, now), true);
  assert.equal(isFreshForLiveBestOdds(now - 240_000, now), false);
  assert.equal(isFreshForLiveBestOdds(now - 300_000, now), false);
  assert.equal(isFreshForLiveBestOdds(null, now), false);
  assert.equal(isFreshForLiveBestOdds(undefined, now), false);

  const freshPick = pickBestSide([
    { key: "draftkings", price: 120, updatedAt: now - 241_000 },
    { key: "kalshi", price: 105, updatedAt: now - 1_000 },
  ], { nowMs: now, maxAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS });
  assert.equal(freshPick.price, 105);
  assert.equal(freshPick.primaryKey, "kalshi");

  const noneFresh = pickBestSide([
    { key: "draftkings", price: 120, updatedAt: now - 241_000 },
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
        ml_away: now - 241_000,
        ml_home: now - 5_000,
        spr_away: now - 300_000,
        spr_home: now - 2_000,
        tot_over: now - 241_000,
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
      draftkings: { ml_away: now - 241_000 },
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
      draftkings: { ml_away: now - 241_000 },
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

console.log("oddsBoard.test.js ok");
