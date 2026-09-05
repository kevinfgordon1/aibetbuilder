const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  calcParlayEV,
  calcFreeBetParlayEV,
  ourTrueProb,
  dkDecimal,
  evPct,
  passesEvThreshold,
  transformOddsData,
  buildAllLegsForBook,
  findTopParlays,
  growParlaysFromTop3,
  passesOddsBounds,
  MAX_PROMO_LEGS,
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

// ── Free-bet EV: no cash at risk, stake not returned. Differs from 0% boost.
{
  const legs = [
    { dk: 100, bestOpp: -122 },
    { dk: 100, bestOpp: -122 },
    { dk: 100, bestOpp: -122 },
  ];
  const fb = calcFreeBetParlayEV(legs, 100);
  const boost0 = calcParlayEV(legs, 0, 100);
  const p = ourTrueProb(-122);
  const parlayDec = dkDecimal(100) ** 3;
  const combined = p ** 3;
  const winProfit = (parlayDec - 1) * 100;
  assert.equal(fb.parlayDec, parlayDec);
  assert.equal(fb.combinedProb, combined);
  assert.equal(fb.winProfit, winProfit);
  assert.equal(fb.ev, combined * winProfit);
  assert.equal(fb.parlayOdds, boost0.parlayOdds);
  assert.equal(fb.parlayDec, boost0.parlayDec);
  // Boost subtracts (1-p)×stake on a loss; free bet loss is $0.
  assert.ok(fb.ev > boost0.ev);
  assert.ok(Math.abs(fb.ev - (boost0.ev + (1 - combined) * 100)) < 1e-9);
  assert.equal(fb.winProfit, boost0.boostedProfit);
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
  const freeBetMod = fs.readFileSync(path.join(__dirname, "../src/promoFreeBet.js"), "utf8");
  assert.match(freeBetMod, /const winProfit = \(parlayDec - 1\) \* freeBetAmount;/);
  assert.match(freeBetMod, /const ev = combinedProb \* winProfit;/);
  assert.match(freeBetMod, /function calcFreeBetParlayEV\(legs, freeBetAmount\)/);
  assert.match(app, /parlayDec \*= dkDecimal\(l\.dk\);/);
  assert.match(app, /combinedProb \*= ourTrueProb\(l\.bestOpp\);/);
  assert.match(app, /const MAX_PROMO_LEGS = 8;/);
  assert.match(app, /function growParlaysFromTop3\(/);
  assert.match(app, /if \(usedGames\.has\(cand\.game\)\) continue;/);
  assert.match(app, /if \(numLegs > 3 && numLegs <= MAX_PROMO_LEGS\)/);
  assert.match(app, /function PromoLegStartTime\(/);
  assert.match(app, /function PromoParlayLegChips\(/);
  assert.match(app, /function PromoExpandedLegsTable\(/);
  assert.match(app, /<PromoLegStartTime commence_time=\{l\.commence_time\} \/>/);
  assert.match(app, /timeZone: 'America\/New_York'/);
  const expandedTableUses = (app.match(/<PromoExpandedLegsTable/g) || []).length;
  assert.ok(expandedTableUses >= 3, "boost, nosweat, and freebet expanded tables must all show start times");
  assert.equal(MAX_PROMO_LEGS, 8);
  for (const key of ALL_BOOKS.map(b => b.key)) {
    assert.ok(app.includes(`key: "${key}"`), `App.jsx missing book ${key}`);
  }
  for (const key of TRUSTED_BOOK_KEYS) {
    assert.ok(app.includes(`"${key}"`), `App.jsx missing trusted book ${key}`);
  }
  const bookKeys = ALL_BOOKS.map(b => b.key);
  for (const key of ["betanysports", "betopenly"]) {
    assert.ok(bookKeys.includes(key), `ALL_BOOKS missing ${key}`);
    assert.equal(TRUSTED_BOOK_KEYS.has(key), false, `${key} must stay out of TRUSTED_BOOK_KEYS`);
  }
  for (const key of ["bovada", "mybookieag", "betonlineag", "pinnacle"]) {
    assert.ok(bookKeys.includes(key), `ALL_BOOKS missing ${key}`);
    assert.equal(TRUSTED_BOOK_KEYS.has(key), true, `${key} must be in TRUSTED_BOOK_KEYS`);
  }
  assert.equal(ALL_BOOKS.find(b => b.key === "pinnacle")?.label, "Pinnacle");
  assert.match(app, /key: "pinnacle"[\s\S]*?label: "Pinnacle"/);
  assert.equal(ALL_BOOKS.find(b => b.key === "betopenly")?.exchange, true);
  assert.ok(!ALL_BOOKS.find(b => b.key === "betanysports")?.exchange);
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted, "App.jsx TRUSTED_BOOK_KEYS block");
  assert.ok(appTrusted[1].includes("bovada"));
  assert.ok(appTrusted[1].includes("mybookieag"));
  assert.ok(appTrusted[1].includes("betonlineag"));
  assert.ok(appTrusted[1].includes("pinnacle"));
  assert.ok(!appTrusted[1].includes("betanysports"));
  assert.ok(!appTrusted[1].includes("betopenly"));
  assert.match(app, /key: "betopenly"[\s\S]*?exchange: true/);
  assert.match(app, /function PromoTrueOddsSubline\(/);
  assert.match(app, /formatTrueOddsBookLine/);
  const fetchOdds = fs.readFileSync(path.join(__dirname, "../api/fetch-odds.js"), "utf8");
  assert.match(fetchOdds, /includeBetLimits=true/);
}

// ── bestOppSize from exchange bet_limit / size; missing stays null
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "pinnacle",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -115 }, { name: "Red Sox", price: 105 }] },
        ],
      },
      {
        key: "novig",
        markets: [
          { key: "h2h", outcomes: [
            { name: "Yankees", price: -118, bet_limit: 400 },
            { name: "Red Sox", price: 120, bet_limit: 1250 },
          ] },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb");
  const yankeesMl = buildAllLegsForBook(data, "pinnacle").find(l => l.name === "Yankees ML");
  assert.ok(yankeesMl);
  assert.equal(yankeesMl.bestOpp, 120);
  assert.equal(yankeesMl.bestOppBook, "novig");
  assert.equal(yankeesMl.bestOppSize, 1250);
  const soxMl = buildAllLegsForBook(data, "pinnacle").find(l => l.name === "Red Sox ML");
  assert.equal(soxMl.bestOppBook, "pinnacle");
  assert.equal(soxMl.bestOppSize, null);
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

// ── BetAnything / BetOpenly: selectable EV books, never trusted opp prices
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
        ],
      },
      {
        key: "betanysports",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: 150 }, { name: "Red Sox", price: -170 }] },
        ],
      },
      {
        key: "betopenly",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: 140 }, { name: "Red Sox", price: -160 }] },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb");

  const baYankees = buildAllLegsForBook(data, "betanysports").find(l => l.name === "Yankees ML");
  assert.ok(baYankees, "transformOddsData must build BetAnything legs");
  assert.equal(baYankees.dk, 150);
  assert.equal(baYankees.bookKey, "betanysports");
  assert.equal(baYankees.bestOpp, 100);
  assert.equal(baYankees.bestOppBook, "draftkings");

  const boYankees = buildAllLegsForBook(data, "betopenly").find(l => l.name === "Yankees ML");
  assert.ok(boYankees, "transformOddsData must build BetOpenly legs");
  assert.equal(boYankees.dk, 140);
  assert.equal(boYankees.bookKey, "betopenly");
  assert.equal(boYankees.bestOpp, 100);
  assert.equal(boYankees.bestOppBook, "draftkings");

  const dkYankees = buildAllLegsForBook(data, "draftkings").find(l => l.name === "Yankees ML");
  assert.ok(dkYankees);
  assert.notEqual(dkYankees.bestOppBook, "betanysports");
  assert.notEqual(dkYankees.bestOppBook, "betopenly");
}

