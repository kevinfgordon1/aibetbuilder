import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decimalToAmerican,
  toAmericanOdds,
  marketSize,
  gamesFromBetstampSnapshot,
  applyStreamMarkets,
  gameVisibleOnBoard,
  gameIsFinished,
  fixtureCommence,
  fixtureIsClosed,
  unwrapStreamPayload,
  emptyTickStats,
  recordTicks,
  summarizeTickStats,
  quantile,
  isMainMarket,
  isBoardMarket,
  fixtureAltLadders,
  spreadAwayLine,
  marketSide,
  formatCompactAge,
  formatWinProb,
  cellShowsWinProb,
  lineFieldFor,
  cellLineFields,
  lineUpdatedAt,
  bestLineUpdatedAt,
  marketUpdatedAtMs,
} from "./betstampNormalize.js";
import { isPmWinProbBook, BETSTAMP_TRIAL_BOOKS, BETSTAMP_BOOK_IDS } from "./betstampBooks.js";
import { parseSseChunk, nextBackoffMs, betstampSnapshotUrl, betstampStreamUrl, BETSTAMP_PREGAME_POLL_MS } from "./betstampLive.js";
import { getOddsBoardCell, LIVE_BEST_ODDS_MAX_AGE_MS, oddsBoardHideKey } from "./oddsBoard.js";

assert.deepEqual(BETSTAMP_BOOK_IDS, [100, 200, 300, 250, 613, 642, 150, 365, 191, 193, 194]);
assert.equal(BETSTAMP_TRIAL_BOOKS.length, 11);

{
  assert.equal(decimalToAmerican(1.91), -110);
  assert.equal(decimalToAmerican(2.10), 110);
  assert.equal(decimalToAmerican(1), null);
  assert.equal(toAmericanOdds(-110), -110);
  assert.equal(toAmericanOdds(150), 150);
  assert.equal(toAmericanOdds(1.5), -200);
  assert.equal(toAmericanOdds(0.4), 150);
  assert.equal(toAmericanOdds(0.6), -150);
  assert.equal(formatWinProb(150), "40.0%");
  assert.equal(formatWinProb(-110), "52.4%");
  assert.equal(formatWinProb(null), null);
  assert.equal(isPmWinProbBook("kalshi"), true);
  assert.equal(isPmWinProbBook("polymarket"), true);
  assert.equal(isPmWinProbBook("prophetx"), true);
  assert.equal(isPmWinProbBook("draftkings"), false);
  assert.equal(cellShowsWinProb("kalshi"), true);
  assert.equal(cellShowsWinProb("fanduel"), false);
  assert.equal(cellShowsWinProb("best", [{ key: "kalshi" }]), true);
  assert.equal(cellShowsWinProb("best", [{ key: "draftkings" }]), false);
  assert.equal(marketSize({ size: 400 }), 400);
  assert.equal(marketSize({ bet_limit: "80" }), 80);
  assert.equal(marketSize({ size: 0 }), null);
}

