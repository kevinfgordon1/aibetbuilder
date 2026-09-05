// Promo Builder EV / leg-building pipeline for the serverless EV-parlay scanner.
// Formulas must stay in lockstep with src/App.jsx (calcParlayEV, resolveOpp,
// buildAllLegsForBook, transformOddsData, findTopParlays, growParlaysFromTop3).
// Promo Builder may pass a Matching-books subset into App.jsx transformOddsData;
// this EV-scanner copy always uses the full TRUSTED_BOOK_KEYS set (Hard Rock,
// theScore, Pinnacle, etc. stay trusted here).
// API is CJS; the frontend stays ESM — tests pin formula parity against App.jsx source.
// Lives OUTSIDE /api so Vercel never exposes it as an HTTP endpoint.

const ALL_BOOKS = [
  { key: "draftkings", label: "DraftKings" },
  { key: "fanduel", label: "FanDuel" },
  { key: "williamhill_us", label: "Caesars" },
  { key: "betmgm", label: "BetMGM" },
  { key: "betrivers", label: "BetRivers" },
  { key: "fanatics", label: "Fanatics" },
  { key: "hardrockbet", label: "Hard Rock" },
  { key: "espnbet", label: "theScore Bet" },
  { key: "bovada", label: "Bovada" },
  { key: "mybookieag", label: "MyBookie" },
  { key: "betonlineag", label: "BetOnline" },
  { key: "pinnacle", label: "Pinnacle" },
  { key: "lowvig", label: "LowVig" },
  { key: "betus", label: "BetUS" },
  { key: "betanysports", label: "BetAnything" },
  { key: "kalshi", label: "Kalshi", exchange: true },
  { key: "novig", label: "Novig", exchange: true },
  { key: "prophetx", label: "ProphetX", exchange: true },
  { key: "polymarket", label: "Polymarket", exchange: true },
  { key: "betopenly", label: "BetOpenly", exchange: true },
];

const TRUSTED_BOOK_KEYS = new Set([
  "draftkings", "fanduel", "williamhill_us", "betmgm", "betrivers",
  "fanatics", "hardrockbet", "espnbet", "bovada", "mybookieag", "betonlineag",
  "pinnacle", "kalshi", "novig", "prophetx", "polymarket",
]);

const SPORTS = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
];
const SPORT_KEYS = SPORTS.map(s => s.key);

const PARLAY_LEG_CAP = 200;
// Profit-boost picker cap. 4+ legs grow greedily from top 3-leg parlays
// (no C(n,k) explosion). 8 covers typical boost promos without a new toolbar.
const MAX_PROMO_LEGS = 8;
// How many top 3-leg seeds to grow from. Extra work is ~seeds × leftover
// candidates per added leg — similar budget to today's 3-leg scan.
const GROW_FROM_3_SEEDS = 50;

