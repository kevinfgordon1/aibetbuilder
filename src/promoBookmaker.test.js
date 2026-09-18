import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BOOKS, TRUSTED_BOOK_KEYS } from "../lib/promo-ev.js";
import { matchingBookList } from "./promoMatchingBooks.js";
import { bookKeyForMarket } from "./betstampNormalize.js";
import { transformOddsData } from "./oddsTransform.js";
import {
  BOOKMAKER_BOOK_ID,
  BOOKMAKER_BOOK_KEY,
  BOOKMAKER_COMMENCE_WINDOW_MS,
  BOOKMAKER_TITLE,
  abbrHitsName,
  bookmakerBookmakerFromSnapshot,
  bookmakerSnapshotUrl,
  fetchBookmakerSnapshot,
  resolveBookmakerSnapshot,
  bookmakerLeaguesForSports,
  bookmakerSnapCovers,
  missingBookmakerLeagues,
  mergeBookmakerSnapshots,
  foldTeamName,
  joinOddsEventToBetstampFixture,
  leaguesForSports,
  marketIsBookmaker,
  overlayBookmakerOnCacheRows,
  overlayBookmakerOnGame,
  overlayBookmakerOnGames,
  teamMatchScore,
  teamsLikelySame,
  uniquePairScore,
  oddsApiOutcomeName,
  namesLooselyEqual,
  fixtureIdsPricedByBookmaker,
  bookmakerConflictsWithEventBooks,
} from "./promoBookmaker.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

function nflEvent(overrides = {}) {
  return {
    id: "odds-den-kc",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: future,
    away_team: "Denver Broncos",
    home_team: "Kansas City Chiefs",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Denver Broncos", price: -110 }, { name: "Kansas City Chiefs", price: -110 }] },
          { key: "spreads", outcomes: [{ name: "Denver Broncos", price: -110, point: 3.5 }, { name: "Kansas City Chiefs", price: -110, point: -3.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -110, point: 44.5 }, { name: "Under", price: -110, point: 44.5 }] },
        ],
      },
    ],
    ...overrides,
  };
}

function bookmakerSnapshot({ fixtureId = "fix-den-kc", commence = future, extraFixtures = [], extraMarkets = [] } = {}) {
  const den = { id: "team-den", name: "Denver Broncos", abbreviation: "DEN" };
  const kc = { id: "team-kc", name: "Kansas City Chiefs", abbreviation: "KC" };
  return {
    ok: true,
    fixtures: [
      {
        id: fixtureId,
        league: "NFL",
        start_date: commence,
        home_team_id: kc.id,
        away_team_id: den.id,
      },
      ...extraFixtures,
    ],
    teams: [den, kc],
    markets: [
      { odds: 2.20, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId, team_id: den.id, size: 250 },
      { odds: 1.71, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId, team_id: kc.id },
      { odds: 1.91, number: 2.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.91, number: -2.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.87, number: 46.5, side: "Over", side_type: "Over", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.95, number: 46.5, side: "Under", side_type: "Under", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.50, number: -7.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "1H", odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.80, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: fixtureId },
      ...extraMarkets,
    ],
  };
}

{
  assert.equal(BOOKMAKER_BOOK_KEY, "bookmaker");
  assert.equal(BOOKMAKER_BOOK_ID, 642);
  assert.equal(BOOKMAKER_TITLE, "Bookmaker");
  assert.ok(BOOKMAKER_COMMENCE_WINDOW_MS >= 6 * 60 * 60 * 1000);
  assert.equal(TRUSTED_BOOK_KEYS.has("bookmaker"), true);
  assert.equal(TRUSTED_BOOK_KEYS.has("betcris"), false);
  assert.equal(ALL_BOOKS.find((b) => b.key === "bookmaker")?.label, "Bookmaker");
  assert.ok(!ALL_BOOKS.find((b) => b.key === "bookmaker")?.exchange);
  assert.equal(ALL_BOOKS.some((b) => b.key === "betcris"), false);
  assert.equal(ALL_BOOKS.some((b) => /betcris/i.test(b.label || "")), false);
  assert.deepEqual(leaguesForSports(["americanfootball_nfl", "baseball_mlb"]), ["NFL"]);
  assert.deepEqual(leaguesForSports(new Set(["americanfootball_ncaaf", "americanfootball_nfl"])), ["NFL", "NCAAF"]);
  assert.deepEqual(leaguesForSports(["baseball_mlb"]), []);
}

