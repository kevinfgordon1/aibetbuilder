import assert from "node:assert/strict";
import {
  DESK_MARKET_TYPES,
  classifyDeskMarket,
  fallbackGameLabel,
  formatDeskGameOption,
  gamesFromLeagueEventsText,
  isFullGameMoneyline,
  moneylineSlugForGame,
  placeScopeError,
  NOT_MONEYLINE_MESSAGE,
  NOT_NFL_MESSAGE,
} from "./liveDeskGames.js";

const NOW = Date.parse("2026-09-24T15:00:00Z");

function moneyline(slug, extra = {}) {
  const parts = slug.split("-");
  return {
    id: "ml-" + slug,
    slug,
    marketType: "moneyline",
    sportsMarketType: "football_team_full_game_winner",
    sportsMarketTypeV2: "SPORTS_MARKET_TYPE_MONEYLINE",
    gameStartTime: "2026-09-25T00:15:00Z",
    marketSides: [
      { long: true, description: "Away", team: { safeName: "ATL Falcons", displayAbbreviation: "ATL", ordering: "away", abbreviation: parts[2] } },
      { long: false, description: "Home", team: { safeName: "GB Packers", displayAbbreviation: "GB", ordering: "home", abbreviation: parts[3] } },
    ],
    ...extra,
  };
}

const league = {
  events: [{
    slug: "nfl-atl-gb-2026-09-24",
    title: "ATL Falcons vs GB Packers",
    startTime: "2026-09-25T00:15:00Z",
    markets: [
      {
        id: "spread",
        slug: "asc-nfl-atl-gb-2026-09-24-pos-3pt5",
        marketType: "spreads",
        sportsMarketType: "football_team_full_game_spread",
        sportsMarketTypeV2: "SPORTS_MARKET_TYPE_SPREAD",
        line: 3.5,
        question: "cover the spread",
      },
      {
        id: "total",
        slug: "tsc-nfl-atl-gb-2026-09-24-47pt5",
        marketType: "totals",
        sportsMarketType: "football_team_full_game_total",
        sportsMarketTypeV2: "SPORTS_MARKET_TYPE_TOTAL",
        line: 47.5,
      },
      {
        id: "half",
        slug: "aec-nfl-atl-gb-2026-09-24-1h",
        marketType: "moneyline",
        sportsMarketType: "football_team_first_half_winner",
        sportsMarketTypeV2: "SPORTS_MARKET_TYPE_MONEYLINE",
        description: "first half winner has a brace } in the text",
      },
      moneyline("aec-nfl-atl-gb-2026-09-24", {
        description: "full game } winner",
      }),
      moneyline("aec-nfl-kc-mia-2026-09-27", {
        sportsMarketType: "football_team_full_game_spread",
        sportsMarketTypeV2: "SPORTS_MARKET_TYPE_SPREAD",
        marketType: "spreads",
        line: 2.5,
        gameStartTime: "2026-09-27T17:00:00Z",
      }),
    ],
  }, {
    slug: "nfl-old-old-2020-01-01",
    markets: [
      moneyline("aec-nfl-old-old-2020-01-01", { gameStartTime: "2020-01-01T18:00:00Z" }),
    ],
  }],
};

{
  assert.deepEqual(DESK_MARKET_TYPES.map((t) => t.id), ["moneyline"]);
  assert.equal(moneylineSlugForGame("nfl-atl-gb-2026-09-24"), "aec-nfl-atl-gb-2026-09-24");
  assert.equal(moneylineSlugForGame("nfl-atl-gb-2026-09-24-1h"), "");
  assert.equal(moneylineSlugForGame("not-a-game"), "");
}

{
  const hit = classifyDeskMarket("aec-nfl-atl-gb-2026-09-24");
  assert.equal(hit.ok, true);
  assert.equal(hit.marketType, "moneyline");
  assert.equal(hit.gameId, "nfl-atl-gb-2026-09-24");
  const spread = classifyDeskMarket("asc-nfl-atl-gb-2026-09-24-pos-3pt5");
  assert.equal(spread.ok, false);
  assert.equal(spread.message, NOT_MONEYLINE_MESSAGE);
  const half = classifyDeskMarket("aec-nfl-atl-gb-2026-09-24-1h");
  assert.equal(half.ok, false);
  assert.equal(half.league, "nfl");
  const other = classifyDeskMarket("aec-nba-lal-bos-2026-09-24");
  assert.equal(other.ok, false);
  assert.equal(other.message, NOT_NFL_MESSAGE);
}

{
  assert.equal(isFullGameMoneyline({
    slug: "asc-nfl-atl-gb-2026-09-24-pos-3pt5",
    marketType: "spreads",
    sportsMarketType: "football_team_full_game_spread",
  }), false);
  assert.equal(isFullGameMoneyline(moneyline("aec-nfl-atl-gb-2026-09-24")), true);
  assert.equal(isFullGameMoneyline(moneyline("aec-nfl-kc-mia-2026-09-27", {
    sportsMarketType: "football_team_full_game_spread",
    marketType: "spreads",
    line: 2.5,
  })), false);
}

{
  const games = gamesFromLeagueEventsText(JSON.stringify(league), NOW);
  assert.equal(games.length, 1, JSON.stringify(games));
  assert.equal(games[0].id, "nfl-atl-gb-2026-09-24");
  assert.equal(games[0].away, "ATL Falcons");
  assert.equal(games[0].home, "GB Packers");
  assert.equal(games[0].markets.length, 1);
  assert.equal(games[0].markets[0].id, "moneyline");
  assert.equal(games[0].markets[0].slug, "aec-nfl-atl-gb-2026-09-24");
  assert.equal(games[0].markets.some((m) => /asc-|tsc-|-1h/.test(m.slug)), false);
  assert.match(games[0].label, /^NFL · ATL Falcons @ GB Packers · Sep 24,/);
  assert.match(games[0].label, /8:15/);
  assert.equal(formatDeskGameOption(games[0]), games[0].label);
  assert.equal(fallbackGameLabel("nfl-atl-gb-2026-09-24"), "NFL · ATL @ GB · 2026-09-24");
}

{
  assert.equal(placeScopeError(
    { gameId: "nfl-atl-gb-2026-09-24" },
    "aec-nfl-lac-ten-2025-11-02",
  ), "That slug is not the moneyline for the selected NFL game.");
  assert.equal(placeScopeError(
    { gameId: "nfl-atl-gb-2026-09-24" },
    "aec-nfl-atl-gb-2026-09-24",
  ), "");
  assert.match(placeScopeError({}, "asc-nfl-atl-gb-2026-09-24-pos-3pt5"), /moneyline/);
  assert.match(placeScopeError({}, "tsc-nfl-atl-gb-2026-09-24-47pt5"), /moneyline/);
  assert.equal(placeScopeError({}, "aec-nfl-lac-ten-2025-11-02", {
    slug: "aec-nfl-lac-ten-2025-11-02",
    marketSides: [],
  }), "");
  assert.match(placeScopeError({}, "aec-nfl-lac-ten-2025-11-02", {
    marketType: "spreads",
    sportsMarketType: "football_team_full_game_spread",
    line: 3.5,
  }), /moneyline/);
}

console.log("liveDeskGames.test.js ok");