// Same rules as src/trueOddsLine.js outcomeSize — finite positive size/bet_limit only.
function outcomeSize(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const raw = outcome.size ?? outcome.bet_limit;
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

function isWithinDateRange(commence_time, range) {
  const now = new Date();
  const ct = new Date(commence_time);
  if (range === "any") return true;
  if (range === "today") {
    const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const estCt = new Date(ct.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return estCt.toDateString() === estNow.toDateString();
  }
  if (range === "24h") return ct <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (range === "7d") return ct <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return true;
}

function transformOddsData(gamesArray, sportKey) {
  const moneylines = [];
  const spreads = [];
  const totals = [];
  const now = new Date();

  gamesArray.forEach(game => {
    if (new Date(game.commence_time) <= now) return;
    const away = game.away_team;
    const home = game.home_team;
    const bookmakers = game.bookmakers || [];
    const commence_time = game.commence_time;

    const getOdds = (bookKey, marketKey, teamName, prop = "price") => {
      const book = bookmakers.find(b => b.key === bookKey);
      if (!book) return null;
      const market = book.markets.find(m => m.key === marketKey);
      if (!market) return null;
      const outcome = market.outcomes.find(o => o.name === teamName);
      if (!outcome) return null;
      if (prop === "size") return outcomeSize(outcome);
      return outcome[prop] ?? null;
    };

    const getBestOdds = (marketKey, teamName) => {
      let best = null, bestBook = null, bestSize = null;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === marketKey);
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName);
        if (!outcome) return;
        const val = outcome.price;
        if (val === null || val === undefined) return;
        if (best === null || val > best) { best = val; bestBook = book.key; bestSize = outcomeSize(outcome); }
      });
      return { best, bestBook, bestSize };
    };

    const getBestSpreadOddsAtLine = (teamName, targetPoint) => {
      let best = null, bestBook = null, bestSize = null;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "spreads");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName && o.point === targetPoint);
        if (!outcome) return;
        if (best === null || outcome.price > best) { best = outcome.price; bestBook = book.key; bestSize = outcomeSize(outcome); }
      });
      return { best, bestBook, bestSize };
    };

    const countSpreadLinesAtPoint = (teamName, targetPoint) => {
      let count = 0;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "spreads");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName && o.point === targetPoint);
        if (outcome) count++;
      });
      return count;
    };

    const getBestTotalOddsAtLine = (side, targetPoint) => {
      let best = null, bestBook = null, bestSize = null;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "totals");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === side && o.point === targetPoint);
        if (!outcome) return;
        if (best === null || outcome.price > best) { best = outcome.price; bestBook = book.key; bestSize = outcomeSize(outcome); }
      });
      return { best, bestBook, bestSize };
    };

    const countTotalLinesAtPoint = (side, targetPoint) => {
      let count = 0;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "totals");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === side && o.point === targetPoint);
        if (outcome) count++;
      });
      return count;
    };

    const countMLLines = (teamName) => {
      let count = 0;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "h2h");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName);
        if (outcome) count++;
      });
      return count;
    };

    const bookOdds = {};
    ALL_BOOKS.forEach(b => {
      bookOdds[b.key] = {
        ml_away: getOdds(b.key, "h2h", away),
        ml_home: getOdds(b.key, "h2h", home),
        ml_away_size: getOdds(b.key, "h2h", away, "size"),
        ml_home_size: getOdds(b.key, "h2h", home, "size"),
        spr_away: getOdds(b.key, "spreads", away),
        spr_away_line: getOdds(b.key, "spreads", away, "point"),
        spr_home: getOdds(b.key, "spreads", home),
        spr_home_line: getOdds(b.key, "spreads", home, "point"),
        tot_line: getOdds(b.key, "totals", "Over", "point"),
        tot_over: getOdds(b.key, "totals", "Over"),
        tot_under: getOdds(b.key, "totals", "Under"),
      };
    });

    const bestAwayML = getBestOdds("h2h", away);
    const bestHomeML = getBestOdds("h2h", home);
    const best_away = bestAwayML.best;
    const best_home = bestHomeML.best;

    const isThreeWay = bookmakers.some(b => {
      const m = (b.markets || []).find(mk => mk.key === "h2h");
      return m && m.outcomes.some(o => o.name === "Draw");
    });

    moneylines.push({
      away, home, commence_time, bookOdds, sport: sportKey,
      best_away, best_home,
      is_three_way: isThreeWay,
      best_away_book: bestAwayML.bestBook,
      best_home_book: bestHomeML.bestBook,
      best_away_size: bestAwayML.bestSize ?? null,
      best_home_size: bestHomeML.bestSize ?? null,
      ml_opp_count_away: countMLLines(home),
      ml_opp_count_home: countMLLines(away),
    });

    ALL_BOOKS.forEach(b => {
      const bookData = bookmakers.find(bm => bm.key === b.key);
      if (!bookData) return;
      const sprMarket = bookData.markets.find(m => m.key === "spreads");
      if (!sprMarket) return;
      const awayOutcome = sprMarket.outcomes.find(o => o.name === away);
      const homeOutcome = sprMarket.outcomes.find(o => o.name === home);
      if (!awayOutcome || !homeOutcome) return;
      const awayPoint = awayOutcome.point;
      const homePoint = homeOutcome.point;
      const fmtPoint = (p) => p > 0 ? `+${p}` : `${p}`;

      const oppAwayLookup = getBestSpreadOddsAtLine(home, -awayPoint);
      let bestOppForAway = oppAwayLookup.best;
      let bestOppForAwayBook = oppAwayLookup.bestBook;
      let bestOppForAwaySize = oppAwayLookup.bestSize ?? null;
      const oppCountForAway = countSpreadLinesAtPoint(home, -awayPoint);
      if (bestOppForAway === null) { bestOppForAway = homeOutcome.price; bestOppForAwayBook = b.key; bestOppForAwaySize = outcomeSize(homeOutcome); }

      const oppHomeLookup = getBestSpreadOddsAtLine(away, -homePoint);
      let bestOppForHome = oppHomeLookup.best;
      let bestOppForHomeBook = oppHomeLookup.bestBook;
      let bestOppForHomeSize = oppHomeLookup.bestSize ?? null;
      const oppCountForHome = countSpreadLinesAtPoint(away, -homePoint);
      if (bestOppForHome === null) { bestOppForHome = awayOutcome.price; bestOppForHomeBook = b.key; bestOppForHomeSize = outcomeSize(awayOutcome); }

      spreads.push({
        away, home, commence_time, bookOdds, sport: sportKey,
        best_away, best_home, book: b.key,
        away_odds: awayOutcome.price, home_odds: homeOutcome.price,
        away_size: outcomeSize(awayOutcome), home_size: outcomeSize(homeOutcome),
        away_line: fmtPoint(awayPoint), home_line: fmtPoint(homePoint),
        away_point: awayPoint, home_point: homePoint,
        bestOpp_away: bestOppForAway, bestOpp_home: bestOppForHome,
        bestOpp_away_book: bestOppForAwayBook, bestOpp_home_book: bestOppForHomeBook,
        bestOpp_away_size: bestOppForAwaySize, bestOpp_home_size: bestOppForHomeSize,
        bestOppCount_away: oppCountForAway || 1,
        bestOppName_away: `${home} ${fmtPoint(-awayPoint)}`,
        bestOppCount_home: oppCountForHome || 1,
        bestOppName_home: `${away} ${fmtPoint(-homePoint)}`,
      });
    });

    ALL_BOOKS.forEach(b => {
      const bookData = bookmakers.find(bm => bm.key === b.key);
      if (!bookData) return;
      const totMarket = bookData.markets.find(m => m.key === "totals");
      if (!totMarket) return;
      const overOutcome = totMarket.outcomes.find(o => o.name === "Over");
      const underOutcome = totMarket.outcomes.find(o => o.name === "Under");
      if (!overOutcome || !underOutcome) return;
      const line = overOutcome.point;

      const oppOverLookup = getBestTotalOddsAtLine("Under", line);
      let bestOppForOver = oppOverLookup.best;
      let bestOppForOverBook = oppOverLookup.bestBook;
      let bestOppForOverSize = oppOverLookup.bestSize ?? null;
      const oppCountForOver = countTotalLinesAtPoint("Under", line);
      if (bestOppForOver === null) { bestOppForOver = underOutcome.price; bestOppForOverBook = b.key; bestOppForOverSize = outcomeSize(underOutcome); }

      const oppUnderLookup = getBestTotalOddsAtLine("Over", line);
      let bestOppForUnder = oppUnderLookup.best;
      let bestOppForUnderBook = oppUnderLookup.bestBook;
      let bestOppForUnderSize = oppUnderLookup.bestSize ?? null;
      const oppCountForUnder = countTotalLinesAtPoint("Over", line);
      if (bestOppForUnder === null) { bestOppForUnder = overOutcome.price; bestOppForUnderBook = b.key; bestOppForUnderSize = outcomeSize(overOutcome); }

      totals.push({
        away, home, commence_time, bookOdds, sport: sportKey,
        best_away, best_home, book: b.key,
        line, over_odds: overOutcome.price, under_odds: underOutcome.price,
        over_size: outcomeSize(overOutcome), under_size: outcomeSize(underOutcome),
        bestOpp_over: bestOppForOver, bestOpp_under: bestOppForUnder,
        bestOpp_over_book: bestOppForOverBook, bestOpp_under_book: bestOppForUnderBook,
        bestOpp_over_size: bestOppForOverSize, bestOpp_under_size: bestOppForUnderSize,
        bestOppCount_over: oppCountForOver || 1,
        bestOppName_over: `${away}/${home} u${line}`,
        bestOppCount_under: oppCountForUnder || 1,
        bestOppName_under: `${away}/${home} o${line}`,
        match: true,
      });
    });
  });

  return { moneylines, run_lines: spreads, totals, team_totals: [] };
}

