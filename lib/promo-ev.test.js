const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  calcParlayEV,
  ourTrueProb,
  dkDecimal,
  evPct,
  passesEvThreshold,
  transformOddsData,
  buildAllLegsForBook,
  findTopParlays,
  mainMarketLegs,
  isWithinDateRange,
  ALL_BOOKS,
  TRUSTED_BOOK_KEYS,
  SPORT_KEYS,
} = require("./promo-ev");

// ── calcParlayEV matches Promo Builder: 3 legs +100, true 0.55, 0% boost, $100
{
  const legs = [
    { dk: 100, bestOpp: -122 }, // ourTrueProb(-122) ≈ 0.5495
    { dk: 100, bestOpp: -122 },
    { dk: 100, bestOpp: -122 },
  ];
  const r = calcParlayEV(legs, 0, 100);
  const p = ourTrueProb(-122);
  const parlayDec = dkDecimal(100) ** 3;
  const combined = p ** 3;
  const boostedProfit = (parlayDec - 1) * 100 * (1 + 0 / 100);
  const ev = (combined * boostedProfit) - ((1 - combined) * 100);
  assert.equal(r.parlayDec, parlayDec);
  assert.equal(r.combinedProb, combined);
  assert.equal(r.boostedProfit, boostedProfit);
  assert.equal(r.ev, ev);
  assert.equal(r.parlayOdds, 700);
}

// ── 0% boost vs 30% boost scales profit only
{
  const legs = [{ dk: -110, bestOpp: 120 }, { dk: 150, bestOpp: -130 }, { dk: -105, bestOpp: 115 }];
  const plain = calcParlayEV(legs, 0, 100);
  const boosted = calcParlayEV(legs, 30, 100);
  assert.ok(Math.abs(boosted.boostedProfit - plain.boostedProfit * 1.3) < 1e-9);
  assert.equal(plain.parlayDec, boosted.parlayDec);
  assert.equal(plain.combinedProb, boosted.combinedProb);
}

// ── EV% threshold: (ev / stake) * 100 > 2  →  +$2 on $100 does NOT alert; +$2.01 does
{
  assert.equal(evPct(2, 100), 2);
  assert.equal(passesEvThreshold(2, 100, 2), false);
  assert.equal(passesEvThreshold(2.01, 100, 2), true);
  assert.equal(passesEvThreshold(1.99, 100, 2), false);
  assert.equal(passesEvThreshold(5, 100, 2), true);
}

// ── Formula strings still present in App.jsx (CJS copy must not drift)
{
  const app = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
  assert.match(app, /const boostedProfit = \(parlayDec - 1\) \* stake \* \(1 \+ boostPct \/ 100\);/);
  assert.match(app, /const ev = \(combinedProb \* boostedProfit\) - \(\(1 - combinedProb\) \* stake\);/);
  assert.match(app, /parlayDec \*= dkDecimal\(l\.dk\);/);
  assert.match(app, /combinedProb \*= ourTrueProb\(l\.bestOpp\);/);
  for (const key of ALL_BOOKS.map(b => b.key)) {
    assert.ok(app.includes(`key: "${key}"`), `App.jsx missing book ${key}`);
  }
  for (const key of TRUSTED_BOOK_KEYS) {
    assert.ok(app.includes(`"${key}"`), `App.jsx missing trusted book ${key}`);
  }
}

