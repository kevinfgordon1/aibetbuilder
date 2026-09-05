import assert from "node:assert/strict";
import {
  sportFromTicker,
  dateKeyFromGameKey,
  tickerTeamCode,
  parseSpreadLabel,
  parseTotalLabel,
  espnQueryForLeg,
  uniqueEspnQueries,
  legFromKalshiMarket,
  combineLegResults,
  underlyingCopy,
  matchEspnSide,
  findEspnGame,
  legFromEspnGame,
  settleLegs,
  sourceLabel,
} from "./comboLegResult.js";

assert.equal(sportFromTicker("KXNFLGAME-26SEP13ARILAC-ARI", "nfl:26SEP13ARILAC"), "nfl");
assert.equal(sportFromTicker("KXMLBGAME-26SEP032140ATHSEA-ATH"), "mlb");
assert.equal(sportFromTicker("KXNCAAFTOTAL-26SEP05CLEMLSU-50"), "ncaaf");
assert.equal(dateKeyFromGameKey("nfl:26SEP13ARILAC"), "20260913");
assert.equal(dateKeyFromGameKey("mlb:26SEP032140ATHSEA"), "20260903");
assert.equal(tickerTeamCode("KXNFLGAME-26SEP13CLEJAC-JAC"), "JAC");
assert.equal(tickerTeamCode("KXNCAAFSPREAD-26SEP05BAYAUB-AUB8"), "AUB");
assert.deepEqual(parseSpreadLabel("Baylor +7.5"), { team: "Baylor", sign: "+", line: "7.5" });
assert.deepEqual(parseTotalLabel("Over 49.5"), { ou: "over", line: "49.5" });
assert.deepEqual(espnQueryForLeg({
  ticker: "KXNFLGAME-26SEP13ARILAC-ARI",
  gameKey: "nfl:26SEP13ARILAC",
}), { sport: "nfl", date: "20260913" });

{
  const qs = uniqueEspnQueries([{
    legs: [
      { ticker: "KXNFLGAME-26SEP13ARILAC-ARI", gameKey: "nfl:26SEP13ARILAC" },
      { ticker: "KXNFLGAME-26SEP13CLEJAC-JAC", gameKey: "nfl:26SEP13CLEJAC" },
    ],
  }]);
  assert.equal(qs.length, 1);
  assert.deepEqual(qs[0], { sport: "nfl", date: "20260913" });
}

assert.equal(legFromKalshiMarket({ side: "yes" }, { status: "finalized", result: "yes" }).status, "won");
assert.equal(legFromKalshiMarket({ side: "yes" }, { status: "determined", result: "no" }).status, "lost");
assert.equal(legFromKalshiMarket({ side: "no" }, { status: "finalized", result: "no" }).status, "won");
assert.equal(legFromKalshiMarket({ side: "yes" }, { status: "active", result: "" }).status, "pending");
assert.equal(legFromKalshiMarket({ side: "yes" }, { status: "voided", result: "void" }).status, "push");

assert.equal(combineLegResults([{ status: "won" }, { status: "won" }]).outcome, "won");
assert.equal(combineLegResults([{ status: "won" }, { status: "lost" }]).outcome, "lost");
assert.equal(combineLegResults([{ status: "won" }, { status: "pending" }]).outcome, "pending");
assert.equal(combineLegResults([{ status: "won" }, { status: "push" }]).outcome, "push");
assert.equal(underlyingCopy("won").text, "would-have-won");
assert.equal(underlyingCopy("lost").text, "would-have-lost");
assert.equal(underlyingCopy("won", { filled: true }).text, "parlay won");
assert.equal(underlyingCopy("push").text, "push");
assert.equal(sourceLabel("espn"), "ESPN scoreboard");
assert.equal(sourceLabel("kalshi_legs"), "Kalshi legs");

