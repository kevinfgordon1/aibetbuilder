import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sportFromTicker,
  dateKeyFromGameKey,
  tickerTeamCode,
  parseSpreadLabel,
  parseTotalLabel,
  espnQueryForLeg,
  uniqueEspnQueries,
  needsUnderlyingStamp,
  namesMatch,
  gameKeyMatchesEspn,
  legFromKalshiMarket,
  combineLegResults,
  underlyingCopy,
  matchEspnSide,
  findEspnGame,
  legFromEspnGame,
  settleLegs,
  sourceLabel,
  outcomeChrome,
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
assert.equal(underlyingCopy("won").text, "risk won");
assert.equal(underlyingCopy("lost").text, "risk lost");
assert.equal(underlyingCopy("won", { filled: true }).text, "parlay won");
assert.equal(underlyingCopy("lost", { filled: true }).text, "parlay lost");
assert.equal(underlyingCopy("push").text, "push");
assert.equal(sourceLabel("espn"), "ESPN scoreboard");
assert.equal(sourceLabel("kalshi_legs"), "Kalshi legs");
assert.equal(sourceLabel("kalshi_combo"), "Kalshi combo");
assert.equal(sourceLabel("unknown"), null);

{
  const chrome = outcomeChrome({ kind: "underlying", outcome: "won", source: "espn" });
  assert.equal(chrome.text, "risk won");
  assert.equal(chrome.tone, "win");
  assert.equal(chrome.source, "espn");
  assert.equal(chrome.sourceText, "ESPN scoreboard");
  assert.equal(chrome.official, false);
}
{
  const chrome = outcomeChrome({ kind: "underlying", outcome: "lost", source: "kalshi_legs" });
  assert.equal(chrome.text, "risk lost");
  assert.equal(chrome.tone, "lose");
  assert.equal(chrome.sourceText, "Kalshi legs");
}
{
  const chrome = outcomeChrome({ kind: "underlying", outcome: "won", filled: true, source: "espn" });
  assert.equal(chrome.text, "parlay won");
  assert.equal(chrome.tone, "lose");
}
{
  const chrome = outcomeChrome({ kind: "underlying", outcome: "lost" }, { filled: true });
  assert.equal(chrome.text, "parlay lost");
  assert.equal(chrome.tone, "win");
}
{
  const chrome = outcomeChrome({
    kind: "result",
    settlement: { text: "parlay lost (we won)", weWon: true, result: "no" },
  });
  assert.equal(chrome.text, "parlay lost (we won)");
  assert.equal(chrome.tone, "win");
  assert.equal(chrome.source, "kalshi_combo");
  assert.equal(chrome.sourceText, "Kalshi combo");
  assert.equal(chrome.official, true);
}
{
  const chrome = outcomeChrome({
    kind: "result",
    settlement: { text: "parlay won (we lost)", weWon: false, result: "yes" },
  });
  assert.equal(chrome.text, "parlay won (we lost)");
  assert.equal(chrome.tone, "lose");
  assert.equal(chrome.sourceText, "Kalshi combo");
}
{
  const push = outcomeChrome({ kind: "underlying", outcome: "push", source: "espn" });
  assert.equal(push.text, "push");
  assert.equal(push.tone, "wait");
  assert.equal(push.sourceText, "ESPN scoreboard");
}
{
  const pending = outcomeChrome({ kind: "pending" });
  assert.equal(pending.text, "pending");
  assert.equal(pending.sourceText, null);
}
{
  const awaiting = outcomeChrome({ kind: "awaiting", ticker: "KXMVE-WAIT" });
  assert.equal(awaiting.text, "awaiting settlement");
  assert.equal(awaiting.sourceText, null);
}
assert.equal(outcomeChrome({ kind: "none" }), null);
assert.equal(outcomeChrome(null), null);

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

