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
  unwrapStreamPayload,
  emptyTickStats,
  recordTicks,
  summarizeTickStats,
  quantile,
  isMainMarket,
  marketSide,
  formatCompactAge,
  lineFieldFor,
  cellLineFields,
  lineUpdatedAt,
  bestLineUpdatedAt,
  marketUpdatedAtMs,
} from "./betstampNormalize.js";
import { isMnfFixture, BETSTAMP_TRIAL_BOOKS, BETSTAMP_BOOK_IDS } from "./betstampBooks.js";
import { parseSseChunk, nextBackoffMs, betstampSnapshotUrl, betstampStreamUrl } from "./betstampLive.js";
import { getOddsBoardCell } from "./oddsBoard.js";

assert.deepEqual(BETSTAMP_BOOK_IDS, [100, 200, 300, 250, 613, 642, 150, 365, 191, 193, 194]);
assert.equal(BETSTAMP_TRIAL_BOOKS.length, 11);

{
  assert.equal(decimalToAmerican(1.91), -110);
  assert.equal(decimalToAmerican(2.10), 110);
  assert.equal(decimalToAmerican(1), null);
  assert.equal(toAmericanOdds(-110), -110);
  assert.equal(toAmericanOdds(150), 150);
  assert.equal(toAmericanOdds(1.5), -200);
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
  assert.equal(g.is_mnf, true);
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
}

{
  assert.equal(isMnfFixture({
    away: "Denver Broncos",
    home: "Kansas City Chiefs",
    awayAbbr: "DEN",
    homeAbbr: "KC",
    commence_time: "2026-09-15T00:20:00Z",
  }), true);
  assert.equal(isMnfFixture({
    away: "Broncos",
    home: "Chiefs",
    commence_time: "2026-12-25T01:00:00Z",
  }), false);
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
  assert.match(betstampStreamUrl({ league: "NCAAF", live: false }), /is_live=false/);
}

{
  assert.equal(isMainMarket({ bet_type: "Moneyline", period: "FT", is_alt: false }), true);
  assert.equal(isMainMarket({ bet_type: "Spread", period: "1Q", is_alt: false }), false);
  assert.equal(marketSide({ side_type: "Away" }, null), "away");
  assert.equal(marketSide({ side: "Over" }, null), "over");
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
  assert.match(app, /setActiveTab\("oddsBetstamp"\)/);
  assert.match(app, />New Odds Board<\/button>/);
  assert.doesNotMatch(app, />Betstamp<\/button>/);
  assert.match(board, /\[boardSport, setBoardSport\] = useState\("baseball_mlb"\)/);
  assert.match(stamp, />New Odds Board</);
  assert.doesNotMatch(stamp, />Betstamp Odds Board</);
  assert.match(stamp, /data-tick-metrics/);
  assert.match(stamp, /data-mnf-focus/);
  assert.match(stamp, /data-line-age/);
  assert.match(stamp, /bestLineUpdatedAt/);
  assert.doesNotMatch(board, /data-line-age|bookLineUpdatedAt/);
  assert.match(stamp, /\/api\/betstamp-markets/);
  assert.match(stamp, /\/api\/betstamp-stream/);
  assert.doesNotMatch(stamp, /BETSTAMP_API_KEY\s*=/);
  assert.doesNotMatch(app, /BETSTAMP_API_KEY/);
  assert.match(envEx, /BETSTAMP_API_KEY=/);
  assert.doesNotMatch(envEx, /BETSTAMP_API_KEY=\S/);
  assert.match(vercel, /api\/betstamp-stream\.js/);
  assert.doesNotMatch(app, /\/api\/fetch-odds/);
}

console.log("betstampNormalize.test.js ok");