// ── Bovada / MyBookie / BetOnline / Pinnacle are trusted opponent/fair prices
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
        ],
      },
      {
        key: "bovada",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -115 }, { name: "Red Sox", price: 110 }] },
        ],
      },
      {
        key: "mybookieag",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -118 }, { name: "Red Sox", price: 105 }] },
        ],
      },
      {
        key: "betonlineag",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -112 }, { name: "Red Sox", price: 115 }] },
        ],
      },
      {
        key: "pinnacle",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -108 }, { name: "Red Sox", price: 118 }] },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb");
  const dkYankees = buildAllLegsForBook(data, "draftkings").find(l => l.name === "Yankees ML");
  assert.ok(dkYankees);
  assert.equal(dkYankees.bestOpp, 118);
  assert.equal(dkYankees.bestOppBook, "pinnacle");

  const bovadaYankees = buildAllLegsForBook(data, "bovada").find(l => l.name === "Yankees ML");
  assert.ok(bovadaYankees);
  assert.equal(bovadaYankees.dk, -115);
  assert.equal(bovadaYankees.bookKey, "bovada");

  const mybookieYankees = buildAllLegsForBook(data, "mybookieag").find(l => l.name === "Yankees ML");
  assert.ok(mybookieYankees);
  assert.equal(mybookieYankees.dk, -118);
  assert.equal(mybookieYankees.bookKey, "mybookieag");

  const betonlineYankees = buildAllLegsForBook(data, "betonlineag").find(l => l.name === "Yankees ML");
  assert.ok(betonlineYankees);
  assert.equal(betonlineYankees.dk, -112);
  assert.equal(betonlineYankees.bookKey, "betonlineag");

  const pinnacleYankees = buildAllLegsForBook(data, "pinnacle").find(l => l.name === "Yankees ML");
  assert.ok(pinnacleYankees);
  assert.equal(pinnacleYankees.dk, -108);
  assert.equal(pinnacleYankees.bookKey, "pinnacle");
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