assert.equal(needsUnderlyingStamp({
  kalshi_result: null,
  underlying_result: null,
  legs: [{}, {}],
}), true);
assert.equal(needsUnderlyingStamp({
  kalshi_result: "no",
  underlying_result: null,
  legs: [{}, {}],
}), false);
assert.equal(needsUnderlyingStamp({
  kalshi_result: null,
  underlying_result: "lost",
  legs: [{}, {}],
}), false);
assert.equal(needsUnderlyingStamp({ combo_ticker: null, legs: [{}] }), false);

assert.equal(namesMatch("Missouri St.", "Missouri State Bears"), true);
assert.equal(namesMatch("New Mexico St.", "New Mexico State Aggies"), true);
assert.equal(namesMatch("St. Louis", "St. Louis Cardinals"), true);
assert.equal(namesMatch("St. Louis", "Missouri State Bears"), false);

// Production NCAAF blanks (2026-09-05). Scores from ESPN scoreboard, not invented.
const hawaiiMl = {
  ticker: "KXNCAAFGAME-26SEP05UNLVHAW-HAW",
  side: "yes",
  type: "side",
  label: "Hawai'i",
  gameKey: "ncaaf:26SEP05UNLVHAW",
};
const wyomingMl = {
  ticker: "KXNCAAFGAME-26SEP05WYOCSU-WYO",
  side: "yes",
  type: "side",
  label: "Wyoming",
  gameKey: "ncaaf:26SEP05WYOCSU",
};
const clemLsuOver = {
  ticker: "KXNCAAFTOTAL-26SEP05CLEMLSU-50",
  side: "yes",
  type: "total",
  label: "Over 49.5",
  gameKey: "ncaaf:26SEP05CLEMLSU",
};
const baylorSpread = {
  ticker: "KXNCAAFSPREAD-26SEP05BAYAUB-AUB8",
  side: "no",
  type: "spread",
  label: "Baylor +7.5",
  gameKey: "ncaaf:26SEP05BAYAUB",
};
const mercyhurstSpread = {
  ticker: "KXNCAAFSPREAD-26SEP05MHUNMSU-NMSU29",
  side: "no",
  type: "spread",
  label: "Mercyhurst +28.5",
  gameKey: "ncaaf:26SEP05MHUNMSU",
};
const missouriStSpread = {
  ticker: "KXNCAAFSPREAD-26SEP05MOSUTXAM-TXAM42",
  side: "no",
  type: "spread",
  label: "Missouri St. +41.5",
  gameKey: "ncaaf:26SEP05MOSUTXAM",
};

const espnSep5 = [
  {
    sport: "ncaaf",
    date: "20260905",
    home: "Hawai'i Rainbow Warriors",
    homeAbbr: "HAW",
    away: "UNLV Rebels",
    awayAbbr: "UNLV",
    homeScore: 6,
    awayScore: 21,
    completed: true,
  },
  {
    sport: "ncaaf",
    date: "20260905",
    home: "Colorado State Rams",
    homeAbbr: "CSU",
    away: "Wyoming Cowboys",
    awayAbbr: "WYO",
    homeScore: 35,
    awayScore: 13,
    completed: true,
  },
  {
    sport: "ncaaf",
    date: "20260905",
    home: "LSU Tigers",
    homeAbbr: "LSU",
    away: "Clemson Tigers",
    awayAbbr: "CLEM",
    homeScore: 51,
    awayScore: 10,
    completed: true,
  },
  {
    sport: "ncaaf",
    date: "20260905",
    home: "Auburn Tigers",
    homeAbbr: "AUB",
    away: "Baylor Bears",
    awayAbbr: "BAY",
    homeScore: 17,
    awayScore: 16,
    completed: true,
  },
  {
    sport: "ncaaf",
    date: "20260905",
    home: "New Mexico State Aggies",
    homeAbbr: "NMSU",
    away: "Mercyhurst Lakers",
    awayAbbr: "MERC",
    homeScore: 51,
    awayScore: 14,
    completed: true,
  },
  {
    sport: "ncaaf",
    date: "20260905",
    home: "Texas A&M Aggies",
    homeAbbr: "TA&M",
    away: "Missouri State Bears",
    awayAbbr: "MOST",
    homeScore: 50,
    awayScore: 0,
    completed: true,
  },
];

