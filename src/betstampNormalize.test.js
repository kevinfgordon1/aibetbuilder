import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decimalToAmerican,
  toAmericanOdds,
  marketSize,
  gamesFromBetstampSnapshot,
  applyFixtureMeta,
  fixtureLiveMeta,
  applyStreamMarkets,
  reconcileLiveGames,
  liveBoardPaintKey,
  marketIsOffered,
  marketIsOtB,
  marketIsExplicitlySuspended,
  marketHasOfferableOdds,
  quoteLastSeenMs,
  fixtureIdsFromMarkets,
  quoteOfferKey,
  quotePresenceKey,
  listedBoardQuotes,
  lineIsSuspended,
  lineConfirmedAt,
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
  compactAgeTone,
  staleLiveBookLabels,
  formatWinProb,
  cellShowsWinProb,
  lineFieldFor,
  cellLineFields,
  lineUpdatedAt,
  bestLineUpdatedAt,
  marketUpdatedAtMs,
  applyMarketToGame,
  marketIsLiveQuote,
} from "./betstampNormalize.js";
import { isPmWinProbBook, BETSTAMP_TRIAL_BOOKS, BETSTAMP_BOOK_IDS, BETSTAMP_PUBLIC_BOOK_IDS, visibleBetstampBooks } from "./betstampBooks.js";
import { parseSseChunk, nextBackoffMs, betstampSnapshotUrl, betstampStreamUrl, BETSTAMP_PREGAME_POLL_MS, BETSTAMP_LIVE_RECONCILE_MS, BETSTAMP_RECONCILE_CLEAR_GRACE_MS } from "./betstampLive.js";
import { getOddsBoardCell, LIVE_BEST_ODDS_MAX_AGE_MS, oddsBoardHideKey } from "./oddsBoard.js";