{
  const chips = matchingBookList(ALL_BOOKS, TRUSTED_BOOK_KEYS);
  assert.equal(chips.find((b) => b.key === "bookmaker")?.label, "Bookmaker");
  assert.ok(!chips.some((b) => b.key === "betcris"));
  assert.ok(!chips.some((b) => /betcris/i.test(b.label || "")));
}

{
  const market642 = { odd_provider_id: 642, bet_type: "Moneyline" };
  assert.equal(marketIsBookmaker(market642), true);
  assert.equal(marketIsBookmaker({ odd_provider_id: 200 }), false);
  assert.equal(bookKeyForMarket(market642), "betcris", "New Odds Board may still name 642 BetCris");
  assert.notEqual(bookKeyForMarket(market642), BOOKMAKER_BOOK_KEY);
}

{
  assert.equal(foldTeamName("Ohio St."), "ohio st");
  assert.equal(teamsLikelySame("Denver Broncos", "Denver"), true);
  assert.equal(teamsLikelySame("Kansas City Chiefs", "Kansas City"), true);
  assert.equal(teamsLikelySame("Ohio State Buckeyes", "Ohio State"), true);
  assert.equal(teamsLikelySame("Washington", "Washington State"), false);
  assert.equal(teamsLikelySame("Michigan", "Michigan State"), false);
  assert.equal(teamsLikelySame("Ohio", "Ohio State"), false);
  assert.equal(teamsLikelySame("New York Giants", "Giants"), true);
  assert.equal(teamsLikelySame("Kansas Jayhawks", "Kansas"), true);
  assert.equal(teamsLikelySame("Kansas Jayhawks", "Kansas State"), false);
  assert.equal(teamsLikelySame("Kansas State Wildcats", "Kansas"), false);
  assert.equal(teamsLikelySame("Iowa State Cyclones", "Iowa"), false);
  assert.equal(teamsLikelySame("Arizona State Sun Devils", "Arizona"), false);
  assert.equal(namesLooselyEqual("Kansas Jayhawks", "Arkansas"), false, "kansas ⊂ arkansas is not a token match");
  assert.equal(namesLooselyEqual("Kansas Jayhawks", "Arkansas Razorbacks"), false);
  assert.equal(teamsLikelySame("Kansas Jayhawks", "Arkansas Razorbacks"), false);
  assert.equal(namesLooselyEqual("Denver Broncos", "Denver"), true);
  assert.equal(abbrHitsName("DEN", "Denver Broncos"), true);
  assert.equal(abbrHitsName("KAN", "Kansas Jayhawks"), true, "loose abbr still scores 1 — join must ignore it");
  assert.equal(teamMatchScore("Denver Broncos", "Broncos", "DEN"), 2);
  assert.equal(teamMatchScore("Denver Broncos", "", "DEN"), 1);
  assert.equal(teamMatchScore("Kansas Jayhawks", "Kansas State", "KAN"), 1);
  assert.equal(teamMatchScore("Iowa State Cyclones", "Iowa", "IOWA"), 1);
}

{
  const event = nflEvent();
  const snap = bookmakerSnapshot();
  const join = joinOddsEventToBetstampFixture(event, snap);
  assert.equal(join.fixtureId, "fix-den-kc");
  assert.equal(join.swapped, false);
}

{
  const event = nflEvent();
  const snap = bookmakerSnapshot({
    extraFixtures: [{
      id: "fix-other",
      league: "NFL",
      start_date: future,
      home_team: { name: "Buffalo Bills", abbreviation: "BUF" },
      away_team: { name: "Miami Dolphins", abbreviation: "MIA" },
    }],
  });
  assert.equal(joinOddsEventToBetstampFixture(event, snap).fixtureId, "fix-den-kc");
}

{
  const event = nflEvent();
  const far = new Date(Date.parse(future) + 20 * 60 * 60 * 1000).toISOString();
  const snap = bookmakerSnapshot({ commence: far });
  assert.equal(joinOddsEventToBetstampFixture(event, snap), null);
}