assert.equal(gameKeyMatchesEspn("ncaaf:26SEP05MOSUTXAM", espnSep5[5], "ncaaf", missouriStSpread.ticker), true);
assert.equal(gameKeyMatchesEspn("ncaaf:26SEP05MHUNMSU", espnSep5[4], "ncaaf", mercyhurstSpread.ticker), true);
assert.equal(findEspnGame(missouriStSpread, espnSep5).homeAbbr, "TA&M");
assert.equal(findEspnGame(mercyhurstSpread, espnSep5).awayAbbr, "MERC");
assert.equal(matchEspnSide("Missouri St.", espnSep5[5], "ncaaf"), "away");
assert.equal(matchEspnSide("TXAM", espnSep5[5], "ncaaf"), "home");

{
  const fromKalshi = settleLegs({
    legs: [hawaiiMl, wyomingMl, clemLsuOver],
    kalshiMarkets: {
      "KXNCAAFGAME-26SEP05UNLVHAW-HAW": { status: "finalized", result: "no" },
      "KXNCAAFGAME-26SEP05WYOCSU-WYO": { status: "finalized", result: "no" },
      "KXNCAAFTOTAL-26SEP05CLEMLSU-50": { status: "finalized", result: "yes" },
    },
  });
  assert.equal(fromKalshi.outcome, "lost");
  assert.equal(fromKalshi.source, "kalshi_legs");
}

{
  const fromKalshi = settleLegs({
    legs: [baylorSpread, mercyhurstSpread, missouriStSpread],
    kalshiMarkets: {
      "KXNCAAFSPREAD-26SEP05BAYAUB-AUB8": { status: "finalized", result: "no" },
      "KXNCAAFSPREAD-26SEP05MHUNMSU-NMSU29": { status: "finalized", result: "yes" },
      "KXNCAAFSPREAD-26SEP05MOSUTXAM-TXAM42": { status: "finalized", result: "yes" },
    },
  });
  assert.equal(fromKalshi.outcome, "lost");
  assert.equal(fromKalshi.source, "kalshi_legs");
  assert.equal(fromKalshi.legs[0].status, "won");
  assert.equal(fromKalshi.legs[1].status, "lost");
  assert.equal(fromKalshi.legs[2].status, "lost");
}

{
  const fromEspn = settleLegs({
    legs: [hawaiiMl, wyomingMl, clemLsuOver],
    espnGames: espnSep5,
  });
  assert.equal(fromEspn.outcome, "lost");
  assert.equal(fromEspn.source, "espn");
}

{
  const fromEspn = settleLegs({
    legs: [baylorSpread, mercyhurstSpread, missouriStSpread],
    espnGames: espnSep5,
  });
  assert.equal(fromEspn.outcome, "lost");
  assert.equal(fromEspn.source, "espn");
  assert.equal(fromEspn.legs[0].status, "won");
  assert.equal(fromEspn.legs[1].status, "lost");
  assert.equal(fromEspn.legs[2].status, "lost");
}