{
  const fixtureId = "fix-mnf";
  const den = { id: "team-den", name: "Denver Broncos", abbreviation: "DEN" };
  const kc = { id: "team-kc", name: "Kansas City Chiefs", abbreviation: "KC" };
  const fixture = {
    id: fixtureId,
    league: "NFL",
    start_date: "2026-09-15T00:20:00Z",
    is_live: true,
    home_team_id: kc.id,
    away_team_id: den.id,
    home_score: 10,
    away_score: 7,
  };
  const markets = [
    { id: "1", odds: 1.91, number: null, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 200, fixture_id: fixtureId, team_id: den.id, size: 500 },
    { id: "2", odds: 1.95, number: null, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 200, fixture_id: fixtureId, team_id: kc.id },
    { id: "3", odds: 2.05, number: -3.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 100, fixture_id: fixtureId },
    { id: "4", odds: 1.80, number: 3.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 100, fixture_id: fixtureId },
    { id: "5", odds: 1.91, number: 44.5, side: "Over", side_type: "Over", bet_type: "Total", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 250, fixture_id: fixtureId },
    { id: "6", odds: 1.91, number: 44.5, side: "Under", bet_type: "total", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 250, fixture_id: fixtureId },
    { id: "7", odds: 1.50, number: -7.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", league: "NFL", is_alt: true, odd_provider_id: 200, fixture_id: fixtureId },
    { id: "8", odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "1H", odd_provider_id: 200, fixture_id: fixtureId },
  ];
  const games = gamesFromBetstampSnapshot({ markets, fixtures: [fixture], teams: [den, kc] });
  assert.equal(games.length, 1);
  const g = games[0];
  assert.equal(g.away, "Denver Broncos");
  assert.equal(g.home, "Kansas City Chiefs");
  assert.equal(g.is_live, true);
  assert.equal(g.sport, "americanfootball_nfl");
  assert.equal(g.bookOdds.draftkings.ml_away, -110);
  assert.equal(g.bookOdds.draftkings.ml_home, -105);
  assert.equal(g.bookOdds.draftkings.ml_away_size, 500);
  assert.equal(g.bookOdds.fanduel.spr_away, 105);
  assert.equal(g.bookOdds.fanduel.spr_away_line, -3.5);
  assert.equal(g.bookOdds.pinnacle.tot_over, -110);
  assert.equal(g.bookOdds.pinnacle.tot_line, 44.5);
  assert.equal(g.bookOdds.draftkings.spr_away, null, "alt spread must not overwrite mains");

  const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const ml = getOddsBoardCell({ game: g, bookKey: "draftkings", market: "ml", selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS });
  assert.equal(ml.top, -110);
  assert.equal(ml.bot, -105);
  const sprBest = getOddsBoardCell({ game: g, bookKey: "best", market: "spr", selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS });
  assert.equal(sprBest.top, 105);
  assert.equal(sprBest.topStacks, null, "default Single Best does not stack");

  const sprStacked = getOddsBoardCell({
    game: g, bookKey: "best", market: "spr",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, stackedBest: true,
  });
  assert.equal(sprStacked.topStacks.length, 1);
  assert.equal(sprStacked.topStacks[0].line, -3.5);
  assert.equal(sprStacked.topStacks[0].price, 105);

  const hiddenFdSpr = new Set([oddsBoardHideKey({ gameId: g.id, market: "spr", side: "away", bookKey: "fanduel" })]);
  const sprAfterHide = getOddsBoardCell({
    game: g, bookKey: "best", market: "spr",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, hiddenKeys: hiddenFdSpr,
  });
  assert.equal(sprAfterHide.top, null, "hiding the only book on that side leaves Best as —");
  const sprStackedHide = getOddsBoardCell({
    game: g, bookKey: "best", market: "spr",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, hiddenKeys: hiddenFdSpr, stackedBest: true,
  });
  assert.equal(sprStackedHide.top, null);
  assert.deepEqual(sprStackedHide.topStacks, []);
  const fdSpr = getOddsBoardCell({
    game: g, bookKey: "fanduel", market: "spr",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, hiddenKeys: hiddenFdSpr,
  });
  assert.equal(fdSpr.top, 105, "hidden FanDuel square still shows +105");
}

{
  const future = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  assert.equal(gameVisibleOnBoard({ is_live: true, commence_time: past }, { liveOnly: true }), true);
  assert.equal(gameVisibleOnBoard({ is_live: true, commence_time: past }, { liveOnly: false }), false);
  assert.equal(gameVisibleOnBoard({ is_live: false, commence_time: future }, { liveOnly: false }), true);
  assert.equal(gameVisibleOnBoard({ is_live: false, commence_time: past }, { liveOnly: false }), false);
}

{
  assert.equal(fixtureCommence({ date: "2026-09-15T00:15:00Z" }), "2026-09-15T00:15:00Z");
  assert.equal(fixtureCommence({ start_date: "2026-09-20T17:00:00Z" }), "2026-09-20T17:00:00Z");
  assert.equal(fixtureCommence({ kickoff: "2026-09-15T00:20:00Z" }), "2026-09-15T00:20:00Z");
  assert.equal(fixtureIsClosed({ status: "closed" }), true);
  assert.equal(fixtureIsClosed({ status: "final" }), true);
  assert.equal(fixtureIsClosed({ status: "completed" }), true);
  assert.equal(fixtureIsClosed({ status: "scheduled" }), false);
  const now = Date.parse("2026-09-14T20:00:00Z");
  assert.equal(gameVisibleOnBoard({
    is_live: false,
    commence_time: null,
    status: "closed",
  }, { liveOnly: false, now }), false);
  assert.equal(gameVisibleOnBoard({
    is_live: true,
    commence_time: "2026-09-14T17:00:00Z",
    status: "closed",
  }, { liveOnly: true, now }), false);
  assert.equal(gameVisibleOnBoard({
    is_live: false,
    commence_time: fixtureCommence({ date: "2026-09-14T17:00:00Z" }),
  }, { liveOnly: false, now }), false);
  assert.equal(gameVisibleOnBoard({
    is_live: false,
    commence_time: fixtureCommence({ date: "2026-09-15T00:15:00Z" }),
    status: "scheduled",
  }, { liveOnly: false, now }), true);

  const snap = gamesFromBetstampSnapshot({
    nowMs: now,
    fixtures: [
      {
        id: "sun-final",
        league: "NFL",
        date: "2026-09-14T17:00:00Z",
        status: "closed",
        away_team: { name: "Bills", abbreviation: "BUF" },
        home_team: { name: "Jets", abbreviation: "NYJ" },
      },
      {
        id: "mnf",
        league: "NFL",
        date: "2026-09-15T00:15:00Z",
        status: "scheduled",
        away_team: { name: "Denver Broncos", abbreviation: "DEN" },
        home_team: { name: "Kansas City Chiefs", abbreviation: "KC" },
      },
    ],
    markets: [
      { odds: 1.91, side: "BUF", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: "sun-final" },
      { odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: "mnf" },
    ],
    teams: [],
  });
  assert.equal(gameIsFinished({ status: "closed", commence_time: "2026-09-15T00:15:00Z" }, now), true);
  assert.equal(gameIsFinished({ is_live: false, commence_time: "2026-09-14T17:00:00Z" }, now), true);
  assert.equal(gameIsFinished({ is_live: true, commence_time: "2026-09-14T17:00:00Z" }, now), false);
  const sunday = snap.find((g) => g.id === "sun-final");
  const upcoming = snap.find((g) => g.id === "mnf");
  assert.equal(sunday, undefined, "closed Sunday fixtures are dropped from the slate");
  assert.equal(upcoming.commence_time, "2026-09-15T00:15:00Z");
  assert.equal(gameVisibleOnBoard(upcoming, { liveOnly: false, now }), true);
}

{
  const games = gamesFromBetstampSnapshot({
    markets: [{
      odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
      is_alt: false, odd_provider_id: 200, fixture_id: "fix-1",
    }],
    fixtures: [{
      id: "fix-1",
      league: "NFL",
      start_date: "2026-09-20T17:00:00Z",
      home_team: { name: "Bills", abbreviation: "BUF" },
      away_team: { name: "Jets", abbreviation: "NYJ" },
    }],
    teams: [],
  });
  const { games: next, applied } = applyStreamMarkets(games, [{
    odds: 2.20, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
    is_alt: false, is_live: true, odd_provider_id: 200, fixture_id: "fix-1",
    updated_at: "2026-09-14T20:00:00.000Z",
  }], { receivedAt: Date.parse("2026-09-14T20:00:00.400Z") });
  assert.equal(next[0].bookOdds.draftkings.ml_away, 120);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].bookKey, "draftkings");
  assert.equal(lineUpdatedAt(next[0], "draftkings", "ml_away"), Date.parse("2026-09-14T20:00:00.000Z"));
}