assert.deepEqual(BETSTAMP_BOOK_IDS, [100, 200, 300, 250, 613, 642, 150, 365, 191, 193, 194, 196]);
assert.deepEqual(BETSTAMP_PUBLIC_BOOK_IDS, [100, 200, 300, 250, 613, 642, 150, 365, 191, 193, 194]);
assert.equal(BETSTAMP_TRIAL_BOOKS.length, 12);
assert.equal(visibleBetstampBooks(null).some((b) => b.key === "underdog_predict"), false);
assert.equal(visibleBetstampBooks({ email: "kev120909@gmail.com" }).some((b) => b.key === "underdog_predict"), true);
assert.equal(BETSTAMP_TRIAL_BOOKS.find((b) => b.id === 196)?.key, "underdog_predict");
assert.equal(BETSTAMP_TRIAL_BOOKS.find((b) => b.id === 196)?.label, "Underdog Predict");
assert.equal(BETSTAMP_TRIAL_BOOKS.find((b) => b.id === 196)?.exchange, true);
assert.ok(!/fanatics|crypto/i.test(BETSTAMP_TRIAL_BOOKS.find((b) => b.id === 196)?.label || ""));

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
  assert.equal(isPmWinProbBook("underdog_predict"), true);
  assert.equal(isPmWinProbBook("draftkings"), false);
  assert.equal(cellShowsWinProb("kalshi"), true);
  assert.equal(cellShowsWinProb("underdog_predict"), true);
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
    { id: "9", odds: 2.00, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 196, fixture_id: fixtureId, team_id: den.id },
    { id: "10", odds: 1.91, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", league: "NFL", is_alt: false, is_live: true, odd_provider_id: 196, fixture_id: fixtureId, team_id: kc.id },
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
  assert.equal(g.bookOdds.underdog_predict.ml_away, 100);
  assert.equal(g.bookOdds.underdog_predict.ml_home, -110);
  assert.notEqual(g.bookOdds.underdog_predict.ml_away, -107, "New Odds Board stays raw Betstamp sticker");

  const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const udp = getOddsBoardCell({ game: g, bookKey: "underdog_predict", market: "ml", selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS });
  assert.equal(udp.top, 100);
  assert.equal(cellShowsWinProb("underdog_predict"), true);
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
  assert.equal(sprStackedHide.topStacks.length, 1, "home +3.5 still keeps the 3.5 point after hiding away");
  assert.equal(sprStackedHide.topStacks[0].price, null);
  assert.equal(sprStackedHide.botStacks[0].line, 3.5);
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
  const halfMeta = fixtureLiveMeta({ status: "Halftime", live: { period: "HT" } });
  assert.equal(halfMeta.status, "Halftime");
  assert.equal(halfMeta.period, "HT");
  const same = [{ id: "den-kc", status: "live", period: "2Q", is_live: true }];
  assert.equal(applyFixtureMeta(same, [{ id: "den-kc", status: "live", period: "2Q", is_live: true }]), same);
  const patched = applyFixtureMeta(same, [{ id: "den-kc", status: "halftime", period: "HT", is_live: true }]);
  assert.notEqual(patched, same);
  assert.equal(patched[0].status, "halftime");
  assert.equal(patched[0].period, "HT");
  const snapHalf = gamesFromBetstampSnapshot({
    nowMs: Date.parse("2026-09-14T20:00:00Z"),
    markets: [],
    fixtures: [{
      id: "fix-ht",
      league: "NFL",
      is_live: true,
      status: "halftime",
      start_date: "2026-09-14T18:00:00Z",
      home_team: { name: "Chiefs", abbreviation: "KC" },
      away_team: { name: "Broncos", abbreviation: "DEN" },
    }],
    teams: [],
  });
  assert.equal(snapHalf[0].status, "halftime");
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
      start_date: "2026-12-20T17:00:00Z",
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
  assert.equal(formatCompactAge(1000, 46_000), "45s");
  assert.equal(formatCompactAge(1000, 61_000), "1m00s");
  assert.equal(formatCompactAge(0, 90_000), "1m30s");
  assert.equal(formatCompactAge(0, 119_000), "1m59s");
  assert.equal(formatCompactAge(0, 120_000), "2m");
  assert.equal(formatCompactAge(0, 180_000), "3m");
  assert.equal(formatCompactAge(null, 1000), null);
  assert.equal(compactAgeTone(0, 30_000), "#6b7280");
  assert.equal(compactAgeTone(0, 90_000), "#ca8a04");
  assert.equal(compactAgeTone(0, 120_000), "#f59e0b");
  assert.equal(compactAgeTone(0, 300_000), "#f59e0b");
  {
    const staleBooks = staleLiveBookLabels(
      [{
        is_live: true,
        bookLineUpdatedAt: {
          fanduel: { ml_away: 0 },
          pinnacle: { ml_away: 298_000 },
        },
      }],
      [
        { key: "fanduel", label: "FanDuel" },
        { key: "pinnacle", label: "Pinnacle" },
      ],
      300_000,
    );
    assert.deepEqual(staleBooks.map((b) => b.key), ["fanduel"]);
    assert.equal(staleBooks[0].age, "5m");
  }
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
  // Live Best Odds uses the same per-line bookLineUpdatedAt clock: a 60s+
  // stale number cannot win while moving, but the book cell still keeps its price + age.
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
      start_date: "2026-12-20T17:00:00Z",
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
  assert.match(betstampSnapshotUrl({ league: "NFL", live: true }), /refresh=1/);
  assert.doesNotMatch(betstampSnapshotUrl({ league: "NFL", live: false }), /refresh=/);
  assert.doesNotMatch(betstampSnapshotUrl({ league: "NFL", live: true }), /include_alts|fixture_id/);
  assert.match(betstampSnapshotUrl({ league: "NFL", includeAlts: true, fixtureId: "fix-1" }), /include_alts=true/);
  assert.match(betstampSnapshotUrl({ league: "NFL", includeAlts: true, fixtureId: "fix-1" }), /fixture_id=fix-1/);
  assert.match(betstampSnapshotUrl({ league: "NFL", bookIds: [642] }), /book_ids=642/);
  assert.doesNotMatch(betstampSnapshotUrl({ league: "NFL", live: true }), /book_ids/);
  assert.match(betstampStreamUrl({ league: "NCAAF", live: false }), /is_live=false/);
  assert.match(betstampStreamUrl({ league: "NFL", live: true, bookIds: [100, 200, 196] }), /book_ids=100%2C200%2C196/);
  assert.doesNotMatch(betstampStreamUrl({ league: "NFL", live: true }), /book_ids/);
  assert.ok(BETSTAMP_PREGAME_POLL_MS >= 15_000 && BETSTAMP_PREGAME_POLL_MS <= 30_000);
  assert.equal(BETSTAMP_LIVE_RECONCILE_MS, 10_000);
  assert.equal(BETSTAMP_RECONCILE_CLEAR_GRACE_MS, 25_000);
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
  assert.equal(marketIsOffered({ odds: 1.91 }), true);
  assert.equal(marketIsOffered({ odds: 1.91, status: "suspended" }), false);
  assert.equal(marketIsOffered({ odds: 1.91, is_suspended: true }), false);
  assert.equal(marketIsOffered({ odds: 1.91, is_otb: true }), true, "priced is_otb stays offered");
  assert.equal(marketIsOffered({ odds: 1.09, is_otb: true }), true);
  assert.equal(marketIsOffered({ odds: 6.5, otb: true }), true);
  assert.equal(marketIsOffered({ odds: 1.91, off_the_board: true }), true);
  assert.equal(marketIsOffered({ is_otb: true }), false, "OTB with no price is OFF");
  assert.equal(marketIsOffered({ odds: null, is_otb: true }), false);
  assert.equal(marketIsOffered({ odds: 1, is_otb: true }), false, "decimal 1 is not offerable");
  assert.equal(marketIsOffered({ odds: 1.91, active: false }), false);
  assert.equal(marketIsOffered({ odds: 1.91, status: "open" }), true);
  assert.equal(marketIsOtB({ is_otb: true }), true);
  assert.equal(marketIsExplicitlySuspended({ is_otb: true }), false, "is_otb alone is not a suspend");
  assert.equal(marketIsExplicitlySuspended({ is_otb: true, odds: null }), false);
  assert.equal(marketIsExplicitlySuspended({ status: "suspended" }), true);
  assert.equal(marketIsExplicitlySuspended({ is_suspended: true, odds: 1.91 }), true);
  assert.equal(marketIsExplicitlySuspended({ active: false }), true);
  assert.equal(marketHasOfferableOdds({ odds: 1.09 }), true);
  assert.equal(marketHasOfferableOdds({ odds: null }), false);
  assert.equal(marketIsLiveQuote({ is_live: true }), true);
  assert.equal(marketIsLiveQuote({ is_otb: true, is_live: false }), false);
  assert.equal(quotePresenceKey({ fixtureId: "fix-1", bookKey: "draftkings", betType: "Moneyline", side: "away" }), "fix-1|draftkings|moneyline|away");
  assert.equal(quoteOfferKey({ fixtureId: "fix-1", bookKey: "fanduel", betType: "Spread", side: "away", line: -3.5 }), "fix-1|fanduel|spread|away|-3.5");
  assert.equal(quoteOfferKey({ fixtureId: "fix-1", bookKey: "pinnacle", betType: "Total", side: "over", line: 44.5 }), "fix-1|pinnacle|total|over|44.5");

  const now = Date.parse("2026-09-14T20:10:00.000Z");
  const fixture = {
    id: "fix-recon",
    league: "NFL",
    is_live: true,
    start_date: "2026-09-14T18:00:00Z",
    home_team: { name: "Chiefs", abbreviation: "KC" },
    away_team: { name: "Broncos", abbreviation: "DEN" },
  };
  const dkAway = {
    odds: 2.20, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
    is_alt: false, is_live: true, odd_provider_id: 200, fixture_id: "fix-recon",
    updated_at: "2026-09-14T20:05:00.000Z",
  };
  const fdAway = {
    odds: 2.05, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
    is_alt: false, is_live: true, odd_provider_id: 100, fixture_id: "fix-recon",
    updated_at: "2026-09-14T20:09:50.000Z",
  };
  const games = gamesFromBetstampSnapshot({
    nowMs: now,
    markets: [dkAway, fdAway],
    fixtures: [fixture],
    teams: [],
  });
  assert.equal(games[0].bookOdds.draftkings.ml_away, 120);
  assert.equal(games[0].bookOdds.fanduel.ml_away, 105);
  assert.equal(listedBoardQuotes(games[0]).length, 2);

  // Same-stamp snapshot must not clobber a held SSE/REST print. Confirm only.
  const confirmed = reconcileLiveGames(games, {
    nowMs: now + 16_000,
    fixtures: [fixture],
    markets: [
      { ...dkAway, odds: 2.10 },
      fdAway,
    ],
  });
  assert.equal(confirmed[0].bookOdds.draftkings.ml_away, 120, "same-stamp snapshot keeps held price");
  assert.equal(confirmed[0].bookOdds.fanduel.ml_away, 105);
  assert.equal(lineIsSuspended(confirmed[0], "draftkings", "ml_away"), false);
  assert.equal(lineConfirmedAt(confirmed[0], "draftkings", "ml_away"), now + 16_000);
  assert.equal(lineUpdatedAt(confirmed[0], "draftkings", "ml_away"), Date.parse("2026-09-14T20:05:00.000Z"));

  // Newer Betstamp stamp on a quiet soft book must move the cell (and age).
  const moved = reconcileLiveGames(games, {
    nowMs: now + 16_000,
    fixtures: [fixture],
    markets: [
      { ...dkAway, odds: 2.30, updated_at: "2026-09-14T20:10:10.000Z" },
      fdAway,
    ],
  });
  assert.equal(moved[0].bookOdds.draftkings.ml_away, 130, "newer REST stamp updates a quiet book");
  assert.equal(lineUpdatedAt(moved[0], "draftkings", "ml_away"), Date.parse("2026-09-14T20:10:10.000Z"));
  assert.equal(moved[0].bookOdds.fanduel.ml_away, 105);

  // One thin snap inside last-seen grace must not yank a quiet book (the spasm).
  const heldThin = reconcileLiveGames(confirmed, {
    nowMs: now + 20_000,
    fixtures: [fixture],
    markets: [fdAway],
  });
  assert.equal(heldThin[0].bookOdds.draftkings.ml_away, 120, "miss inside last-seen grace keeps held print");
  assert.equal(lineIsSuspended(heldThin[0], "draftkings", "ml_away"), false);
  assert.equal(quoteLastSeenMs(heldThin[0], "draftkings", "ml_away"), now + 16_000);

  // Missing past last-seen grace: clear the zombie, mark OFF, exclude from Best.
  const cleared = reconcileLiveGames(confirmed, {
    nowMs: now + 42_000,
    fixtures: [fixture],
    markets: [fdAway],
  });
  assert.equal(cleared[0].bookOdds.draftkings.ml_away, null, "absent quote is cleared");
  assert.equal(cleared[0].bookOdds.fanduel.ml_away, 105);
  assert.equal(lineIsSuspended(cleared[0], "draftkings", "ml_away"), true);
  assert.equal(lineUpdatedAt(cleared[0], "draftkings", "ml_away"), null);
  const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
  const liveOpts = { nowMs: now + 42_000, maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS };
  const bestAfterClear = getOddsBoardCell({
    game: cleared[0], bookKey: "best", market: "ml",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, ...liveOpts,
  });
  assert.equal(bestAfterClear.top, 105);
  assert.equal(bestAfterClear.topBooks[0].key, "fanduel");
  const dkAfterClear = getOddsBoardCell({
    game: cleared[0], bookKey: "draftkings", market: "ml",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, ...liveOpts,
  });
  assert.equal(dkAfterClear.top, null);

  // SSE tick after clear restores the cell and drops the suspended flag.
  const { games: restored, applied } = applyStreamMarkets(cleared, [{
    ...dkAway,
    odds: 2.30,
    updated_at: "2026-09-14T20:10:20.000Z",
  }], { receivedAt: Date.parse("2026-09-14T20:10:20.400Z") });
  assert.equal(applied.length, 1);
  assert.equal(restored[0].bookOdds.draftkings.ml_away, 130);
  assert.equal(lineIsSuspended(restored[0], "draftkings", "ml_away"), false);
  const bestAfterRestore = getOddsBoardCell({
    game: restored[0], bookKey: "best", market: "ml",
    selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS,
    nowMs: Date.parse("2026-09-14T20:10:20.400Z"), maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS,
  });
  assert.equal(bestAfterRestore.top, 130);

  // Explicit suspended status on a listed market is not offered.
  const statusSuspended = reconcileLiveGames(games, {
    nowMs: now + 40_000,
    fixtures: [fixture],
    markets: [{ ...dkAway, status: "suspended" }, fdAway],
  });
  assert.equal(statusSuspended[0].bookOdds.draftkings.ml_away, null);
  assert.equal(lineIsSuspended(statusSuspended[0], "draftkings", "ml_away"), true);
  assert.equal(statusSuspended[0].bookOdds.fanduel.ml_away, 105);

  // SSE tombstone with status=suspended also clears immediately.
  const { games: sseOff } = applyStreamMarkets(games, [{
    ...dkAway,
    status: "suspended",
  }], { receivedAt: now + 1_000 });
  assert.equal(sseOff[0].bookOdds.draftkings.ml_away, null);
  assert.equal(lineIsSuspended(sseOff[0], "draftkings", "ml_away"), true);

  // Houston @ Texas Tech: live book 196 print must beat a leftover pregame OTB
  // row and a stale earlier live tick (board was stuck at +129 while Betstamp
  // already had 2.73 / +173).
  {
    const hou = { id: "hou", name: "Houston", abbreviation: "HOU" };
    const ttu = { id: "ttu", name: "Texas Tech", abbreviation: "TTU" };
    const liveFix = {
      id: "hou-ttu-live",
      league: "NCAAF",
      is_live: true,
      start_date: "2026-09-19T00:00:00Z",
      home_team: ttu,
      away_team: hou,
    };
    const udpLive = {
      odds: 2.73,
      side: "HOU",
      side_type: "Away",
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      is_live: true,
      odd_provider_id: 196,
      fixture_id: "hou-ttu-live",
      team_id: hou.id,
      updated_at: "2026-09-19T02:10:25.000Z",
    };
    const udpPregameOtb = {
      odds: 3.52,
      side: "HOU",
      side_type: "Away",
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      is_live: false,
      is_otb: true,
      odd_provider_id: 196,
      fixture_id: "hou-ttu-live",
      team_id: hou.id,
      updated_at: "2026-09-18T23:00:00.000Z",
    };
    const mixed = gamesFromBetstampSnapshot({
      markets: [udpPregameOtb, udpLive],
      fixtures: [liveFix],
      teams: [hou, ttu],
      nowMs: Date.parse("2026-09-19T02:10:50.000Z"),
    });
    assert.equal(mixed[0].bookOdds.underdog_predict.ml_away, 173);
    assert.equal(lineIsSuspended(mixed[0], "underdog_predict", "ml_away"), false);

    const staleLive = applyMarketToGame(mixed[0], {
      ...udpLive,
      odds: 2.29,
      updated_at: "2026-09-19T02:08:00.000Z",
    }, { receivedAt: Date.parse("2026-09-19T02:10:50.000Z") });
    assert.equal(staleLive, false, "older live tick must not replace 2.73");
    assert.equal(mixed[0].bookOdds.underdog_predict.ml_away, 173);

    const otbAfter = applyMarketToGame(mixed[0], udpPregameOtb, { receivedAt: Date.parse("2026-09-19T02:11:00.000Z") });
    assert.equal(otbAfter, false, "pregame OTB must not clear the live Underdog cell");
    assert.equal(mixed[0].bookOdds.underdog_predict.ml_away, 173);
    assert.equal(lineIsSuspended(mixed[0], "underdog_predict", "ml_away"), false);

    const nextTick = applyMarketToGame(mixed[0], {
      ...udpLive,
      odds: 2.80,
      updated_at: "2026-09-19T02:11:10.000Z",
    }, { receivedAt: Date.parse("2026-09-19T02:11:10.400Z") });
    assert.equal(nextTick.price, 180);
    assert.equal(mixed[0].bookOdds.underdog_predict.ml_away, 180);
  }

  // Miami (FL) @ Wake Forest live spread: soft books still send a finite
  // decimal with is_otb=true. Board must show the quote, not OFF.
  {
    const mia = { id: "mia", name: "Miami (FL)", abbreviation: "MIA" };
    const wake = { id: "wake", name: "Wake Forest", abbreviation: "WF" };
    const fixtureId = "019e5010-311f-7e7f-80be-57054c43185e";
    const liveFix = {
      id: fixtureId,
      league: "NCAAF",
      is_live: true,
      status: "inprogress",
      start_date: "2026-09-19T03:00:00Z",
      home_team: wake,
      away_team: mia,
      home_score: 20,
      away_score: 33,
    };
    const spreadSide = (providerId, sideType, number, odds, otb) => ({
      odds,
      number,
      side: sideType === "Away" ? "MIA" : "WF",
      side_type: sideType,
      bet_type: "Spread",
      period: "FT",
      is_alt: false,
      is_live: true,
      is_otb: otb,
      odd_provider_id: providerId,
      fixture_id: fixtureId,
      updated_at: "2026-09-19T03:03:00.000Z",
    });
    const softIds = [100, 200, 300, 250, 613, 150, 365, 191, 193];
    const markets = [];
    for (const id of softIds) {
      markets.push(spreadSide(id, "Away", -12.5, 1.09, true));
      markets.push(spreadSide(id, "Home", 12.5, 6.5, true));
    }
    markets.push(spreadSide(194, "Away", -12.5, 1.20, false));
    markets.push(spreadSide(194, "Home", 12.5, 5.0, false));
    markets.push(spreadSide(196, "Away", -12.5, 1.25, false));
    markets.push(spreadSide(196, "Home", 12.5, 4.5, false));

    const now = Date.parse("2026-09-19T03:03:10.000Z");
    const games = gamesFromBetstampSnapshot({
      markets,
      fixtures: [liveFix],
      teams: [mia, wake],
      nowMs: now,
    });
    assert.equal(games.length, 1);
    const g = games[0];
    const selected = new Set(BETSTAMP_TRIAL_BOOKS.map((b) => b.key));
    const liveOpts = { nowMs: now, maxBestAgeMs: LIVE_BEST_ODDS_MAX_AGE_MS };
    const softKeys = [
      "fanduel", "draftkings", "williamhill_us", "pinnacle", "betonlineag",
      "circa", "bet365", "prophetx", "polymarket",
    ];
    for (const key of softKeys) {
      assert.equal(g.bookOdds[key].spr_away, decimalToAmerican(1.09), `${key} away priced`);
      assert.equal(g.bookOdds[key].spr_home, decimalToAmerican(6.5), `${key} home priced`);
      assert.equal(g.bookOdds[key].spr_away_line, -12.5);
      assert.equal(lineIsSuspended(g, key, "spr_away"), false, `${key} is_otb+price is not OFF`);
      const cell = getOddsBoardCell({
        game: g, bookKey: key, market: "spr",
        selectedBookKeys: selected, allBooks: BETSTAMP_TRIAL_BOOKS, ...liveOpts,
      });
      assert.equal(cell.top, decimalToAmerican(1.09));
      assert.equal(cell.bot, decimalToAmerican(6.5));
    }
    assert.equal(g.bookOdds.kalshi.spr_away, decimalToAmerican(1.20));
    assert.equal(g.bookOdds.underdog_predict.spr_away, decimalToAmerican(1.25));
    assert.equal(lineIsSuspended(g, "kalshi", "spr_away"), false);
    assert.equal(lineIsSuspended(g, "underdog_predict", "spr_away"), false);

    const held = reconcileLiveGames(games, {
      nowMs: now + 16_000,
      fixtures: [liveFix],
      markets,
    });
    assert.equal(held[0].bookOdds.fanduel.spr_away, decimalToAmerican(1.09));
    assert.equal(lineIsSuspended(held[0], "fanduel", "spr_away"), false);
    assert.equal(lineIsSuspended(held[0], "draftkings", "spr_home"), false);

    const fdAway = markets.find((m) => m.odd_provider_id === 100 && m.side_type === "Away");
    const { games: sseOtb } = applyStreamMarkets(games, [{
      ...fdAway,
      odds: 1.11,
      is_otb: true,
      updated_at: "2026-09-19T03:03:20.000Z",
    }], { receivedAt: Date.parse("2026-09-19T03:03:20.400Z") });
    assert.equal(sseOtb[0].bookOdds.fanduel.spr_away, decimalToAmerican(1.11));
    assert.equal(lineIsSuspended(sseOtb[0], "fanduel", "spr_away"), false);

    const { games: nullOff } = applyStreamMarkets(games, [{
      ...fdAway,
      odds: null,
      is_otb: true,
    }], { receivedAt: now + 1_000 });
    assert.equal(nullOff[0].bookOdds.fanduel.spr_away, decimalToAmerican(1.09), "live unpriced is_otb does not yank a held print");
    assert.equal(lineIsSuspended(nullOff[0], "fanduel", "spr_away"), false);

    const { games: susOff } = applyStreamMarkets(games, [{
      ...fdAway,
      status: "suspended",
    }], { receivedAt: now + 1_000 });
    assert.equal(susOff[0].bookOdds.fanduel.spr_away, null);
    assert.equal(lineIsSuspended(susOff[0], "fanduel", "spr_away"), true);
  }

  // markets == null / [] must not wipe the board (failed/incomplete payload).
  const noop = reconcileLiveGames(games, { nowMs: now + 50_000, markets: null });
  assert.equal(noop[0].bookOdds.draftkings.ml_away, 120);
  const emptyList = reconcileLiveGames(games, { nowMs: now + 50_000, markets: [] });
  assert.equal(emptyList, games, "empty markets list is a same-ref no-op");
  assert.equal(emptyList[0].bookOdds.draftkings.ml_away, 120);

  // Fixture the snap never mentioned is incomplete, not a mass OFF.
  assert.deepEqual([...fixtureIdsFromMarkets([{ ...fdAway, fixture_id: "other-live" }])], ["other-live"]);
  const omitted = reconcileLiveGames(games, {
    nowMs: now + 80_000,
    fixtures: [fixture],
    markets: [{ ...fdAway, fixture_id: "other-live" }],
  });
  const omittedHeld = omitted.find((g) => g.id === "fix-recon");
  assert.equal(omittedHeld.bookOdds.draftkings.ml_away, 120, "unmentioned live fixture keeps held quotes");
  assert.equal(omittedHeld.bookOdds.fanduel.ml_away, 105);
  assert.equal(lineIsSuspended(omittedHeld, "draftkings", "ml_away"), false);

  // Quiet book's Betstamp updated_at is minutes old; last-seen grace still holds.
  assert.equal(quoteLastSeenMs(games[0], "draftkings", "ml_away"), now);
  const stalePrint = reconcileLiveGames(games, {
    nowMs: now + 10_000,
    fixtures: [fixture],
    markets: [fdAway],
  });
  assert.equal(stalePrint[0].bookOdds.draftkings.ml_away, 120, "stale updated_at does not expire last-seen grace");
  assert.equal(lineIsSuspended(stalePrint[0], "draftkings", "ml_away"), false);

  // Oscillating live is_otb ticks must not flap the cell OFF/ON.
  let flapping = games;
  for (let i = 0; i < 6; i++) {
    const { games: next } = applyStreamMarkets(flapping, [{
      ...dkAway,
      odds: i % 2 ? null : 2.20,
      is_otb: true,
      updated_at: new Date(now + i * 400).toISOString(),
    }], { receivedAt: now + i * 400 });
    flapping = next;
    assert.equal(flapping[0].bookOdds.draftkings.ml_away, 120, `otb flap ${i} keeps held ML`);
    assert.equal(lineIsSuspended(flapping[0], "draftkings", "ml_away"), false);
  }

  const { games: noStub } = applyStreamMarkets(games, [{
    ...dkAway,
    fixture_id: "ghost-fix",
    is_live: true,
  }], { receivedAt: now, allowNewGames: false });
  assert.equal(noStub.some((g) => String(g.id) === "ghost-fix"), false, "live board does not inject stub rows");

  const paintA = liveBoardPaintKey(games);
  const agedOnly = applyStreamMarkets(games, [{
    ...dkAway,
    odds: 2.20,
    updated_at: "2026-09-14T20:10:30.000Z",
  }], { receivedAt: now + 30_000 }).games;
  assert.equal(agedOnly[0].bookOdds.draftkings.ml_away, 120);
  assert.equal(liveBoardPaintKey(agedOnly), paintA, "same American + line must not rebuild the grid");
  const movedPrice = applyStreamMarkets(games, [{
    ...dkAway,
    odds: 2.30,
    updated_at: "2026-09-14T20:10:40.000Z",
  }], { receivedAt: now + 40_000 }).games;
  assert.notEqual(liveBoardPaintKey(movedPrice), paintA, "real American move must paint");

  // Pregame rebuild drops a book that disappeared from the snapshot.
  const pregameFix = {
    id: "fix-pre",
    league: "NFL",
    start_date: "2026-12-20T17:00:00Z",
    home_team: { name: "Chiefs", abbreviation: "KC" },
    away_team: { name: "Broncos", abbreviation: "DEN" },
  };
  const firstPregame = gamesFromBetstampSnapshot({
    markets: [
      { odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: "fix-pre" },
      { odds: 1.95, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 100, fixture_id: "fix-pre" },
    ],
    fixtures: [pregameFix],
    teams: [],
  });
  assert.equal(firstPregame[0].bookOdds.draftkings.ml_away, -110);
  const secondPregame = gamesFromBetstampSnapshot({
    markets: [
      { odds: 1.95, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 100, fixture_id: "fix-pre" },
    ],
    fixtures: [pregameFix],
    teams: [],
  });
  assert.equal(secondPregame[0].bookOdds.draftkings.ml_away, null, "pregame re-poll drops disappeared books");
  assert.equal(secondPregame[0].bookOdds.fanduel.ml_away, -105);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const board = fs.readFileSync(path.join(dir, "OddsBoard.jsx"), "utf8");
  const stamp = fs.readFileSync(path.join(dir, "BetstampOddsBoard.jsx"), "utf8");
  const liveSrc = fs.readFileSync(path.join(dir, "betstampLive.js"), "utf8");
  const envEx = fs.readFileSync(path.join(dir, "..", ".env.example"), "utf8");
  const vercel = fs.readFileSync(path.join(dir, "..", "vercel.json"), "utf8");
  assert.match(app, /import OddsBoard from "\.\/OddsBoard\.jsx"/);
  assert.match(app, /import BetstampOddsBoard from "\.\/BetstampOddsBoard\.jsx"/);
  assert.match(app, /activeTab === "odds" && <OddsBoard/);
  assert.match(app, /activeTab === "oddsBetstamp" && canSeeNewOddsBoard\(user\)/);
  assert.match(app, /<BetstampOddsBoard user=\{user\}/);
  assert.match(stamp, /visibleBetstampBooks/);
  assert.match(stamp, /bookIds/);
  assert.match(app, /onNavTabClick\("oddsBetstamp"/);
  assert.match(app, /href=\{tabHash\("oddsBetstamp"\)\}/);
  assert.match(app, />New Odds Board<\/a>/);
  assert.doesNotMatch(app, />New Odds Board<\/button>/);
  assert.doesNotMatch(app, />Betstamp<\/button>/);
  assert.match(board, /\[boardSport, setBoardSport\] = useState\("baseball_mlb"\)/);
  assert.match(stamp, />New Odds Board</);
  assert.doesNotMatch(stamp, />Betstamp Odds Board</);
  assert.match(stamp, /oddsBoardOrder\.js/);
  assert.match(stamp, /data-drag-game/);
  assert.match(stamp, /data-drag-book/);
  assert.match(stamp, /data-row-density="compact"/);
  assert.match(stamp, /data-col-layout="fixed"/);
  assert.match(stamp, /tableLayout: "fixed"/);
  assert.match(stamp, /maxWidth: tableWidth/);
  assert.match(stamp, /obbTableWidth/);
  assert.match(stamp, /padBestPointStacks/);
  assert.match(stamp, /obb-clip/);
  assert.match(stamp, /textOverflow: "ellipsis"/);
  assert.match(stamp, /data-side-h/);
  assert.doesNotMatch(stamp, /minWidth: teamColWidth \+ visibleBooks\.length \* oddsColWidth/);
  assert.match(stamp, /padding: "3px 4px"/);
  assert.match(stamp, /padding: "4px 10px 2px"/);
  assert.doesNotMatch(stamp, /padding: "7px 5px"/);
  assert.doesNotMatch(stamp, /padding: "8px 16px 4px"/);
  assert.match(stamp, /fontSize: 13/);
  assert.match(stamp, /data-tick-metrics/);
  assert.match(stamp, /BETSTAMP_PREGAME_POLL_MS/);
  assert.match(stamp, /BETSTAMP_LIVE_RECONCILE_MS/);
  assert.match(stamp, /reconcileLiveGames/);
  assert.match(stamp, /data-odds-suspended/);
  assert.match(stamp, /data-odds-off/);
  assert.match(stamp, /obb-off/);
  assert.match(stamp, /Off the board/);
  assert.match(stamp, /OddsFlashNumber/);
  assert.match(stamp, /sameAmericanPrice/);
  assert.match(stamp, /AgeNowContext/);
  assert.match(stamp, /AgeNowContext.Provider/);
  assert.match(stamp, /function AgeNowProvider/);
  assert.match(stamp, /function BestNowProvider/);
  assert.match(stamp, /BestNowContext/);
  assert.match(stamp, /OddsBoardGameRow/);
  assert.match(stamp, /OddsBoardBookCells/);
  assert.match(stamp, /boardShowsPointLine/);
  assert.match(stamp, /includeLine: boardShowsPointLine\(market\)/);
  assert.match(stamp, /includeLine: includeLine \?\? boardShowsPointLine\(marketKey\)/);
  assert.match(stamp, /data-odds-line=\{line\}/);
  assert.match(stamp, /Alt rows already show the point in the first column/);
  assert.match(stamp, /includeLine: false/);
  assert.doesNotMatch(stamp, /includeLine: includeLine \?\? \(marketKey === "ml"\)/);
  assert.doesNotMatch(stamp, /includeLine: marketKey === "ml"/);
  assert.match(stamp, /data-live-clock="isolated"/);
  assert.match(stamp, /data-game-paint/);
  assert.match(stamp, /memo\(function OddsFlashNumber/);
  assert.match(stamp, /memo\(function OddsSide/);
  assert.match(stamp, /obb-flash-up/);
  assert.match(stamp, /obb-flash-down/);
  assert.match(stamp, /BestBookName/);
  assert.match(stamp, /data-book-full-name/);
  assert.doesNotMatch(stamp, /function BookMark/);
  assert.doesNotMatch(stamp, /bookInitials/);
  assert.match(stamp, /data-live-reconcile-ms/);
  assert.match(stamp, /no longer lists/);
  assert.match(stamp, /unpriced is_otb tick does not yank/);
  assert.match(stamp, /priced is_otb quote still shows/);
  assert.match(stamp, /allowNewGames: false/);
  assert.match(stamp, /bookIdsKey/);
  assert.match(stamp, /key=\{block\.dateKey\}/);
  assert.match(stamp, /LiveTickStrip/);
  assert.match(stamp, /commitGames/);
  assert.match(stamp, /liveBoardPaintKey/);
  assert.match(stamp, /registerTickSink/);
  assert.match(stamp, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  assert.match(stamp, /setInterval\(\(\) => setAgeNowMs\(Math\.floor\(Date\.now\(\) \/ 1000\) \* 1000\), 1000\)/);
  assert.match(stamp, /if \(liveOnly\) return undefined/);
  assert.match(stamp, /15_000/);
  assert.match(stamp, /Same-price ticks, age-only heartbeats/);
  assert.match(stamp, /isolated 1s age clock/);
  assert.doesNotMatch(stamp, /block\.games\[0\]\?\.id/);
  assert.match(liveSrc, /bookLineConfirmedAt/);
  assert.match(liveSrc, /VITE_BETSTAMP_RECONCILE_CLEAR_GRACE_MS/);
  assert.match(envEx, /VITE_BETSTAMP_RECONCILE_CLEAR_GRACE_MS=/);
  assert.doesNotMatch(envEx, /VITE_BETSTAMP_RECONCILE_CLEAR_GRACE_MS=\d/);
  assert.match(stamp, /setInterval\(\(\) => \{/);
  assert.match(stamp, /if \(!liveOnly\) \{\s*pollTimer = setInterval/s);
  assert.match(stamp, /clearInterval\(pollTimer\)/);
  assert.match(stamp, /data-snapshot-age/);
  assert.match(stamp, /\[liveOnly, setLiveOnly\] = useState\(false\)/);
  assert.doesNotMatch(stamp, /setLiveOnly\(\s*true\s*\)/);
  assert.doesNotMatch(stamp, /data-mnf-focus|focusMnf|is_mnf|Monday Night Football/);
  assert.doesNotMatch(board, /BETSTAMP_PREGAME_POLL_MS|BETSTAMP_LIVE_RECONCILE_MS|data-snapshot-age|reconcileLiveGames|data-odds-suspended/);
  assert.match(stamp, /data-line-age/);
  assert.match(stamp, /compactAgeTone/);
  assert.match(stamp, /staleLiveBookLabels/);
  assert.match(stamp, /data-soft-book-stale/);
  assert.match(stamp, /data-board-refresh/);
  assert.match(stamp, /refreshKey/);
  assert.match(app, /refreshKey=\{betstampRefreshKey\}/);
  assert.match(app, /manual_betstamp/);
  assert.match(liveSrc, /p\.set\("refresh", "1"\)/);
  assert.match(liveSrc, /live === true/);
  assert.match(stamp, /bestLineUpdatedAt/);
  assert.match(stamp, /LIVE_BEST_ODDS_MAX_AGE_MS/);
  assert.match(stamp, /LIVE_BEST_ODDS_BREAK_MAX_AGE_MS/);
  assert.match(stamp, /data-live-best-age-ms/);
  assert.match(stamp, /applyFixtureMeta/);
  assert.match(stamp, /60s/);
  assert.match(stamp, /halftime \/ intermission/);
  assert.doesNotMatch(stamp, /4\+ minutes stale/);
  assert.match(stamp, /hiddenKeys/);
  assert.match(stamp, /oddsBoardHideKey/);
  assert.match(stamp, /oddsBoardHideGameKey/);
  assert.match(stamp, /isHiddenOddsGame/);
  assert.match(stamp, /data-hide-odds/);
  assert.match(stamp, /data-hide-game/);
  assert.match(stamp, /data-hidden-games/);
  assert.match(stamp, /data-show-all-games/);
  assert.match(stamp, /opacity: 0;/);
  assert.match(stamp, /@media \(hover: none\) \{\s*\n\s*\.obb-hide \{ opacity: 0\.2;/);
  assert.match(stamp, /toggleHiddenCell/);
  assert.match(stamp, /toggleHiddenGame/);
  assert.match(stamp, /filterHiddenOddsGames/);
  assert.match(stamp, /Hidden matchups are listed above/);
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
  assert.match(stamp, /data-best-point-pairs/);
  assert.match(stamp, /data-best-point=/);
  assert.match(stamp, /pointStacks/);
  assert.doesNotMatch(stamp, /location\.hash|serializeAppHash/);
  assert.doesNotMatch(board, /LIVE_BEST_ODDS_MAX_AGE_MS|maxBestAgeMs/);
  assert.doesNotMatch(board, /data-hide-odds|oddsBoardHideKey|oddsBoardHideGameKey|hiddenKeys|data-hide-game|data-show-all-games/);
  assert.doesNotMatch(board, /stackedBest|data-best-view|Top 2 lines|data-best-stacks|data-best-point-pairs|pointStacks/);
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
  assert.match(envEx, /BETSTAMP_TIMEDELTA=/);
  assert.doesNotMatch(envEx, /BETSTAMP_TIMEDELTA=\S/);
  assert.match(envEx, /VITE_UNDERDOG_PREDICT_ALLOWLIST=/);
  assert.match(envEx, /VITE_BETSTAMP_LIVE_RECONCILE_MS=/);
  assert.doesNotMatch(envEx, /VITE_BETSTAMP_LIVE_RECONCILE_MS=\d/);
  assert.match(vercel, /api\/betstamp-stream\.js/);
  assert.doesNotMatch(app, /\/api\/fetch-odds/);
}

console.log("betstampNormalize.test.js ok");