function mergeOddsData(allData) {
  return {
    moneylines: allData.flatMap(d => d.moneylines || []),
    run_lines: allData.flatMap(d => d.run_lines || []),
    totals: allData.flatMap(d => d.totals || []),
    team_totals: allData.flatMap(d => d.team_totals || []),
  };
}

function hydrateFeaturedOdds(rows) {
  return mergeOddsData((rows || []).map(row => transformOddsData(row.data || [], row.sport)));
}

function trueProb(bestOpponentOdds) {
  if (!bestOpponentOdds) return 0.5;
  if (bestOpponentOdds < 0) return Math.abs(bestOpponentOdds) / (Math.abs(bestOpponentOdds) + 100);
  return 100 / (bestOpponentOdds + 100);
}

function ourTrueProb(bestOpponentOdds) { return 1 - trueProb(bestOpponentOdds); }

function impliedProb(odds) {
  if (!odds) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function dkDecimal(odds) {
  if (!odds) return 1;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

function formatOdds(odds) {
  if (odds == null || odds === "") return "—";
  const n = typeof odds === "number" ? odds : Number(String(odds).trim().replace(/^\+/, ""));
  if (!isFinite(n) || n === 0) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function decimalToAmerican(dec) {
  if (!isFinite(dec) || dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function calcEV(bookOdds, bestOpponentOdds) {
  const prob = ourTrueProb(bestOpponentOdds);
  const dec = dkDecimal(bookOdds);
  const profit = (dec - 1) * 100;
  const ev = (prob * profit) - ((1 - prob) * 100);
  return { prob, ev, profit };
}

function calcParlayEV(legs, boostPct, stake) {
  let parlayDec = 1;
  let combinedProb = 1;
  legs.forEach(l => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  });
  const boostedProfit = (parlayDec - 1) * stake * (1 + boostPct / 100);
  const ev = (combinedProb * boostedProfit) - ((1 - combinedProb) * stake);
  return { parlayDec, combinedProb, boostedProfit, ev, parlayOdds: decimalToAmerican(parlayDec) };
}

// Free bet does not risk cash (loss = $0). Win pays profit only — stake not returned.
function calcFreeBetParlayEV(legs, freeBetAmount) {
  let parlayDec = 1;
  let combinedProb = 1;
  legs.forEach(l => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  });
  const winProfit = (parlayDec - 1) * freeBetAmount;
  const ev = combinedProb * winProfit;
  return { parlayDec, combinedProb, winProfit, ev, parlayOdds: decimalToAmerican(parlayDec) };
}

function resolveOpp({ trustedOpp, trustedBook, trustedCount, trustedSize, sameBookOpp, sameBookKey, sameBookSize }) {
  if (trustedOpp != null) return { bestOpp: trustedOpp, bestOppBook: trustedBook, bestOppCount: trustedCount, bestOppSize: trustedSize ?? null, sameBookFallback: false };
  if (sameBookOpp != null) return { bestOpp: sameBookOpp, bestOppBook: sameBookKey, bestOppCount: 1, bestOppSize: sameBookSize ?? null, sameBookFallback: true };
  return { bestOpp: null, bestOppBook: trustedBook || null, bestOppCount: trustedCount || 0, bestOppSize: trustedSize ?? null, sameBookFallback: false };
}

// Same American-numeric convention as min: odds >= min and odds <= max.
function passesOddsBounds(odds, minOdds, maxOdds) {
  if (minOdds !== null && odds < minOdds) return false;
  if (maxOdds !== null && odds > maxOdds) return false;
  return true;
}

function buildAllLegsForBook(data, book, sportFilter = null, minLegOdds = null, dateRange = "any", maxLegOdds = null) {
  const legs = [];
  const now = new Date();

  if (data.moneylines) {
    data.moneylines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.is_three_way) return;
      const awayOdds = g.bookOdds?.[book]?.ml_away;
      const homeOdds = g.bookOdds?.[book]?.ml_home;
      if (awayOdds == null || homeOdds == null) return;
      if (passesOddsBounds(awayOdds, minLegOdds, maxLegOdds))
        legs.push({ name: `${g.away} ML`, dk: awayOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.home} ML`, ...resolveOpp({ trustedOpp: g.best_home, trustedBook: g.best_home_book, trustedCount: g.ml_opp_count_away, trustedSize: g.best_home_size, sameBookOpp: homeOdds, sameBookKey: book, sameBookSize: g.bookOdds?.[book]?.ml_home_size }) });
      if (passesOddsBounds(homeOdds, minLegOdds, maxLegOdds))
        legs.push({ name: `${g.home} ML`, dk: homeOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.away} ML`, ...resolveOpp({ trustedOpp: g.best_away, trustedBook: g.best_away_book, trustedCount: g.ml_opp_count_home, trustedSize: g.best_away_size, sameBookOpp: awayOdds, sameBookKey: book, sameBookSize: g.bookOdds?.[book]?.ml_away_size }) });
    });
  }

  if (data.run_lines) {
    const seen = new Set();
    data.run_lines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const awayOdds = g.away_odds;
      const homeOdds = g.home_odds;
      if (awayOdds == null || homeOdds == null) return;
      const ak = `${g.away}@${g.home}_away_${g.away_line}`;
      const hk = `${g.away}@${g.home}_home_${g.home_line}`;
      if (!seen.has(ak) && passesOddsBounds(awayOdds, minLegOdds, maxLegOdds)) { seen.add(ak); legs.push({ name: `${g.away} ${g.away_line}`, dk: awayOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_away, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_away, trustedBook: g.bestOpp_away_book, trustedCount: g.bestOppCount_away, trustedSize: g.bestOpp_away_size, sameBookOpp: homeOdds, sameBookKey: book, sameBookSize: g.home_size }) }); }
      if (!seen.has(hk) && passesOddsBounds(homeOdds, minLegOdds, maxLegOdds)) { seen.add(hk); legs.push({ name: `${g.home} ${g.home_line}`, dk: homeOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_home, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_home, trustedBook: g.bestOpp_home_book, trustedCount: g.bestOppCount_home, trustedSize: g.bestOpp_home_size, sameBookOpp: awayOdds, sameBookKey: book, sameBookSize: g.away_size }) }); }
    });
  }

  if (data.totals) {
    const seen = new Set();
    data.totals.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const overOdds = g.over_odds;
      const underOdds = g.under_odds;
      if (overOdds == null || underOdds == null) return;
      const ok = `${g.away}@${g.home}_over_${g.line}`;
      const uk = `${g.away}@${g.home}_under_${g.line}`;
      if (!seen.has(ok) && passesOddsBounds(overOdds, minLegOdds, maxLegOdds)) { seen.add(ok); legs.push({ name: `${g.away}/${g.home} o${g.line}`, dk: overOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, trustedSize: g.bestOpp_over_size, sameBookOpp: underOdds, sameBookKey: book, sameBookSize: g.under_size }) }); }
      if (!seen.has(uk) && passesOddsBounds(underOdds, minLegOdds, maxLegOdds)) { seen.add(uk); legs.push({ name: `${g.away}/${g.home} u${g.line}`, dk: underOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, trustedSize: g.bestOpp_under_size, sameBookOpp: overOdds, sameBookKey: book, sameBookSize: g.over_size }) }); }
    });
  }

  if (data.team_totals) {
    const seen = new Set();
    data.team_totals.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const overOdds = g.over_odds;
      const underOdds = g.under_odds;
      if (overOdds == null || underOdds == null) return;
      const ok = `${g.away}@${g.home}_TT_${g.team}_o_${g.line}`;
      const uk = `${g.away}@${g.home}_TT_${g.team}_u_${g.line}`;
      if (!seen.has(ok) && passesOddsBounds(overOdds, minLegOdds, maxLegOdds)) { seen.add(ok); legs.push({ name: `${g.team} TT o${g.line}`, dk: overOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, trustedSize: g.bestOpp_over_size, sameBookOpp: underOdds, sameBookKey: book, sameBookSize: g.under_size }) }); }
      if (!seen.has(uk) && passesOddsBounds(underOdds, minLegOdds, maxLegOdds)) { seen.add(uk); legs.push({ name: `${g.team} TT u${g.line}`, dk: underOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, trustedSize: g.bestOpp_under_size, sameBookOpp: overOdds, sameBookKey: book, sameBookSize: g.over_size }) }); }
    });
  }

  return legs;
}