{
  const event = nflEvent({ sport_key: "baseball_mlb", sport: "baseball_mlb" });
  assert.equal(joinOddsEventToBetstampFixture(event, bookmakerSnapshot()), null);
}

{
  const ncaaf = {
    id: "odds-osu-um",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: future,
    away_team: "Ohio State Buckeyes",
    home_team: "Michigan Wolverines",
    bookmakers: [],
  };
  const washington = {
    id: "fix-uw-wsu",
    league: "NCAAF",
    start_date: future,
    home_team: { name: "Washington State", abbreviation: "WSU" },
    away_team: { name: "Washington", abbreviation: "UW" },
  };
  const osu = {
    id: "fix-osu-um",
    league: "NCAAF",
    start_date: future,
    home_team: { name: "Michigan", abbreviation: "MICH" },
    away_team: { name: "Ohio State", abbreviation: "OSU" },
  };
  const snap = {
    ok: true,
    fixtures: [washington, osu],
    teams: [],
    markets: [
      { odds: 1.91, side: "OSU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-osu-um" },
      { odds: 1.91, side: "UW", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-uw-wsu" },
    ],
  };
  const join = joinOddsEventToBetstampFixture(ncaaf, snap);
  assert.equal(join.fixtureId, "fix-osu-um");
  assert.equal(joinOddsEventToBetstampFixture({
    ...ncaaf,
    away_team: "Washington Huskies",
    home_team: "Washington State Cougars",
  }, snap).fixtureId, "fix-uw-wsu");
}

{
  const event = nflEvent();
  const bm = bookmakerBookmakerFromSnapshot(event, bookmakerSnapshot());
  assert.equal(bm.key, "bookmaker");
  assert.equal(bm.title, "Bookmaker");
  assert.notEqual(bm.key, "betcris");
  const h2h = bm.markets.find((m) => m.key === "h2h");
  const spr = bm.markets.find((m) => m.key === "spreads");
  const tot = bm.markets.find((m) => m.key === "totals");
  assert.equal(h2h.outcomes.find((o) => o.name === "Denver Broncos").price, 120);
  assert.equal(h2h.outcomes.find((o) => o.name === "Kansas City Chiefs").price, -141);
  assert.equal(h2h.outcomes.find((o) => o.name === "Denver Broncos").size, 250);
  assert.equal(spr.outcomes.find((o) => o.name === "Denver Broncos").point, 2.5);
  assert.equal(spr.outcomes.find((o) => o.name === "Kansas City Chiefs").point, -2.5);
  assert.equal(tot.outcomes.find((o) => o.name === "Over").point, 46.5);
  assert.equal(tot.outcomes.find((o) => o.name === "Under").price, -105);
  assert.equal(bm.markets.some((m) => m.key === "alternate_spreads"), false);
  assert.ok(!h2h.outcomes.some((o) => o.price === -125), "DK-only / 1H / alt / other-book quotes stay out");
}

{
  const overlaid = overlayBookmakerOnGame(nflEvent(), bookmakerSnapshot());
  assert.equal(overlaid.bookmakers.some((b) => b.key === "draftkings"), true);
  assert.equal(overlaid.bookmakers.filter((b) => b.key === "bookmaker").length, 1);
  assert.equal(overlaid.bookmakers.some((b) => b.key === "betcris"), false);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.bookmaker.ml_away, 120);
  assert.equal(ml.bookOdds.bookmaker.ml_home, -141);
  assert.equal(ml.best_away, 120);
  assert.equal(ml.best_away_book, "bookmaker");
  assert.notEqual(ml.best_away_book, "betcris");
  const spr = data.run_lines.find((r) => r.book === "bookmaker");
  assert.equal(spr.away_point, 2.5);
  assert.equal(spr.away_odds, -110);
  const tot = data.totals.find((r) => r.book === "bookmaker");
  assert.equal(tot.line, 46.5);
  assert.equal(data.run_lines.some((r) => r.book === "betcris"), false);
}

{
  const withZombie = overlayBookmakerOnGame(nflEvent(), bookmakerSnapshot());
  assert.ok(withZombie.bookmakers.some((b) => b.key === "bookmaker"));
  const cleared = overlayBookmakerOnGame(withZombie, {
    ok: true,
    fixtures: bookmakerSnapshot().fixtures,
    teams: bookmakerSnapshot().teams,
    markets: [],
  });
  assert.equal(cleared.bookmakers.some((b) => b.key === "bookmaker"), false);
  const omitted = overlayBookmakerOnGame(withZombie, null);
  assert.equal(omitted.bookmakers.some((b) => b.key === "bookmaker"), false);
}