{
  assert.equal(formatCompactAge(1000, 1380), "380ms");
  assert.equal(formatCompactAge(1000, 13_000), "12s");
  assert.equal(formatCompactAge(1000, 61_000), "1m");
  assert.equal(formatCompactAge(null, 1000), null);
  assert.equal(lineFieldFor("moneyline", "away"), "ml_away");
  assert.equal(lineFieldFor("total", "over"), "tot_over");
  assert.deepEqual(cellLineFields("spr"), { top: "spr_away", bot: "spr_home" });
  assert.equal(marketUpdatedAtMs({ updated_at: "2026-09-14T20:00:00.000Z" }, 1), Date.parse("2026-09-14T20:00:00.000Z"));
  assert.equal(marketUpdatedAtMs({}, 42), 42);
}

{
  const tDk = Date.parse("2026-09-14T20:00:10.000Z");
  const tFd = Date.parse("2026-09-14T20:00:10.400Z");
  const games = gamesFromBetstampSnapshot({
    nowMs: tDk,
    markets: [
      {
        odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 200, fixture_id: "fix-age",
        updated_at: "2026-09-14T20:00:10.000Z",
      },
      {
        odds: 1.95, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 100, fixture_id: "fix-age",
        updated_at: "2026-09-14T20:00:10.400Z",
      },
      {
        odds: 1.80, side: "KC", side_type: "Home", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 200, fixture_id: "fix-age",
        updated_at: "2026-09-14T19:59:00.000Z",
      },
    ],
    fixtures: [{
      id: "fix-age",
      league: "NFL",
      start_date: "2026-09-20T17:00:00Z",
      home_team: { name: "Chiefs", abbreviation: "KC" },
      away_team: { name: "Broncos", abbreviation: "DEN" },
    }],
    teams: [],
  });
  const g = games[0];
  assert.equal(lineUpdatedAt(g, "draftkings", "ml_away"), tDk);
  assert.equal(lineUpdatedAt(g, "fanduel", "ml_away"), tFd);
  assert.equal(lineUpdatedAt(g, "draftkings", "ml_home"), Date.parse("2026-09-14T19:59:00.000Z"));
  // FanDuel -105 beats DK -110, so best away uses FD's newer tick.
  const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const best = getOddsBoardCell({ game: g, bookKey: "best", market: "ml", selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS });
  assert.equal(best.top, -105);
  assert.equal(bestLineUpdatedAt(g, "ml_away", best.topBooks), tFd);
}