function parlayLegKey(p) {
  return p.legs.map(l => `${l.game}\0${l.name}`).sort().join("\n");
}

// 4+ legs: take top 3-leg parlays, then greedily add one unused-game leg at a
// time ranked by calcParlayEV. Same book/filters as the caller already applied
// to `legs`. minFinalOdds / maxFinalOdds are applied to the finished N-leg, not
// the 3-leg seed (a short 3-leg can still grow into a long enough parlay).
function growParlaysFromTop3(legs, numLegs, boostPct, stake, maxResults, minFinalOdds, maxFinalOdds) {
  const seedCount = Math.max(maxResults, GROW_FROM_3_SEEDS);
  const seeds = findTopParlays(legs, 3, boostPct, stake, seedCount, null, null);
  const seen = new Set();
  const grown = [];
  for (const seed of seeds) {
    let current = seed;
    let failed = false;
    for (let n = current.legs.length; n < numLegs; n++) {
      const usedGames = new Set(current.legs.map(l => l.game));
      let best = null;
      for (const cand of legs) {
        if (usedGames.has(cand.game)) continue;
        // Concat the original candidate — do not slim it (commence_time must survive).
        const nextLegs = current.legs.concat(cand);
        const r = calcParlayEV(nextLegs, boostPct, stake);
        if (!best || r.ev > best.ev) best = { legs: nextLegs, ...r };
      }
      if (!best) { failed = true; break; }
      current = best;
    }
    if (failed || current.legs.length !== numLegs) continue;
    if (!passesOddsBounds(current.parlayOdds, minFinalOdds, maxFinalOdds)) continue;
    const key = parlayLegKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    grown.push(current);
  }
  grown.sort((a, b) => b.ev - a.ev);
  return grown.slice(0, maxResults);
}

