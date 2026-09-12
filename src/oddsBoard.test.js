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

console.log("oddsBoard.test.js ok");
