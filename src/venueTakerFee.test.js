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
  novigLiveFeeRate,
  novigQuotePrice,
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
// Novig has no static venue rate: only a live take is charged (0.03 default).
assert.equal(takerFeeRate("novig"), null);
assert.equal(takerFeeRate("novig", { live: false }), null);
assert.equal(takerFeeRate("novig", { live: true }), 0.03);
assert.equal(takerFeeRate("novig", { live: true, coefficient: 0.06 }), 0.06);

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
  assert.equal(TAKER_FEE_LEGEND, "Poly/Kalshi prices include taker fee · Novig LIVE prices include live fee");
}

// Novig live taker fee (0.03 × P × (1−P), added on top of the ask).
// Verified against the Novig slip: $100 at ask 0.295 shows Payout $331.96 and
// Trading Fee $2.07; at 0.32 Payout $306.25; at 0.28 Payout $349.59.
{
  const live = (odds, extra = {}) => ({ book: "novig", league: "NFL", bet_type: "moneyline", is_live: true, odds, ...extra });
  const a = novigQuotePrice(live(0.295));
  assert.equal(a.rawAmerican, 239);
  assert.equal(a.american, 232, "+239 ask is +232 all-in");
  assert.ok(Math.abs(100 / a.effectivePrice - 331.96) < 0.01);
  assert.ok(Math.abs((100 / a.effectivePrice) * takerFeePerContract(0.295, 0.03) - 2.07) < 0.005);
  assert.ok(Math.abs(100 / novigQuotePrice(live(0.32)).effectivePrice - 306.25) < 0.01);
  assert.ok(Math.abs(100 / novigQuotePrice(live(0.28)).effectivePrice - 349.59) < 0.01);
  assert.equal(novigQuotePrice(live(0.32)).american, 206);
  assert.equal(novigQuotePrice(live(0.28)).american, 250);
  // Favorite side: ask 0.71 → −245 raw, a touch worse all-in.
  assert.equal(novigQuotePrice(live(0.71)).rawAmerican, -245);
  assert.equal(novigQuotePrice(live(0.71)).american, -252);
  // Pregame and missing/false is_live stay raw, no raw tag.
  const pre = novigQuotePrice(live(0.295, { is_live: false }));
  assert.deepEqual([pre.american, pre.rawAmerican], [239, null]);
  const unk = novigQuotePrice({ book: "novig", odds: 0.295 });
  assert.deepEqual([unk.american, unk.rawAmerican], [239, null]);
  assert.equal(novigLiveFeeRate(live(0.295, { is_live: "true" })), null, "only boolean true counts as live");
  // Coefficient comes from the market: 0.06 NCAAF live lines, default per type.
  assert.equal(novigLiveFeeRate(live(0.5, { fee_coefficient: 0.06 })), 0.06);
  assert.equal(novigLiveFeeRate(live(0.5)), 0.03);
  assert.equal(novigLiveFeeRate(live(0.5, { league: "NCAAF", bet_type: "spread" })), 0.06);
  assert.equal(novigLiveFeeRate(live(0.5, { league: "NCAAF", bet_type: "moneyline" })), 0.03);
  assert.equal(novigLiveFeeRate(live(0.5, { fee_coefficient: 0 })), null);
  assert.equal(novigQuotePrice(live(0.5, { fee_coefficient: 0.06 })).american, -106);
  assert.equal(novigQuotePrice(live(0.5)).american, -103);
  // Derive from american when odds is missing.
  assert.equal(novigQuotePrice({ book: "novig", is_live: true, american: 239 }).american, 232);
  assert.equal(novigQuotePrice({ book: "novig" }).american, null);
}

{
  // Live Novig through the Betstamp-normalized board path vs pregame.
  const mk = (isLive, nowMs = "2026-10-02T00:39:30.000Z") => gamesFromFreeFeeds({
    league: "NFL",
    novig: [{
      book: "novig", book_id: 195, league: "NFL", away: "Pittsburgh Steelers", home: "Cleveland Browns",
      side: "Cleveland Browns", bet_type: "moneyline", odds: 0.295, is_live: isLive,
      start: "2026-10-02T00:15:00.000Z", token_id: "cle", updated_at: "2026-10-02T00:39:00.000Z",
    }],
    nowMs: Date.parse(nowMs),
  });
  const live = mk(true)[0].bookOdds.novig;
  assert.equal(live.ml_home, 232);
  assert.equal(live.ml_home_raw, 239);
  // Pregame: before kickoff, even a stray live flag leaves the row upcoming.
  const pre = mk(false, "2026-10-01T22:00:00.000Z")[0].bookOdds.novig;
  assert.equal(pre.ml_home_raw, undefined);
}

console.log("venueTakerFee.test.js ok");