function findTopParlays(legs, numLegs, boostPct, stake, maxResults = 10, minFinalOdds = null, maxFinalOdds = null) {
  if (numLegs > 3 && numLegs <= MAX_PROMO_LEGS) {
    return growParlaysFromTop3(legs, numLegs, boostPct, stake, maxResults, minFinalOdds, maxFinalOdds);
  }

  const results = [];
  const getGame = (leg) => leg.game;

  if (numLegs === 1) {
    legs.forEach(l => {
      const r = calcParlayEV([l], boostPct, stake);
      if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) return;
      results.push({ legs: [l], ...r });
    });
  } else if (numLegs === 2) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (getGame(legs[i]) === getGame(legs[j])) continue;
        const r = calcParlayEV([legs[i], legs[j]], boostPct, stake);
        if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) continue;
        results.push({ legs: [legs[i], legs[j]], ...r });
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (getGame(legs[i]) === getGame(legs[j])) continue;
        for (let k = j + 1; k < legs.length; k++) {
          if (getGame(legs[k]) === getGame(legs[i]) || getGame(legs[k]) === getGame(legs[j])) continue;
          const r = calcParlayEV([legs[i], legs[j], legs[k]], boostPct, stake);
          if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) continue;
          results.push({ legs: [legs[i], legs[j], legs[k]], ...r });
        }
      }
    }
  }

  results.sort((a, b) => b.ev - a.ev);
  return results.slice(0, maxResults);
}