{
  const mlb = {
    id: "odds-nyy-bos",
    sport_key: "baseball_mlb",
    sport: "baseball_mlb",
    commence_time: future,
    away_team: "New York Yankees",
    home_team: "Boston Red Sox",
    bookmakers: [{ key: "draftkings", markets: [] }],
  };
  const rows = overlayBookmakerOnCacheRows([
    { sport: "americanfootball_nfl", data: [nflEvent()] },
    { sport: "baseball_mlb", data: [mlb] },
    { sport: "americanfootball_nfl", data: nflEvent({ id: "odds-event-row" }) },
  ], bookmakerSnapshot());
  assert.equal(rows[0].data[0].bookmakers.some((b) => b.key === "bookmaker"), true);
  assert.equal(rows[1].data[0].bookmakers.some((b) => b.key === "bookmaker"), false);
  assert.equal(rows[2].data.bookmakers.some((b) => b.key === "bookmaker"), true);
  assert.equal(overlayBookmakerOnGames(null, bookmakerSnapshot()), null);
}

{
  const url = bookmakerSnapshotUrl({ leagues: ["NFL", "NCAAF", "MLB"] });
  assert.match(url, /\/api\/betstamp-markets\?/);
  assert.match(url, /league=NFL%2CNCAAF/);
  assert.match(url, /book_ids=642/);
  assert.match(url, /is_live=false/);
  assert.equal(bookmakerSnapshotUrl({ leagues: ["MLB"] }), null);
}

{
  const snap = await fetchBookmakerSnapshot({
    leagues: ["NFL"],
    fetchFn: async (url) => {
      assert.match(url, /book_ids=642/);
      return { ok: true, json: async () => bookmakerSnapshot() };
    },
  });
  assert.equal(snap.fixtures[0].id, "fix-den-kc");
}

{
  assert.equal(await fetchBookmakerSnapshot({ leagues: [] }), null);
  assert.equal(await fetchBookmakerSnapshot({
    leagues: ["NFL"],
    fetchFn: async () => { throw new Error("network"); },
  }), null);
  assert.equal(await fetchBookmakerSnapshot({
    leagues: ["NFL"],
    fetchFn: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, missingKey: true }) }),
  }), null);
  assert.equal(await fetchBookmakerSnapshot({
    leagues: ["NFL"],
    timeoutMs: 20,
    fetchFn: () => new Promise(() => {}),
  }), null);
}