{
  // Live Best Odds uses the same per-line bookLineUpdatedAt clock: a 4+ minute
  // stale number cannot win, but the book cell still keeps its price + age.
  const now = Date.parse("2026-09-14T20:10:00.000Z");
  const games = gamesFromBetstampSnapshot({
    nowMs: now,
    markets: [
      {
        odds: 2.20, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, is_live: true, odd_provider_id: 200, fixture_id: "fix-stale-best",
        updated_at: "2026-09-14T20:05:00.000Z",
      },
      {
        odds: 2.05, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, is_live: true, odd_provider_id: 100, fixture_id: "fix-stale-best",
        updated_at: "2026-09-14T20:09:50.000Z",
      },
    ],
    fixtures: [{
      id: "fix-stale-best",
      league: "NFL",
      is_live: true,
      start_date: "2026-09-14T18:00:00Z",
      home_team: { name: "Chiefs", abbreviation: "KC" },
      away_team: { name: "Broncos", abbreviation: "DEN" },
    }],
    teams: [],
  });
  const g = games[0];
  assert.equal(g.is_live, true);
  assert.equal(g.bookOdds.draftkings.ml_away, 120);
  assert.equal(g.bookOdds.fanduel.ml_away, 105);
  const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const liveOpts = { nowMs: now, maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS };
  const best = getOddsBoardCell({
    game: g, bookKey: "best", market: "ml",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, ...liveOpts,
  });
  assert.equal(best.top, 105);
  assert.equal(best.topBooks[0].key, "fanduel");
  const dk = getOddsBoardCell({
    game: g, bookKey: "draftkings", market: "ml",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, ...liveOpts,
  });
  assert.equal(dk.top, 120);
  assert.equal(lineUpdatedAt(g, "draftkings", "ml_away"), Date.parse("2026-09-14T20:05:00.000Z"));
}