// ── 3-leg ranking stays exhaustive (not grow-from-3)
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game, dk, bestOpp) => ({
    name, dk, bestOpp, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("A ML", "A @ B", 100, -150), // ourTrueProb(-150)=0.4, implied 0.5 → -EV
    mk("C ML", "C @ D", 100, 120),  // ourTrueProb(120)≈0.545
    mk("E ML", "E @ F", 110, 130),
    mk("G ML", "G @ H", 105, 125),
    mk("A -1.5", "A @ B", 200, 100), // same game as A ML; huge plus-money
  ];
  const top3 = findTopParlays(legs, 3, 30, 100, 20);
  const uniqueGameTriples = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      if (legs[i].game === legs[j].game) continue;
      for (let k = j + 1; k < legs.length; k++) {
        if (legs[k].game === legs[i].game || legs[k].game === legs[j].game) continue;
        uniqueGameTriples.push([legs[i], legs[j], legs[k]]);
      }
    }
  }
  assert.equal(top3.length, uniqueGameTriples.length, "3-leg must still enumerate every unique-game triple");
  for (const p of top3) {
    assert.equal(p.legs.length, 3);
    assert.equal(new Set(p.legs.map(l => l.game)).size, 3);
  }
  let bestManual = null;
  for (const triple of uniqueGameTriples) {
    const r = calcParlayEV(triple, 30, 100);
    if (!bestManual || r.ev > bestManual.ev) bestManual = { legs: triple, ...r };
  }
  assert.ok(bestManual);
  assert.equal(top3[0].ev, bestManual.ev);
  assert.deepEqual(
    top3[0].legs.map(l => l.name).sort(),
    bestManual.legs.map(l => l.name).sort(),
  );
}