{
  const kick = future;
  const jayhawks = {
    id: "odds-ku-isu",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Iowa State Cyclones",
    home_team: "Kansas Jayhawks",
    bookmakers: [{
      key: "draftkings",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "Kansas Jayhawks", price: 180 },
          { name: "Iowa State Cyclones", price: -218 },
        ],
      }],
    }],
  };
  const ksuIowa = {
    id: "fix-ksu-iowa",
    league: "NCAAF",
    start_date: kick,
    home_team: { name: "Kansas State", abbreviation: "KAN" },
    away_team: { name: "Iowa", abbreviation: "IOWA" },
  };
  const stolen642 = [
    { odds: 1.535, side: "KSU", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ksu-iowa" },
    { odds: 2.55, side: "IOWA", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ksu-iowa" },
  ];
  const ksuOnly = { ok: true, fixtures: [ksuIowa], teams: [], markets: stolen642 };
  assert.equal(joinOddsEventToBetstampFixture(jayhawks, ksuOnly), null, "KAN+IOWA abbr must not join KSU-Iowa onto KU-ISU");
  assert.equal(bookmakerBookmakerFromSnapshot(jayhawks, ksuOnly), null);
  const overlaidSteal = overlayBookmakerOnGame(jayhawks, ksuOnly);
  assert.equal(overlaidSteal.bookmakers.some((b) => b.key === "bookmaker"), false);
  const stolenData = transformOddsData([overlaidSteal], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(stolenData.moneylines[0].bookOdds.bookmaker.ml_home, null);
  assert.notEqual(stolenData.moneylines[0].best_home_book, "bookmaker");
  assert.notEqual(stolenData.moneylines[0].bookOdds.bookmaker.ml_home, -187);
}

{
  const kick = future;
  const jayhawks = {
    id: "odds-ku-wvu",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "West Virginia Mountaineers",
    home_team: "Kansas Jayhawks",
    bookmakers: [],
  };
  const kuFixture = {
    id: "fix-ku-wvu",
    league: "NCAAF",
    start_date: kick,
    home_team: { name: "Kansas", abbreviation: "KU" },
    away_team: { name: "West Virginia", abbreviation: "WVU" },
  };
  const ksuFixture = {
    id: "fix-ksu-wvu",
    league: "NCAAF",
    start_date: kick,
    home_team: { name: "Kansas State", abbreviation: "KAN" },
    away_team: { name: "West Virginia", abbreviation: "WVU" },
  };
  const snap = {
    ok: true,
    fixtures: [kuFixture, ksuFixture],
    teams: [],
    markets: [
      { odds: 1.535, side: "KSU", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ksu-wvu" },
      { odds: 2.55, side: "WVU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ksu-wvu" },
    ],
  };
  const join = joinOddsEventToBetstampFixture(jayhawks, snap);
  assert.equal(join, null, "unpriced KU fixture is not a join candidate; KSU 642 stays off KU");
  assert.equal(bookmakerBookmakerFromSnapshot(jayhawks, snap), null, "no 642 on KU fixture → omit Bookmaker; do not steal KSU -187");
  const overlaid = overlayBookmakerOnGame(jayhawks, snap);
  assert.equal(overlaid.bookmakers.some((b) => b.key === "bookmaker"), false);
  assert.deepEqual([...fixtureIdsPricedByBookmaker(snap)], ["fix-ksu-wvu"]);
}

{
  const kick = future;
  const event = {
    id: "odds-ku-cin",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Kansas Jayhawks",
    home_team: "Cincinnati Bearcats",
    bookmakers: [{
      key: "draftkings",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "Kansas Jayhawks", price: 180 },
          { name: "Cincinnati Bearcats", price: -218 },
        ],
      }],
    }],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-ku-cin",
      league: "NCAAF",
      start_date: kick,
      home_team_id: "team-ku",
      away_team_id: "team-cin",
    }],
    teams: [
      { id: "team-ku", name: "Kansas", abbreviation: "KU" },
      { id: "team-cin", name: "Cincinnati", abbreviation: "CIN" },
    ],
    markets: [
      { odds: 2.55, side: "KU", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ku-cin", team_id: "team-ku" },
      { odds: 1.535, side: "CIN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ku-cin", team_id: "team-cin" },
    ],
  };
  const join = joinOddsEventToBetstampFixture(event, snap);
  assert.equal(join.swapped, true);
  assert.equal(uniquePairScore(event, join.sides).swapped, true);
  assert.equal(oddsApiOutcomeName(snap.markets[0], event, join), "Kansas Jayhawks");
  assert.equal(oddsApiOutcomeName(snap.markets[1], event, join), "Cincinnati Bearcats");
  const bm = bookmakerBookmakerFromSnapshot(event, snap);
  const ku = bm.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Kansas Jayhawks");
  const cin = bm.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Cincinnati Bearcats");
  assert.equal(ku.price, 155, "Kansas keeps the dog Bookmaker price after home/away swap");
  assert.equal(cin.price, -187);
  assert.notEqual(ku.price, -187, "favorite −187 must not land on underdog +180 side");
  const data = transformOddsData([overlayBookmakerOnGame(event, snap)], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(data.moneylines[0].bookOdds.bookmaker.ml_away, 155);
  assert.equal(data.moneylines[0].bookOdds.bookmaker.ml_home, -187);
}