{
  const games = gamesFromBetstampSnapshot({
    markets: [
      {
        odds: 0.4, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 194, fixture_id: "fix-pm",
      },
      {
        odds: 1.50, side: "KC", side_type: "Home", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 193, fixture_id: "fix-pm",
      },
      {
        odds: 2.10, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 191, fixture_id: "fix-pm",
      },
    ],
    fixtures: [{
      id: "fix-pm",
      league: "NFL",
      start_date: "2026-09-20T17:00:00Z",
      home_team: { name: "Chiefs", abbreviation: "KC" },
      away_team: { name: "Broncos", abbreviation: "DEN" },
    }],
    teams: [],
  });
  const g = games[0];
  assert.equal(g.bookOdds.kalshi.ml_away, 150);
  assert.equal(g.bookOdds.polymarket.ml_home, -200);
  assert.equal(g.bookOdds.prophetx.ml_away, 110);
  assert.equal(formatWinProb(g.bookOdds.kalshi.ml_away), "40.0%");
  assert.equal(formatWinProb(g.bookOdds.polymarket.ml_home), "66.7%");
  assert.equal(formatWinProb(g.bookOdds.prophetx.ml_away), "47.6%");
}

{
  assert.deepEqual(unwrapStreamPayload({ ingest_ts: 9, payload: { odds: 1.9, bet_type: "Moneyline", fixture_id: "a" } }).markets.length, 1);
  assert.equal(unwrapStreamPayload({ ingest_ts: 9, payload: { odds: 1.9, bet_type: "Moneyline", fixture_id: "a" } }).ingestTs, 9);
  assert.equal(unwrapStreamPayload({ markets: [{ odds: 1 }] }).markets.length, 1);
}

{
  assert.equal(quantile([100, 200, 300, 400], 0.5), 250);
  assert.equal(quantile([], 0.5), null);
  let stats = emptyTickStats();
  stats = recordTicks(stats, [{ bookKey: "draftkings", label: "DEN ML", price: -110 }], { receivedAt: 1000 });
  stats = recordTicks(stats, [{ bookKey: "fanduel", label: "DEN ML", price: -108, eventTime: 1380 }], { receivedAt: 1400 });
  stats = recordTicks(stats, [{ bookKey: "draftkings", label: "KC ML", price: 105 }], { receivedAt: 1800 });
  const sum = summarizeTickStats(stats, 1900);
  assert.equal(sum.eventCount, 3);
  assert.equal(sum.lastTickAgeMs, 100);
  assert.equal(sum.p50InterArrivalMs, 400);
  assert.equal(sum.perBook.draftkings.lastAt, 1800);
}

{
  const { events, rest } = parseSseChunk("data: {\"a\":1}\n\ndata: {\"b\":2}\n\npartial");
  assert.equal(events.length, 2);
  assert.equal(events[0].data.a, 1);
  assert.equal(rest, "partial");
  assert.equal(nextBackoffMs(0), 250);
  assert.equal(nextBackoffMs(2), 1000);
  assert.equal(nextBackoffMs(10), 8000);
  assert.match(betstampSnapshotUrl({ league: "NFL", live: true }), /league=NFL/);
  assert.match(betstampSnapshotUrl({ league: "NFL", live: true }), /is_live=true/);
  assert.doesNotMatch(betstampSnapshotUrl({ league: "NFL", live: true }), /include_alts|fixture_id/);
  assert.match(betstampSnapshotUrl({ league: "NFL", includeAlts: true, fixtureId: "fix-1" }), /include_alts=true/);
  assert.match(betstampSnapshotUrl({ league: "NFL", includeAlts: true, fixtureId: "fix-1" }), /fixture_id=fix-1/);
  assert.match(betstampStreamUrl({ league: "NCAAF", live: false }), /is_live=false/);
  assert.ok(BETSTAMP_PREGAME_POLL_MS >= 15_000 && BETSTAMP_PREGAME_POLL_MS <= 30_000);
}