const jaxGame = {
  sport: "nfl",
  date: "20260913",
  home: "Jacksonville Jaguars",
  homeAbbr: "JAX",
  away: "Cleveland Browns",
  awayAbbr: "CLE",
  homeScore: 24,
  awayScore: 10,
  completed: true,
};
const ariGame = {
  sport: "nfl",
  date: "20260913",
  home: "Los Angeles Chargers",
  homeAbbr: "LAC",
  away: "Arizona Cardinals",
  awayAbbr: "ARI",
  homeScore: 17,
  awayScore: 20,
  completed: true,
};

assert.equal(matchEspnSide("JAC", jaxGame, "nfl"), "home");
assert.equal(matchEspnSide("Jacksonville", jaxGame, "nfl"), "home");
assert.equal(matchEspnSide("ARI", ariGame, "nfl"), "away");

const ariLeg = { ticker: "KXNFLGAME-26SEP13ARILAC-ARI", side: "yes", type: "side", label: "Arizona", gameKey: "nfl:26SEP13ARILAC" };
const jaxLeg = { ticker: "KXNFLGAME-26SEP13CLEJAC-JAC", side: "yes", type: "side", label: "Jacksonville", gameKey: "nfl:26SEP13CLEJAC" };

assert.equal(findEspnGame(jaxLeg, [jaxGame, ariGame]).homeAbbr, "JAX");
assert.equal(legFromEspnGame(ariLeg, ariGame).status, "won");
assert.equal(legFromEspnGame(jaxLeg, jaxGame).status, "won");

{
  const settled = settleLegs({
    legs: [ariLeg, jaxLeg],
    kalshiMarkets: {},
    espnGames: [ariGame, jaxGame],
  });
  assert.equal(settled.outcome, "won");
  assert.equal(settled.source, "espn");
}

{
  const lostJax = { ...jaxGame, homeScore: 7, awayScore: 21 };
  const settled = settleLegs({
    legs: [ariLeg, jaxLeg],
    espnGames: [ariGame, lostJax],
  });
  assert.equal(settled.outcome, "lost");
}

{
  const fromKalshi = settleLegs({
    legs: [ariLeg, jaxLeg],
    kalshiMarkets: {
      "KXNFLGAME-26SEP13ARILAC-ARI": { status: "finalized", result: "yes" },
      "KXNFLGAME-26SEP13CLEJAC-JAC": { status: "finalized", result: "no" },
    },
    espnGames: [ariGame, jaxGame],
  });
  assert.equal(fromKalshi.outcome, "lost");
  assert.equal(fromKalshi.source, "kalshi_legs");
}

{
  const spread = settleLegs({
    legs: [{
      ticker: "KXNCAAFSPREAD-26SEP05BAYAUB-AUB8",
      side: "no",
      type: "spread",
      label: "Baylor +7.5",
      gameKey: "ncaaf:26SEP05BAYAUB",
    }],
    espnGames: [{
      sport: "ncaaf",
      date: "20260905",
      home: "Auburn Tigers",
      homeAbbr: "AUB",
      away: "Baylor Bears",
      awayAbbr: "BAY",
      homeScore: 21,
      awayScore: 17,
      completed: true,
    }],
  });
  assert.equal(spread.outcome, "won");
}

{
  const tot = settleLegs({
    legs: [{
      ticker: "KXNCAAFTOTAL-26SEP05CLEMLSU-50",
      side: "yes",
      type: "total",
      label: "Over 49.5",
      gameKey: "ncaaf:26SEP05CLEMLSU",
    }],
    espnGames: [{
      sport: "ncaaf",
      date: "20260905",
      home: "LSU Tigers",
      homeAbbr: "LSU",
      away: "Clemson Tigers",
      awayAbbr: "CLEM",
      homeScore: 28,
      awayScore: 24,
      completed: true,
    }],
  });
  assert.equal(tot.outcome, "won");
}

// Do not invent a result when ESPN has no matching final
{
  const pending = settleLegs({
    legs: [ariLeg, jaxLeg],
    espnGames: [{ ...ariGame, completed: false, homeScore: null, awayScore: null }],
  });
  assert.equal(pending.outcome, "pending");
}

console.log("comboLegResult.test.js ok");