{
  // Live 2026-09-19 shape: Odds API Kansas @ Arizona State (FD +168), Betstamp
  // string home_team + home_id/home_abbr, KU home vs ASU, 642 KU 2.63 / ASU 1.526.
  // Side map must keep +163 on Kansas. Complement of a misplaced +163 is the
  // screenshot −163 (62.0%) / +24.7% edge vs FanDuel +168.
  const kick = "2026-09-19T16:00:00Z";
  const jayhawks = {
    id: "odds-ku-asu",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Kansas Jayhawks",
    home_team: "Arizona State Sun Devils",
    bookmakers: [
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Kansas Jayhawks", price: 168 },
            { name: "Arizona State Sun Devils", price: -205 },
          ],
        }],
      },
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Kansas Jayhawks", price: 170 },
            { name: "Arizona State Sun Devils", price: -205 },
          ],
        }],
      },
      {
        key: "pinnacle",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Kansas Jayhawks", price: 178 },
            { name: "Arizona State Sun Devils", price: -210 },
          ],
        }],
      },
    ],
  };
  const kuId = "0191b82a-3497-7f42-a550-34e3071d7869";
  const asuId = "0191b82a-34d7-7034-822a-0294e61e8b0a";
  const liveSnap = {
    ok: true,
    fixtures: [{
      id: "019e5010-312a-7e87-a97d-6e8776f8050f",
      date: kick,
      league: "NCAAF",
      home_team: "Kansas Jayhawks",
      away_team: "Arizona State Sun Devils",
      home_abbr: "KU",
      away_abbr: "ASU",
      home_id: kuId,
      away_id: asuId,
      status: "scheduled",
      type: "match",
    }],
    teams: [
      { id: kuId, abbr: "KU", full_name: "Kansas Jayhawks", league: "NCAAF" },
      { id: asuId, abbr: "ASU", full_name: "Arizona State Sun Devils", league: "NCAAF" },
    ],
    markets: [
      { odds: 2.63, side: "KU", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "019e5010-312a-7e87-a97d-6e8776f8050f", team_id: kuId },
      { odds: 1.526, side: "ASU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "019e5010-312a-7e87-a97d-6e8776f8050f", team_id: asuId },
    ],
  };
  const join = joinOddsEventToBetstampFixture(jayhawks, liveSnap);
  assert.equal(join.fixtureId, "019e5010-312a-7e87-a97d-6e8776f8050f");
  assert.equal(join.swapped, true);
  assert.equal(oddsApiOutcomeName(liveSnap.markets[0], jayhawks, join), "Kansas Jayhawks");
  assert.equal(oddsApiOutcomeName(liveSnap.markets[1], jayhawks, join), "Arizona State Sun Devils");
  const overlaid = overlayBookmakerOnGame(jayhawks, liveSnap);
  const bm = overlaid.bookmakers.find((b) => b.key === "bookmaker");
  const ku = bm.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Kansas Jayhawks");
  const asu = bm.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "Arizona State Sun Devils");
  assert.equal(ku.price, 163);
  assert.equal(asu.price, -190);
  const data = transformOddsData([overlaid], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(data.moneylines[0].bookOdds.bookmaker.ml_away, 163);
  assert.equal(data.moneylines[0].bookOdds.bookmaker.ml_home, -190);
  assert.notEqual(data.moneylines[0].best_home, 163, "ASU must not inherit KU +163");
  const asuTrue = data.moneylines[0].best_home;
  const ourTrue = 1 - (asuTrue < 0 ? Math.abs(asuTrue) / (Math.abs(asuTrue) + 100) : 100 / (asuTrue + 100));
  assert.ok(ourTrue < 0.5, "Kansas true from ASU Bookmaker must stay the dog, not 62%");
  assert.ok(Math.abs(ourTrue - 0.62) > 0.05, "screenshot 62% / −163 complement of +163 must not appear");
}

