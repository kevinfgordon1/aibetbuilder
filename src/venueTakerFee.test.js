import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { impliedProbToAmerican } from "./blendAskLadder.js";
import { applyStreamMarkets, gamesFromBetstampSnapshot, toAmericanOdds } from "./betstampNormalize.js";
import { gamesFromFreeFeeds } from "./freeFeedBoard.js";
import {
  TAKER_FEE_LEGEND,
  VENUE_TAKER_FEE_RATE,
  effectiveTakerPrice,
  feeInclusiveAmerican,
  orderTakerFeeDollars,
  takerFeePerContract,
  takerFeeRate,
} from "./venueTakerFee.js";

assert.equal(VENUE_TAKER_FEE_RATE.polymarket, 0.07);
assert.equal(VENUE_TAKER_FEE_RATE.kalshi, 0.07);
assert.equal(takerFeeRate("polymarket"), 0.07);
assert.equal(takerFeeRate("kalshi"), 0.07);
assert.equal(takerFeeRate("underdog_predict"), null);
assert.equal(takerFeeRate("novig"), null);

{
  const p = 0.355;
  const contracts = 250;
  const charged = 3.98;
  const implied = charged / (contracts * p * (1 - p));
  assert.ok(Math.abs(implied - 0.0695) < 0.0002, `fill implies ${implied}`);
  assert.equal(orderTakerFeeDollars(contracts, p, 0.0695), 3.98);
  const board = feeInclusiveAmerican(p, VENUE_TAKER_FEE_RATE.polymarket);
  const eff = p + 0.07 * p * (1 - p);
  assert.equal(board.effectivePrice, eff);
  assert.equal(board.rawAmerican, impliedProbToAmerican(p));
  assert.equal(board.american, impliedProbToAmerican(eff));
  assert.notEqual(board.american, board.rawAmerican);
}

{
  // 0.07 × 10 × 0.40 × 0.60 = 0.168 → $0.17. Exact 0.175 → $0.18.
  assert.equal(orderTakerFeeDollars(10, 0.4, VENUE_TAKER_FEE_RATE.kalshi), 0.17);
  assert.equal(orderTakerFeeDollars(10, 0.5, VENUE_TAKER_FEE_RATE.kalshi), 0.18);
  assert.equal(takerFeePerContract(0.5, 0.07), 0.0175);
  assert.equal(effectiveTakerPrice(0.5, 0.07), 0.5175);
}

{
  const games = gamesFromBetstampSnapshot({
    markets: [{
      odds: 0.4,
      side: "Falcons",
      side_type: "Away",
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      odd_provider_id: 194,
      fixture_id: "atl",
    }, {
      odds: 1.5,
      side: "Packers",
      side_type: "Home",
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      odd_provider_id: 193,
      fixture_id: "atl",
    }],
    fixtures: [{
      id: "atl",
      league: "NFL",
      start_date: "2026-09-25T00:15:00Z",
      away_team: { name: "Falcons", abbreviation: "ATL" },
      home_team: { name: "Packers", abbreviation: "GB" },
    }],
    teams: [],
    nowMs: Date.parse("2026-09-24T18:00:00Z"),
  });
  const kalshi = feeInclusiveAmerican(0.4, VENUE_TAKER_FEE_RATE.kalshi);
  assert.equal(games[0].bookOdds.kalshi.ml_away, kalshi.american);
  assert.equal(games[0].bookOdds.kalshi.ml_away_raw, toAmericanOdds(0.4));
  assert.equal(games[0].bookOdds.polymarket.ml_home, -200, "decimal odds are not a contract ask");
  assert.equal(games[0].bookOdds.polymarket.ml_home_raw, undefined);
}

{
  const now = Date.parse("2026-09-22T18:00:00Z");
  const games = gamesFromFreeFeeds({
    league: "NFL",
    polymarket: [{
      book: "polymarket",
      book_id: 193,
      league: "NFL",
      away: "Falcons",
      home: "Packers",
      side: "Falcons",
      bet_type: "moneyline",
      odds: 0.285,
      updated_at: "2026-09-22T17:00:00.000Z",
      token_id: "tok",
    }],
    underdog: {
      ok: true,
      games: [{
        sport: "NFL",
        away: "Atlanta Falcons",
        home: "Green Bay Packers",
        scheduledAt: "2026-09-25T00:15:00Z",
        status: "scheduled",
        lines: [{ name: "Atlanta Falcons", american: 245, market: "h2h" }],
      }],
    },
    nowMs: now,
  });
  const poly = feeInclusiveAmerican(0.285, VENUE_TAKER_FEE_RATE.polymarket);
  assert.equal(games[0].bookOdds.polymarket.ml_away, poly.american);
  assert.equal(games[0].bookOdds.polymarket.ml_away_raw, poly.rawAmerican);
  assert.equal(games[0].bookOdds.underdog_predict.ml_away, 245);
  assert.equal(games[0].bookOdds.underdog_predict.ml_away_raw, undefined);
}

{
  const base = gamesFromBetstampSnapshot({
    markets: [],
    fixtures: [{
      id: "atl",
      league: "NFL",
      start_date: "2026-09-25T00:15:00Z",
      away_team: { name: "Falcons", abbreviation: "ATL" },
      home_team: { name: "Packers", abbreviation: "GB" },
    }],
    teams: [],
    nowMs: Date.parse("2026-09-24T18:00:00Z"),
  });
  const painted = applyStreamMarkets(base, [{
    fixture_id: "atl",
    odd_provider_id: 193,
    bet_type: "Moneyline",
    period: "FT",
    is_alt: false,
    side: "Falcons",
    side_type: "Away",
    odds: 0.69,
    is_live: true,
    updated_at: "2026-09-25T01:00:00.000Z",
  }], {
    receivedAt: Date.parse("2026-09-25T01:00:01.000Z"),
    nowMs: Date.parse("2026-09-24T18:00:00Z"),
  }).games;
  const priced = feeInclusiveAmerican(0.69, 0.07);
  assert.equal(painted[0].bookOdds.polymarket.ml_away, priced.american);
  assert.equal(painted[0].bookOdds.polymarket.ml_away_raw, priced.rawAmerican);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const board = fs.readFileSync(path.join(dir, "BetstampOddsBoard.jsx"), "utf8");
  assert.match(board, /TAKER_FEE_LEGEND/);
  assert.match(board, /data-raw-ask/);
  assert.match(board, /data-fee-legend/);
  assert.equal(TAKER_FEE_LEGEND, "Poly/Kalshi prices include taker fee");
}

console.log("venueTakerFee.test.js ok");