{
  assert.equal(isMainMarket({ bet_type: "Moneyline", period: "FT", is_alt: false }), true);
  assert.equal(isMainMarket({ bet_type: "Spread", period: "FT", is_alt: true }), false);
  assert.equal(isBoardMarket({ bet_type: "Spread", period: "FT", is_alt: true }), true);
  assert.equal(isMainMarket({ bet_type: "Spread", period: "1Q", is_alt: false }), false);
  assert.equal(marketSide({ side_type: "Away" }, null), "away");
  assert.equal(marketSide({ side: "Over" }, null), "over");
}

{
  const fixtureId = "fix-alts";
  const game = {
    id: fixtureId,
    sport: "americanfootball_nfl",
    league: "NFL",
    away: "Broncos",
    home: "Chiefs",
    awayAbbr: "DEN",
    homeAbbr: "KC",
    commence_time: "2026-09-20T17:00:00Z",
    is_live: false,
  };
  const markets = [
    { odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: fixtureId },
    { odds: 1.95, side: "KC", side_type: "Home", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: fixtureId },
    { odds: 2.05, number: -3.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 100, fixture_id: fixtureId },
    { odds: 1.80, number: 3.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 100, fixture_id: fixtureId },
    { odds: 1.50, number: -7.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 200, fixture_id: fixtureId },
    { odds: 2.80, number: 7.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 200, fixture_id: fixtureId },
    { odds: 1.91, number: 44.5, side: "Over", side_type: "Over", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 250, fixture_id: fixtureId },
    { odds: 1.91, number: 44.5, side: "Under", side_type: "Under", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 250, fixture_id: fixtureId },
    { odds: 1.67, number: 48.5, side: "Over", side_type: "Over", bet_type: "Total", period: "FT", is_alt: true, odd_provider_id: 194, fixture_id: fixtureId },
    { odds: 2.20, number: 48.5, side: "Under", side_type: "Under", bet_type: "Total", period: "FT", is_alt: true, odd_provider_id: 194, fixture_id: fixtureId },
    { odds: 1.40, number: -10.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 200, fixture_id: "other-game" },
  ];
  assert.equal(spreadAwayLine(markets[2], game), -3.5);
  assert.equal(spreadAwayLine(markets[3], game), -3.5);
  const ladders = fixtureAltLadders({ markets, game, nowMs: 1 });
  assert.equal(ladders.moneyline.isMain, true);
  assert.equal(ladders.moneyline.game.bookOdds.draftkings.ml_away, -110);
  assert.deepEqual(ladders.spreads.map((r) => r.line), [-7.5, -3.5]);
  assert.equal(ladders.spreads.find((r) => r.line === -3.5).isMain, true);
  assert.equal(ladders.spreads.find((r) => r.line === -7.5).isMain, false);
  assert.equal(ladders.spreads.find((r) => r.line === -7.5).game.bookOdds.draftkings.spr_away, -200);
  assert.deepEqual(ladders.totals.map((r) => r.line), [44.5, 48.5]);
  assert.equal(ladders.totals.find((r) => r.line === 48.5).game.bookOdds.kalshi.tot_over, -149);
  assert.equal(formatWinProb(ladders.totals.find((r) => r.line === 48.5).game.bookOdds.kalshi.tot_over), "59.8%");
  assert.equal(ladders.spreads.some((r) => r.line === -10.5), false, "other fixture alts stay out");
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const board = fs.readFileSync(path.join(dir, "OddsBoard.jsx"), "utf8");
  const stamp = fs.readFileSync(path.join(dir, "BetstampOddsBoard.jsx"), "utf8");
  const envEx = fs.readFileSync(path.join(dir, "..", ".env.example"), "utf8");
  const vercel = fs.readFileSync(path.join(dir, "..", "vercel.json"), "utf8");
  assert.match(app, /import OddsBoard from "\.\/OddsBoard\.jsx"/);
  assert.match(app, /import BetstampOddsBoard from "\.\/BetstampOddsBoard\.jsx"/);
  assert.match(app, /activeTab === "odds" && <OddsBoard/);
  assert.match(app, /activeTab === "oddsBetstamp" && canSeeOwnerTools\(user\)/);
  assert.match(app, /<BetstampOddsBoard/);
  assert.match(app, /onNavTabClick\("oddsBetstamp"/);
  assert.match(app, /href=\{tabHash\("oddsBetstamp"\)\}/);
  assert.match(app, />New Odds Board<\/a>/);
  assert.doesNotMatch(app, />New Odds Board<\/button>/);
  assert.doesNotMatch(app, />Betstamp<\/button>/);
  assert.match(board, /\[boardSport, setBoardSport\] = useState\("baseball_mlb"\)/);
  assert.match(stamp, />New Odds Board</);
  assert.doesNotMatch(stamp, />Betstamp Odds Board</);
  assert.match(stamp, /data-tick-metrics/);
  assert.match(stamp, /BETSTAMP_PREGAME_POLL_MS/);
  assert.match(stamp, /setInterval\(\(\) => \{/);
  assert.match(stamp, /if \(!liveOnly\) \{\s*pollTimer = setInterval/s);
  assert.match(stamp, /clearInterval\(pollTimer\)/);
  assert.match(stamp, /data-snapshot-age/);
  assert.match(stamp, /\[liveOnly, setLiveOnly\] = useState\(false\)/);
  assert.doesNotMatch(stamp, /setLiveOnly\(\s*true\s*\)/);
  assert.doesNotMatch(stamp, /data-mnf-focus|focusMnf|is_mnf|Monday Night Football/);
  assert.doesNotMatch(board, /BETSTAMP_PREGAME_POLL_MS|data-snapshot-age/);
  assert.match(stamp, /data-line-age/);
  assert.match(stamp, /bestLineUpdatedAt/);
  assert.match(stamp, /LIVE_BEST_ODDS_MAX_AGE_MS/);
  assert.match(stamp, /maxBestAgeMs/);
  assert.match(stamp, /hiddenKeys/);
  assert.match(stamp, /oddsBoardHideKey/);
  assert.match(stamp, /data-hide-odds/);
  assert.match(stamp, /toggleHiddenCell/);
  assert.match(stamp, /useState\(\(\) => new Set\(\)\)/);
  assert.match(stamp, /useState\("single"\)/);
  assert.match(stamp, /data-best-view=\{bestView\}/);
  assert.match(stamp, /data-best-view-toggle/);
  assert.match(stamp, /data-best-view=\{opt\.id\}/);
  assert.match(stamp, /id: "single"/);
  assert.match(stamp, /id: "stacked"/);
  assert.match(stamp, /Top 2 lines/);
  assert.match(stamp, /stackedBest/);
  assert.match(stamp, /data-best-stacks/);
  assert.doesNotMatch(stamp, /location\.hash|serializeAppHash/);
  assert.doesNotMatch(board, /LIVE_BEST_ODDS_MAX_AGE_MS|maxBestAgeMs/);
  assert.doesNotMatch(board, /data-hide-odds|oddsBoardHideKey|hiddenKeys/);
  assert.doesNotMatch(board, /stackedBest|data-best-view|Top 2 lines|data-best-stacks/);
  assert.match(stamp, /data-win-prob/);
  assert.match(stamp, /formatWinProb/);
  assert.match(stamp, /cellShowsWinProb/);
  assert.doesNotMatch(board, /data-line-age|bookLineUpdatedAt|data-win-prob/);
  assert.match(stamp, /\/api\/betstamp-markets/);
  assert.match(stamp, /\/api\/betstamp-stream/);
  assert.match(stamp, /data-alt-drawer/);
  assert.match(stamp, /includeAlts: true/);
  assert.match(stamp, /fixtureAltLadders/);
  assert.doesNotMatch(board, /data-alt-drawer|fixtureAltLadders|includeAlts/);
  assert.doesNotMatch(stamp, /BETSTAMP_API_KEY\s*=/);
  assert.doesNotMatch(app, /BETSTAMP_API_KEY/);
  assert.match(envEx, /BETSTAMP_API_KEY=/);
  assert.doesNotMatch(envEx, /BETSTAMP_API_KEY=\S/);
  assert.match(vercel, /api\/betstamp-stream\.js/);
  assert.doesNotMatch(app, /\/api\/fetch-odds/);
}

console.log("betstampNormalize.test.js ok");