// ── grow-from-3: same game skipped, EV ranking, 3-leg unchanged
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game, dk, bestOpp) => ({
    name, dk, bestOpp, game, commence_time: future, sport: "baseball_mlb",
  });
  // +EV legs: dk +150 (implied 0.4) vs bestOpp +100 (ourTrue 0.5) → solid edge.
  // Same-game alt on A@B is even juicier and must NOT be the 4th add.
  const legs = [
    mk("A ML", "A @ B", 150, 100),
    mk("A alt", "A @ B", 400, 100), // same game, better raw EV — skip when A ML is in the seed
    mk("C ML", "C @ D", 150, 100),
    mk("E ML", "E @ F", 150, 100),
    mk("G ML", "G @ H", 140, 105), // best unused-game 4th
    mk("I ML", "I @ J", 110, 120), // weaker unused-game 4th
  ];
  const top3 = findTopParlays(legs, 3, 30, 100, 10);
  assert.ok(top3.length >= 1);
  assert.equal(top3[0].legs.length, 3);
  const seedNames = new Set(top3[0].legs.map(l => l.name));
  assert.ok(seedNames.has("A ML") || seedNames.has("A alt"));

  const top4 = findTopParlays(legs, 4, 30, 100, 10);
  assert.ok(top4.length >= 1);
  for (const p of top4) {
    assert.equal(p.legs.length, 4);
    const games = p.legs.map(l => l.game);
    assert.equal(new Set(games).size, 4, "grown 4-leg must skip same-game adds");
    const names = p.legs.map(l => l.name);
    assert.ok(!(names.includes("A ML") && names.includes("A alt")), "same-game A ML + A alt must not both appear");
  }
  for (let i = 1; i < top4.length; i++) {
    assert.ok(top4[i - 1].ev >= top4[i].ev, "4+ results ranked by calcParlayEV");
  }

  // Greedy add from the #1 3-leg must match findTopParlays(4) #1 when that seed wins.
  const seed = top3[0];
  const used = new Set(seed.legs.map(l => l.game));
  let bestAdd = null;
  for (const cand of legs) {
    if (used.has(cand.game)) continue;
    const r = calcParlayEV(seed.legs.concat(cand), 30, 100);
    if (!bestAdd || r.ev > bestAdd.ev) bestAdd = { cand, ...r };
  }
  assert.ok(bestAdd);
  assert.notEqual(bestAdd.cand.game, seed.legs[0].game);
  const grownDirect = growParlaysFromTop3(legs, 4, 30, 100, 10, null);
  assert.deepEqual(
    grownDirect.map(p => p.legs.map(l => l.name).sort()),
    top4.map(p => p.legs.map(l => l.name).sort()),
  );
  const winnerHasBestAdd = top4[0].legs.some(l => l.name === bestAdd.cand.name);
  const winnerIsSeedPlus = seed.legs.every(l => top4[0].legs.some(x => x.name === l.name));
  assert.ok(winnerHasBestAdd && winnerIsSeedPlus, "top 4-leg is the top 3-leg plus the best unused-game add");

  // 3-leg results are unchanged after the 4-leg call (pure function).
  const top3Again = findTopParlays(legs, 3, 30, 100, 10);
  assert.deepEqual(
    top3.map(p => p.legs.map(l => l.name).sort()),
    top3Again.map(p => p.legs.map(l => l.name).sort()),
  );
  assert.deepEqual(top3.map(p => p.ev), top3Again.map(p => p.ev));
}

// ── grow-from-3: minFinalOdds applies to the finished N-leg, not the 3-leg seed
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game) => ({
    name, dk: -110, bestOpp: 120, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("A ML", "A @ B"),
    mk("C ML", "C @ D"),
    mk("E ML", "E @ F"),
    mk("G ML", "G @ H"),
  ];
  const three = findTopParlays(legs, 3, 0, 100, 10, null);
  assert.ok(three.length >= 1);
  const threeOdds = three[0].parlayOdds;
  const four = findTopParlays(legs, 4, 0, 100, 10, threeOdds + 1);
  assert.ok(four.length >= 1, "4-leg can pass a minFinalOdds that the 3-leg seed misses");
  assert.ok(four[0].parlayOdds >= threeOdds + 1);
  const blocked = findTopParlays(legs, 3, 0, 100, 10, threeOdds + 1);
  assert.equal(blocked.length, 0, "3-leg still filters minFinalOdds on the 3-leg itself");
}