// ── transformOddsData + buildAllLegsForBook: DK ML uses best opp from other books
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -120 }, { name: "Red Sox", price: 100 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: -110, point: -1.5 }, { name: "Red Sox", price: -110, point: 1.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -105, point: 8.5 }, { name: "Under", price: -115, point: 8.5 }] },
        ],
      },
      {
        key: "fanduel",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -110 }, { name: "Red Sox", price: 105 }] },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb");
  const dkLegs = buildAllLegsForBook(data, "draftkings");
  const yankeesMl = dkLegs.find(l => l.name === "Yankees ML");
  assert.ok(yankeesMl);
  assert.equal(yankeesMl.dk, -120);
  assert.equal(yankeesMl.bestOpp, 105); // FanDuel home ML is the trusted opp
  assert.equal(yankeesMl.bestOppBook, "fanduel");
  assert.equal(yankeesMl.market, "ML");
  assert.equal(yankeesMl.bookKey, "draftkings");

  const fdLegs = buildAllLegsForBook(data, "fanduel");
  const fdYankees = fdLegs.find(l => l.name === "Yankees ML");
  assert.ok(fdYankees);
  assert.equal(fdYankees.dk, -110);
  assert.equal(fdYankees.bookKey, "fanduel");

  const mains = mainMarketLegs([
    ...dkLegs,
    { name: "Yankees TT o4.5", market: "TT", isAlt: true, dk: -110, bestOpp: 100, game: "x" },
    { name: "Yankees -2.5", market: "SPR", isAlt: true, dk: 120, bestOpp: -110, game: "x" },
  ]);
  assert.ok(mains.every(l => l.market !== "TT" && !l.isAlt));
}

// ── findTopParlays skips same-game parlays
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const legs = [
    { name: "A ML", dk: 100, bestOpp: -110, game: "A @ B", commence_time: future, sport: "baseball_mlb" },
    { name: "A -1.5", dk: 100, bestOpp: -110, game: "A @ B", commence_time: future, sport: "baseball_mlb" },
    { name: "C ML", dk: 100, bestOpp: -110, game: "C @ D", commence_time: future, sport: "baseball_mlb" },
    { name: "E ML", dk: 100, bestOpp: -110, game: "E @ F", commence_time: future, sport: "baseball_mlb" },
  ];
  const top = findTopParlays(legs, 3, 0, 100, 20);
  assert.ok(top.length >= 1);
  for (const p of top) {
    const games = p.legs.map(l => l.game);
    assert.equal(new Set(games).size, 3, "same-game legs must be skipped");
  }
}

// ── isWithinDateRange: Promo Builder "7 Days" is an upper bound from now
{
  const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
  const inEightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(isWithinDateRange(inSixDays, "7d"), true);
  assert.equal(isWithinDateRange(inEightDays, "7d"), false);
  // "7d" itself does not drop already-started games; buildAllLegsForBook does.
  assert.equal(isWithinDateRange(started, "7d"), true);
  assert.equal(isWithinDateRange(inEightDays, "any"), true);
}

// ── buildAllLegsForBook: sportFilter + "7d" drop NFL / far-future / started
{
  const inWindow = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const mk = (away, home, commence_time) => ({
    commence_time,
    away,
    home,
    sport: away.startsWith("NFL") ? "americanfootball_nfl" : "baseball_mlb",
    bookOdds: { draftkings: { ml_away: 110, ml_home: -130 } },
    best_away: 105,
    best_home: -125,
    ml_opp_count_away: 2,
    ml_opp_count_home: 2,
  });
  const data = {
    moneylines: [
      mk("Yankees", "Red Sox", inWindow),
      mk("Cubs", "Brewers", far),
      mk("Dodgers", "Giants", started),
      { ...mk("NFLA", "NFLB", inWindow), sport: "americanfootball_nfl" },
    ],
  };
  const legs = buildAllLegsForBook(data, "draftkings", ["baseball_mlb"], null, "7d");
  assert.ok(legs.some(l => l.name === "Yankees ML"));
  assert.ok(legs.every(l => l.sport === "baseball_mlb"));
  assert.ok(!legs.some(l => l.name.startsWith("Cubs") || l.name.startsWith("Dodgers") || l.name.startsWith("NFL")));
  const allSports = buildAllLegsForBook(data, "draftkings", null, null, "any");
  assert.ok(allSports.some(l => l.sport === "americanfootball_nfl"), "other callers can still scan all sports");
  assert.ok(allSports.some(l => l.name.startsWith("Cubs")), "dateRange any still includes far-future unstarted games");
  assert.ok(!allSports.some(l => l.name.startsWith("Dodgers")), "already-started games are always dropped");
}

assert.ok(SPORT_KEYS.includes("baseball_mlb"));
assert.ok(SPORT_KEYS.includes("americanfootball_nfl"));
assert.ok(SPORT_KEYS.includes("basketball_nba"));

console.log("promo-ev.test.js ok");