{
  const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  assert.match(locksSrc, /outcomeChrome/);
  assert.match(locksSrc, /chip src/);
  assert.match(locksSrc, /StatementBoard/);
  assert.match(locksSrc, /className="hist-head"/);
  assert.match(locksSrc, /Hide history" : "History"/);
  assert.match(locksSrc, /Show lock detail/);
  assert.doesNotMatch(locksSrc, /History \+ profile/);
  assert.equal((locksSrc.match(/onToggle=\{\(\) => toggleOpen\("hist-" \+ p\.id\)\}/g) || []).length, 2);
  assert.match(locksSrc, /<AttemptHistory attempts=\{attemptsByParlay\[a\.id\]\} showSummary=\{false\} \/>/);
  const tapeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboTape.jsx"), "utf8");
  assert.doesNotMatch(tapeSrc, /outcomeChrome|arch-head|hist-head/);
}

console.log("comboLegResult.test.js ok");

// NHL: Kalshi ticker/gameKey → sport, ESPN query, UTA/UTAH, and OT/shootout scoring.
{
  assert.equal(sportFromTicker("KXNHLGAME-26SEP30PITPHI-PIT"), "nhl");
  assert.equal(sportFromTicker("", "nhl:26SEP30PITPHI"), "nhl");
  assert.deepEqual(espnQueryForLeg({ ticker: "KXNHLTOTAL-26SEP30PITPHI-7", gameKey: "nhl:26SEP30PITPHI" }), { sport: "nhl", date: "20260930" });
  const pitPhi = { sport: "nhl", date: "20260930", home: "Philadelphia Flyers", homeAbbr: "PHI", away: "Pittsburgh Penguins", awayAbbr: "PIT", homeScore: 4, awayScore: 3, completed: true };
  const utaChi = { sport: "nhl", date: "20261001", home: "Utah Mammoth", homeAbbr: "UTAH", away: "Chicago Blackhawks", awayAbbr: "CHI", homeScore: 2, awayScore: 1, completed: true };
  const total = (n, ou) => ({ ticker: "KXNHLTOTAL-26SEP30PITPHI-7", gameKey: "nhl:26SEP30PITPHI", side: ou === "over" ? "yes" : "no", type: "total", label: `${ou === "over" ? "Over" : "Under"} ${n}` });
  // 4-3 (OT or not): 7 goals → Over 6.5 wins, Under 6.5 loses; ESPN's final score already includes OT/SO.
  assert.equal(legFromEspnGame(total("6.5", "over"), pitPhi).status, "won");
  assert.equal(legFromEspnGame(total("6.5", "under"), pitPhi).status, "lost");
  const puck = (team, sign, side, ticker) => ({ ticker, gameKey: "nhl:26SEP30PITPHI", side, type: "spread", label: `${team} ${sign}1.5` });
  // Pittsburgh lost by 1: +1.5 wins, Philadelphia −1.5 loses (Kalshi "wins by over 1.5").
  assert.equal(legFromEspnGame(puck("Pittsburgh", "+", "no", "KXNHLSPREAD-26SEP30PITPHI-PHI2"), pitPhi).status, "won");
  assert.equal(legFromEspnGame(puck("Philadelphia", "\u2212", "yes", "KXNHLSPREAD-26SEP30PITPHI-PHI2"), pitPhi).status, "lost");
  // UTA (Kalshi) ↔ UTAH (ESPN) resolves the game and the side.
  const utaLeg = { ticker: "KXNHLGAME-26OCT01CHIUTA-UTA", gameKey: "nhl:26OCT01CHIUTA", side: "yes", type: "side", label: "Utah" };
  assert.equal(findEspnGame(utaLeg, [utaChi]), utaChi);
  assert.equal(legFromEspnGame(utaLeg, utaChi).status, "won");
  assert.equal(matchEspnSide("UTA", utaChi, "nhl"), "home");
  console.log("comboLegResult NHL tests passed");
}

{
  // Player props settle from Kalshi's own market only: never from an ESPN moneyline guess.
  const game = { sport: "mlb", date: "2026-10-03", completed: true, homeAbbr: "LAD", awayAbbr: "ATL", homeScore: 5, awayScore: 3 };
  const propLeg = { ticker: "KXMLBHR-26OCT031600ATLLAD-ATLMOLSON28-1", gameKey: "mlb:26OCT031600ATLLAD", side: "yes", type: "prop", label: "Matt Olson: 1+" };
  assert.deepEqual(legFromEspnGame(propLeg, game), { status: "pending", source: "espn" });
  console.log("comboLegResult player-prop tests passed");
}