// ── grow-from-3: every added leg keeps commence_time (UI start times for 4+/8-leg)
{
  const mk = (name, game, hoursOut) => ({
    name, dk: 150, bestOpp: 100, game, sport: "baseball_mlb",
    commence_time: new Date(Date.now() + hoursOut * 60 * 60 * 1000).toISOString(),
  });
  const legs = [
    mk("A ML", "A @ B", 12),
    mk("C ML", "C @ D", 18),
    mk("E ML", "E @ F", 24),
    mk("G ML", "G @ H", 30),
    mk("I ML", "I @ J", 36),
    mk("K ML", "K @ L", 42),
    mk("M ML", "M @ N", 48),
    mk("O ML", "O @ P", 54),
  ];
  const byName = Object.fromEntries(legs.map(l => [l.name, l.commence_time]));
  const top8 = findTopParlays(legs, 8, 30, 100, 5);
  assert.ok(top8.length >= 1);
  assert.equal(top8[0].legs.length, 8);
  for (const l of top8[0].legs) {
    assert.equal(l.commence_time, byName[l.name], `grown 8-leg ${l.name} must keep commence_time`);
  }
  const top4 = findTopParlays(legs, 4, 30, 100, 5);
  assert.ok(top4.length >= 1);
  for (const l of top4[0].legs) {
    assert.equal(l.commence_time, byName[l.name], `grown 4-leg ${l.name} must keep commence_time`);
  }
}

// ── grow-from-3: not enough unique games → empty; cap at MAX_PROMO_LEGS
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const legs = [
    { name: "A ML", dk: 100, bestOpp: 110, game: "A @ B", commence_time: future, sport: "baseball_mlb" },
    { name: "C ML", dk: 100, bestOpp: 110, game: "C @ D", commence_time: future, sport: "baseball_mlb" },
    { name: "E ML", dk: 100, bestOpp: 110, game: "E @ F", commence_time: future, sport: "baseball_mlb" },
  ];
  assert.deepEqual(findTopParlays(legs, 4, 0, 100, 10), []);
  assert.deepEqual(findTopParlays(legs, MAX_PROMO_LEGS + 1, 0, 100, 10), []);
}

// ── isWithinDateRange: Promo Builder "Next 24h" / "7 Days" (scan uses 24h)
{
  const now = Date.now();
  const in12h = new Date(now + 12 * 60 * 60 * 1000).toISOString();
  const in36h = new Date(now + 36 * 60 * 60 * 1000).toISOString();
  const in8d = new Date(now + 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isWithinDateRange(in12h, "24h"), true);
  assert.equal(isWithinDateRange(in36h, "24h"), false);
  assert.equal(isWithinDateRange(in12h, "7d"), true);
  assert.equal(isWithinDateRange(in36h, "7d"), true);
  assert.equal(isWithinDateRange(in8d, "7d"), false);
  assert.equal(isWithinDateRange(in8d, "any"), true);
  // Full sport list stays available to Promo Builder / fetch-odds.
  assert.deepEqual(SPORT_KEYS, [
    "baseball_mlb",
    "americanfootball_nfl",
    "americanfootball_ncaaf",
    "basketball_nba",
    "basketball_ncaab",
    "icehockey_nhl",
  ]);
}

// ── buildAllLegsForBook: sportFilter + Next 24h drops NFL and far-out MLB
{
  const mkGame = (away, home, commence_time) => ({
    commence_time,
    away_team: away,
    home_team: home,
    bookmakers: [{
      key: "draftkings",
      markets: [{ key: "h2h", outcomes: [{ name: away, price: 110 }, { name: home, price: -130 }] }],
    }],
  });
  const in12h = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const in36h = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mlbNear = transformOddsData([mkGame("Yankees", "Red Sox", in12h)], "baseball_mlb");
  const mlbFar = transformOddsData([mkGame("Cubs", "Brewers", in36h)], "baseball_mlb");
  const nflNear = transformOddsData([mkGame("Chiefs", "Bills", in12h)], "americanfootball_nfl");
  const pastMlb = transformOddsData([mkGame("Dodgers", "Giants", past)], "baseball_mlb");

  const nearLegs = buildAllLegsForBook(mlbNear, "draftkings", ["baseball_mlb"], null, "24h");
  assert.ok(nearLegs.some(l => l.name === "Yankees ML"));

  const farLegs = buildAllLegsForBook(mlbFar, "draftkings", ["baseball_mlb"], null, "24h");
  assert.equal(farLegs.length, 0);

  const nflLegs = buildAllLegsForBook(nflNear, "draftkings", ["baseball_mlb"], null, "24h");
  assert.equal(nflLegs.length, 0);

  const pastLegs = buildAllLegsForBook(pastMlb, "draftkings", ["baseball_mlb"], null, "24h");
  assert.equal(pastLegs.length, 0);

  const nflUnfiltered = buildAllLegsForBook(nflNear, "draftkings", null, null, "any");
  assert.ok(nflUnfiltered.some(l => l.name === "Chiefs ML"), "other modules still scan all sports when unfiltered");
}