{
  // Stale odds_cache Bookmaker −163 on Kansas (pre-#166 overlay baked into JSON)
  // plus a 642 snapshot that does not price the Jayhawks fixture.
  const kick = future;
  const stale = {
    id: "odds-ku-stale",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Kansas Jayhawks",
    home_team: "Arizona State Sun Devils",
    bookmakers: [
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Kansas Jayhawks", price: 168 },
            { name: "Arizona State Sun Devils", price: -205 },
          ],
        }],
      },
      {
        key: "bookmaker",
        title: "Bookmaker",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Kansas Jayhawks", price: -163 },
            { name: "Arizona State Sun Devils", price: 163 },
          ],
        }],
      },
    ],
  };
  const empty642 = {
    ok: true,
    fixtures: [{
      id: "fix-ku-asu",
      league: "NCAAF",
      date: kick,
      home_team: "Kansas Jayhawks",
      away_team: "Arizona State Sun Devils",
      home_abbr: "KU",
      away_abbr: "ASU",
    }],
    teams: [],
    markets: [],
  };
  const cleared = overlayBookmakerOnGame(stale, empty642);
  assert.equal(cleared.bookmakers.some((b) => b.key === "bookmaker"), false, "refresh strips cached Bookmaker when 642 has no KU market");
  const clearedNull = overlayBookmakerOnGame(stale, null);
  assert.equal(clearedNull.bookmakers.some((b) => b.key === "bookmaker"), false);
  const rows = overlayBookmakerOnCacheRows([{ sport: "americanfootball_ncaaf", data: [stale] }], empty642);
  assert.equal(rows[0].data[0].bookmakers.some((b) => b.key === "bookmaker"), false);
  const staleData = transformOddsData([cleared], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(staleData.moneylines[0].bookOdds.bookmaker.ml_away, null);
  assert.notEqual(staleData.moneylines[0].best_away_book, "bookmaker");
  assert.notEqual(staleData.moneylines[0].best_home_book, "bookmaker");
}

