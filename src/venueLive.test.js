import assert from "node:assert/strict";
import {
  firstPartyPmLiveEnabled,
  firstPartyPmLiveFromEnv,
  polymarketStreamUrl,
  kalshiStreamUrl,
  polymarketBoardUrl,
  kalshiBoardUrl,
  novigStreamUrl,
  fourcastersStreamUrl,
  matchGameForQuote,
  venueQuotesToMarkets,
} from "./venueLive.js";
import { applyStreamMarkets, gamesFromBetstampSnapshot } from "./betstampNormalize.js";

const prevLive = process.env.VITE_FIRST_PARTY_PM_LIVE;
try {
  delete process.env.VITE_FIRST_PARTY_PM_LIVE;
  assert.equal(firstPartyPmLiveEnabled(), true, "unset stays on; =0 is the kill switch");
  process.env.VITE_FIRST_PARTY_PM_LIVE = "1";
  assert.equal(firstPartyPmLiveEnabled(), true);
  process.env.VITE_FIRST_PARTY_PM_LIVE = "0";
  assert.equal(firstPartyPmLiveEnabled(), false, "0 opts out");
  process.env.VITE_FIRST_PARTY_PM_LIVE = "false";
  assert.equal(firstPartyPmLiveEnabled(), false);
} finally {
  if (prevLive == null) delete process.env.VITE_FIRST_PARTY_PM_LIVE;
  else process.env.VITE_FIRST_PARTY_PM_LIVE = prevLive;
}

assert.equal(firstPartyPmLiveFromEnv(undefined), true);
assert.equal(firstPartyPmLiveFromEnv(""), true);
assert.equal(firstPartyPmLiveFromEnv("0"), false);
assert.equal(firstPartyPmLiveFromEnv("false"), false);
assert.equal(firstPartyPmLiveFromEnv("off"), false);
assert.equal(firstPartyPmLiveFromEnv("1"), true);
assert.equal(firstPartyPmLiveFromEnv("true"), true);
const prevRelay = process.env.VITE_ODDS_RELAY_URL;
delete process.env.VITE_ODDS_RELAY_URL;
assert.equal(polymarketStreamUrl({ league: "NFL" }), "/api/polymarket-stream?league=NFL");
assert.equal(kalshiStreamUrl({ league: "MLB" }), "/api/kalshi-stream?league=MLB");
assert.equal(polymarketBoardUrl({ league: "NFL" }), "/api/polymarket-board?league=NFL");
assert.equal(kalshiBoardUrl({ league: "NFL" }), "/api/kalshi-board?league=NFL");
process.env.VITE_ODDS_RELAY_URL = "https://odds.example/";
assert.equal(polymarketStreamUrl({ league: "NFL" }), "https://odds.example/stream?league=NFL&venue=polymarket");
assert.equal(kalshiStreamUrl({ league: "MLB" }), "https://odds.example/stream?league=MLB&venue=kalshi");
assert.equal(polymarketBoardUrl({ league: "NFL" }), "https://odds.example/board?league=NFL&venue=polymarket");
assert.equal(kalshiBoardUrl({ league: "NCAAF" }), "https://odds.example/board?league=NCAAF&venue=kalshi");
assert.equal(novigStreamUrl({ league: "NFL" }), "/api/novig-stream?league=NFL");
if (prevRelay == null) delete process.env.VITE_ODDS_RELAY_URL;
else process.env.VITE_ODDS_RELAY_URL = prevRelay;
assert.equal(novigStreamUrl({ league: "NCAAF" }), "/api/novig-stream?league=NCAAF");
assert.equal(fourcastersStreamUrl({ league: "NFL" }), "/api/4casters-stream?league=NFL");
assert.equal(fourcastersStreamUrl({ league: "MLB" }), "/api/4casters-stream?league=MLB");

const games = gamesFromBetstampSnapshot({
  markets: [{
    odds: 1.91,
    side: "Falcons",
    side_type: "Away",
    bet_type: "Moneyline",
    period: "FT",
    is_alt: false,
    odd_provider_id: 200,
    fixture_id: "atl-gb",
  }],
  fixtures: [{
    id: "atl-gb",
    league: "NFL",
    is_live: true,
    start_date: "2026-09-25T00:15:00Z",
    away_team: { name: "Atlanta Falcons", abbreviation: "ATL" },
    home_team: { name: "Green Bay Packers", abbreviation: "GB" },
  }],
  teams: [],
});

const quote = {
  book: "polymarket",
  book_id: 193,
  league: "NFL",
  away: "Falcons",
  home: "Packers",
  side: "Falcons",
  bet_type: "moneyline",
  odds: 0.285,
  is_live: true,
  updated_at: "2026-09-22T18:00:00.000Z",
};
assert.equal(matchGameForQuote(games, quote).id, "atl-gb");
assert.equal(matchGameForQuote(games, { ...quote, league: "MLB" }), null);
assert.equal(matchGameForQuote([
  ...games,
  { ...games[0], id: "other", away: "Atlanta Falcons", home: "Green Bay Packers", league: "NFL" },
], quote), null, "two fixtures with the same teams are not guessed");

const markets = venueQuotesToMarkets(games, [quote], { liveBoard: true });
assert.equal(markets.length, 1);
assert.equal(markets[0].fixture_id, "atl-gb");
assert.equal(markets[0].odd_provider_id, 193);
assert.equal(markets[0].odds, 0.285);
assert.equal(markets[0].is_live, true);

const painted = applyStreamMarkets(games, markets, {
  receivedAt: Date.parse("2026-09-22T18:00:01.000Z"),
}).games;
assert.equal(painted[0].bookOdds.polymarket.ml_away, 251);
assert.equal(painted[0].bookOdds.draftkings.ml_away, -110);

const kalshiQuote = {
  book: "kalshi",
  book_id: 194,
  league: "NFL",
  away: "Atlanta",
  home: "Green Bay",
  side: "Green Bay",
  bet_type: "moneyline",
  odds: 0.72,
  is_live: false,
  updated_at: "2026-09-22T18:00:02.000Z",
};
const kalshiMarkets = venueQuotesToMarkets(games, [kalshiQuote], { liveBoard: true });
const withKalshi = applyStreamMarkets(painted, kalshiMarkets, {
  receivedAt: Date.parse("2026-09-22T18:00:02.000Z"),
}).games;
assert.equal(withKalshi[0].bookOdds.kalshi.ml_home, -257);

console.log("venueLive.test.js ok");