// ── maxLegOdds uses the same American-numeric convention as min
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [{
      key: "draftkings",
      markets: [
        { key: "h2h", outcomes: [{ name: "Yankees", price: -120 }, { name: "Red Sox", price: 250 }] },
      ],
    }, {
      key: "fanduel",
      markets: [
        { key: "h2h", outcomes: [{ name: "Yankees", price: -110 }, { name: "Red Sox", price: 105 }] },
      ],
    }],
  }];
  const data = transformOddsData(games, "baseball_mlb");
  const all = buildAllLegsForBook(data, "draftkings");
  assert.ok(all.some(l => l.name === "Yankees ML"));
  assert.ok(all.some(l => l.name === "Red Sox ML"));

  const max200 = buildAllLegsForBook(data, "draftkings", null, null, "any", 200);
  assert.ok(max200.some(l => l.name === "Yankees ML"), "favorite passes max +200");
  assert.ok(!max200.some(l => l.name === "Red Sox ML"), "+250 is over max +200");

  const minMinus110 = buildAllLegsForBook(data, "draftkings", null, -110, "any", null);
  assert.ok(!minMinus110.some(l => l.name === "Yankees ML"), "-120 is under min -110");
  assert.ok(minMinus110.some(l => l.name === "Red Sox ML"));

  const band = buildAllLegsForBook(data, "draftkings", null, -200, "any", 200);
  assert.ok(band.some(l => l.name === "Yankees ML"));
  assert.ok(!band.some(l => l.name === "Red Sox ML"));
}

// ── maxFinalOdds: skip when parlayOdds > max (same numeric convention as min)
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game, dk) => ({
    name, dk, bestOpp: 120, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("Dog ML", "A @ B", 300),
    mk("Mid ML", "C @ D", 150),
    mk("Fav ML", "E @ F", -150),
  ];
  const singles = findTopParlays(legs, 1, 0, 100, 10, null, 200);
  assert.deepEqual(singles.map(p => p.legs[0].name).sort(), ["Fav ML", "Mid ML"]);
  assert.ok(singles.every(p => p.parlayOdds <= 200));
  const none = findTopParlays(legs, 1, 0, 100, 10, null, -200);
  assert.equal(none.length, 0, "all singles are longer than -200");
}

// ── grow-from-3: maxFinalOdds applies to the finished N-leg
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game) => ({
    name, dk: -110, bestOpp: 120, game, commence_time: future, sport: "baseball_mlb",
  });
  const legs = [
    mk("A ML", "A @ B"),
    mk("C ML", "C @ D"),
    mk("E ML", "E @ F"),
    mk("G ML", "G @ H"),
  ];
  const three = findTopParlays(legs, 3, 0, 100, 10, null, null);
  assert.ok(three.length >= 1);
  const threeOdds = three[0].parlayOdds;
  const fourOpen = findTopParlays(legs, 4, 0, 100, 10, null, null);
  assert.ok(fourOpen.length >= 1);
  assert.ok(fourOpen[0].parlayOdds > threeOdds);
  const fourCapped = findTopParlays(legs, 4, 0, 100, 10, null, threeOdds);
  assert.equal(fourCapped.length, 0, "grown 4-leg is over a max set at the 3-leg odds");
  const threeCapped = findTopParlays(legs, 3, 0, 100, 10, null, threeOdds);
  assert.ok(threeCapped.length >= 1, "3-leg at the max bound is kept");
}

{
  assert.equal(passesOddsBounds(200, null, 200), true);
  assert.equal(passesOddsBounds(201, null, 200), false);
  assert.equal(passesOddsBounds(-110,  -200, null), true);
  assert.equal(passesOddsBounds(-250,  -200, null), false);
}

console.log("promo-ev.test.js ok");