{
  // Inverted 642 (KU +163 landed on Arizona State) must be dropped so Promo
  // cannot show −163 on Bookmaker as Kansas true / +24.7% vs FanDuel +168.
  const kick = future;
  const event = {
    id: "odds-ku-inverted",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Kansas Jayhawks",
    home_team: "Arizona State Sun Devils",
    bookmakers: [
      {
        key: "fanduel",
        markets: [{ key: "h2h", outcomes: [{ name: "Kansas Jayhawks", price: 168 }, { name: "Arizona State Sun Devils", price: -205 }] }],
      },
      {
        key: "draftkings",
        markets: [{ key: "h2h", outcomes: [{ name: "Kansas Jayhawks", price: 170 }, { name: "Arizona State Sun Devils", price: -205 }] }],
      },
    ],
  };
  const invertedBm = {
    key: "bookmaker",
    title: "Bookmaker",
    markets: [{
      key: "h2h",
      outcomes: [
        { name: "Kansas Jayhawks", price: -163 },
        { name: "Arizona State Sun Devils", price: 163 },
      ],
    }],
  };
  assert.equal(bookmakerConflictsWithEventBooks(event, invertedBm), true);
  const flippedSnap = {
    ok: true,
    fixtures: [{
      id: "fix-ku-asu-flip",
      league: "NCAAF",
      start_date: kick,
      home_team: { name: "Kansas Jayhawks", abbreviation: "KU" },
      away_team: { name: "Arizona State Sun Devils", abbreviation: "ASU" },
    }],
    teams: [],
    markets: [
      // team_id omitted; side_type Home without remap would put +163 on Odds API home (ASU).
      // Force the wrong names via side strings that match Odds API home/away.
      { odds: 2.63, side: "Arizona State Sun Devils", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ku-asu-flip" },
      { odds: 1.613, side: "Kansas Jayhawks", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: "fix-ku-asu-flip" },
    ],
  };
  const flipped = overlayBookmakerOnGame(event, flippedSnap);
  assert.equal(flipped.bookmakers.some((b) => b.key === "bookmaker"), false, "consensus guard omits inverted 642 so −163 cannot be Kansas true");
  const flippedData = transformOddsData([flipped], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.notEqual(flippedData.moneylines[0].best_home, 163);
  assert.notEqual(flippedData.moneylines[0].best_home_book, "bookmaker");
  const asuBest = flippedData.moneylines[0].best_home;
  const our = 1 - (asuBest < 0 ? Math.abs(asuBest) / (Math.abs(asuBest) + 100) : 100 / (asuBest + 100));
  const fdImp = 100 / 268;
  assert.ok(Math.abs(our - 0.62) > 0.05);
  assert.ok(our - fdImp < 0.10, "FanDuel +168 must not pick up the screenshot +24.7% fake edge");
}

{
  assert.deepEqual(bookmakerLeaguesForSports(["americanfootball_nfl", "baseball_mlb"]), ["NFL"]);
  assert.deepEqual(bookmakerLeaguesForSports(["basketball_nba"]), []);
  assert.deepEqual(bookmakerLeaguesForSports(["americanfootball_nfl", "americanfootball_ncaaf"]), ["NFL", "NCAAF"]);
  const cachedNfl = { snap: bookmakerSnapshot(), leagues: ["NFL"] };
  assert.equal(bookmakerSnapCovers(cachedNfl, ["NFL"]), true);
  assert.equal(bookmakerSnapCovers(cachedNfl, ["NFL", "NCAAF"]), false);
  assert.equal(bookmakerSnapCovers(cachedNfl, []), true);
  assert.deepEqual(missingBookmakerLeagues(cachedNfl, ["NFL", "NCAAF"]), ["NCAAF"]);
  const ncaafSnap = bookmakerSnapshot({ fixtureId: "fix-ncaaf" });
  ncaafSnap.fixtures[0].league = "NCAAF";
  const merged = mergeBookmakerSnapshots(cachedNfl.snap, ncaafSnap);
  assert.equal(merged.fixtures.some((f) => f.id === "fix-den-kc"), true);
  assert.equal(merged.fixtures.some((f) => f.id === "fix-ncaaf"), true);
  const reused = await resolveBookmakerSnapshot({
    sports: ["americanfootball_nfl", "basketball_nba"],
    cached: cachedNfl,
    fetchFn: async () => { throw new Error("must not refetch NFL when adding NBA"); },
  });
  assert.equal(reused.fromCache, true);
  assert.equal(reused.snap, cachedNfl.snap);
  let fetchedLeagues = null;
  const added = await resolveBookmakerSnapshot({
    sports: ["americanfootball_nfl", "americanfootball_ncaaf"],
    cached: cachedNfl,
    fetchFn: async (url) => {
      fetchedLeagues = url;
      return { ok: true, json: async () => ncaafSnap };
    },
  });
  assert.equal(added.fromCache, false);
  assert.match(fetchedLeagues, /league=NCAAF/);
  assert.doesNotMatch(fetchedLeagues, /NFL/);
  assert.equal(added.leagues.includes("NFL"), true);
  assert.equal(added.leagues.includes("NCAAF"), true);
  const kept = await resolveBookmakerSnapshot({
    sports: ["americanfootball_nfl", "americanfootball_ncaaf"],
    cached: cachedNfl,
    fetchFn: async () => ({ ok: false }),
  });
  assert.equal(kept.fromCache, true);
  assert.equal(kept.snap, cachedNfl.snap);
  let forceUrl = null;
  const forced = await resolveBookmakerSnapshot({
    sports: ["americanfootball_nfl"],
    cached: cachedNfl,
    forceRefresh: true,
    fetchFn: async (url) => {
      forceUrl = url;
      return { ok: true, json: async () => bookmakerSnapshot() };
    },
  });
  assert.equal(forced.fromCache, false);
  assert.match(forceUrl, /league=NFL/);
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const ev = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  const matching = fs.readFileSync(path.join(dir, "promoMatchingBooks.js"), "utf8");
  assert.match(app, /key: "bookmaker", label: "Bookmaker", color: "#f59e0b"/);
  assert.match(app, /from "\.\/promoBookmaker\.js"/);
  assert.match(app, /overlayBookmakerOnCacheRows/);
  assert.match(app, /resolveBookmakerSnapshot/);
  assert.match(app, /bookmakerCacheRef/);
  assert.match(app, /Betstamp Bookmaker overlay is best-effort/);
  assert.doesNotMatch(app, /promoBetcris/);
  assert.doesNotMatch(app, /key: "betcris"/);
  assert.doesNotMatch(app, /label: "BetCris"/);
  assert.doesNotMatch(app, /overlayBetcris|fetchBetcrisSnapshot|BETCRIS_/);
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted[1].includes("bookmaker"));
  assert.ok(!appTrusted[1].includes("betcris"));
  const evTrusted = ev.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(evTrusted[1].includes("bookmaker"));
  assert.ok(!evTrusted[1].includes("betcris"));
  assert.match(ev, /key: "bookmaker", label: "Bookmaker"/);
  assert.doesNotMatch(ev, /key: "betcris"/);
  assert.doesNotMatch(ev, /label: "BetCris"/);
  assert.doesNotMatch(matching, /betcris/);
}

console.log("promoBookmaker.test.js ok");