function mainMarketLegs(legs) {
  return (legs || []).filter(l => !l.isAlt && l.market !== "TT");
}

function sortLegsByEdge(legs) {
  return [...legs].sort((a, b) =>
    (ourTrueProb(b.bestOpp) - impliedProb(b.dk)) - (ourTrueProb(a.bestOpp) - impliedProb(a.dk))
  );
}

function evPct(ev, stake) {
  if (!stake) return 0;
  return (ev / stake) * 100;
}

function passesEvThreshold(ev, stake, thresholdPct = 2) {
  return evPct(ev, stake) > thresholdPct;
}

function bookLabel(bookKey) {
  return ALL_BOOKS.find(b => b.key === bookKey)?.label || bookKey;
}

module.exports = {
  ALL_BOOKS,
  TRUSTED_BOOK_KEYS,
  SPORTS,
  SPORT_KEYS,
  PARLAY_LEG_CAP,
  MAX_PROMO_LEGS,
  GROW_FROM_3_SEEDS,
  isWithinDateRange,
  transformOddsData,
  mergeOddsData,
  hydrateFeaturedOdds,
  trueProb,
  ourTrueProb,
  impliedProb,
  dkDecimal,
  formatOdds,
  decimalToAmerican,
  probToAmerican,
  calcEV,
  calcParlayEV,
  calcFreeBetParlayEV,
  resolveOpp,
  passesOddsBounds,
  buildAllLegsForBook,
  growParlaysFromTop3,
  findTopParlays,
  mainMarketLegs,
  sortLegsByEdge,
  evPct,
  passesEvThreshold,
  bookLabel,
  outcomeSize,
};
