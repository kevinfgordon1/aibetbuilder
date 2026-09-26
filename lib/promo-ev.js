// Promo Builder EV / leg-building pipeline for the serverless EV-parlay scanner.
// Formulas must stay in lockstep with src/App.jsx (calcParlayEV, resolveOpp,
// buildAllLegsForBook, transformOddsData, findTopParlays, growParlaysFromTop3).
// Promo Builder may pass a Matching-books subset into App.jsx transformOddsData;
// this EV-scanner copy always uses the full TRUSTED_BOOK_KEYS set (Hard Rock,
// theScore, Pinnacle, etc. stay trusted here).
// API is CJS; the frontend stays ESM — tests pin formula parity against App.jsx source.
// Lives OUTSIDE /api so Vercel never exposes it as an HTTP endpoint.

const {
  SOCCER_SPORT_KEYS,
  SOCCER_ML_SIDES,
  isSoccerSport,
  isDrawOutcomeName,
  outcomeMatchesName,
  preferSoccerBinaryNo,
  soccerYesName,
  soccerNoName,
  soccerMlOppResolveArgs,
  bestSoccerBinaryNo,
  soccerLayBookLabel,
} = require("./soccer-pairing");

const {
  pickBestAmericanQuote,
  resolveOppWithSideGuard,
  oppQuoteLooksInverted,
  pickHasInvertedOpp,
  rankPicksAfterOppGuard,
} = require("./promo-opp-guard");

const {
  applyUnderdogCashLegPrices,
  stampUnderdogPredictionLegs,
  underdogCashOfferAmerican,
} = require("./underdog-predict-fee");

const {
  underdogOfferIsRankable,
  underdogPairIncomplete,
} = require("./underdog-freshness");

const {
  conflictsWithAny,
  playerTdLegsForBook,
  promoLegsCorrelate,
} = require("./player-td");

const ALL_BOOKS = [
  { key: "draftkings", label: "DraftKings" },
  { key: "fanduel", label: "FanDuel" },
  { key: "williamhill_us", label: "Caesars" },
  { key: "betmgm", label: "BetMGM" },
  { key: "betrivers", label: "BetRivers" },
  { key: "fanatics", label: "Fanatics" },
  { key: "hardrockbet", label: "Hard Rock" },
  { key: "courtside", label: "Courtside" },
  { key: "betparx", label: "betPARX" },
  { key: "ballybet", label: "Bally Bet" },
  { key: "espnbet", label: "theScore Bet" },
  { key: "bovada", label: "Bovada" },
  { key: "mybookieag", label: "MyBookie" },
  { key: "betonlineag", label: "BetOnline" },
  { key: "bookmaker", label: "Bookmaker" },
  { key: "pinnacle", label: "Pinnacle" },
  { key: "lowvig", label: "LowVig" },
  { key: "betus", label: "BetUS" },
  { key: "betanysports", label: "BetAnything" },
  { key: "kalshi", label: "Kalshi", exchange: true },
  { key: "novig", label: "Novig", exchange: true },
  { key: "prophetx", label: "ProphetX", exchange: true },
  { key: "polymarket", label: "Polymarket", exchange: true },
  { key: "underdog_predict", label: "Underdog Predict", exchange: true },
  { key: "betopenly", label: "BetOpenly", exchange: true },
];

const TRUSTED_BOOK_KEYS = new Set([
  "draftkings", "fanduel", "williamhill_us", "betmgm", "betrivers",
  "fanatics", "hardrockbet", "courtside", "betparx", "ballybet", "espnbet", "bovada", "mybookieag", "betonlineag",
  "bookmaker", "pinnacle", "betus", "kalshi", "novig", "prophetx", "polymarket",
  "underdog_predict",
]);

const SPORTS = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
  { key: "soccer_epl", label: "EPL" },
  { key: "soccer_usa_mls", label: "MLS" },
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

function outcomeUpdatedAt(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const raw = outcome.updatedAt ?? outcome.updated_at;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assignBookUpdatedAt(leg, updatedAt) {
  const ts = outcomeUpdatedAt({ updatedAt });
  if (leg && ts != null) leg.bookUpdatedAt = ts;
  return leg;
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
      const outcome = (market.outcomes || []).find(o => outcomeMatchesName(o.name, teamName));
      if (!outcome) return null;
      if (prop === "size") return outcomeSize(outcome);
      if (prop === "updatedAt") return outcomeUpdatedAt(outcome);
      return outcome[prop] ?? null;
    };

    const getBestOdds = (marketKey, teamName) => {
      const quotes = [];
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === marketKey);
        if (!market) return;
        const outcome = (market.outcomes || []).find(o => outcomeMatchesName(o.name, teamName));
        if (!outcome) return;
        const val = outcome.price;
        if (val === null || val === undefined) return;
        quotes.push({ price: val, book: book.key, size: outcomeSize(outcome) });
      });
      return pickBestAmericanQuote(quotes, { allBooks: ALL_BOOKS });
    };

    const getBestSpreadOddsAtLine = (teamName, targetPoint) => {
      const quotes = [];
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "spreads");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName && o.point === targetPoint);
        if (!outcome) return;
        quotes.push({ price: outcome.price, book: book.key, size: outcomeSize(outcome) });
      });
      return pickBestAmericanQuote(quotes, { allBooks: ALL_BOOKS });
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
      const quotes = [];
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === "totals");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === side && o.point === targetPoint);
        if (!outcome) return;
        quotes.push({ price: outcome.price, book: book.key, size: outcomeSize(outcome) });
      });
      return pickBestAmericanQuote(quotes, { allBooks: ALL_BOOKS });
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

    const countMLLines = (teamName, marketKey = "h2h") => {
      let count = 0;
      bookmakers.forEach(book => {
        if (!TRUSTED_BOOK_KEYS.has(book.key)) return;
        const market = book.markets.find(m => m.key === marketKey);
        if (!market) return;
        const outcome = (market.outcomes || []).find(o => outcomeMatchesName(o.name, teamName));
        if (outcome) count++;
      });
      return count;
    };

    const bookOdds = {};
    ALL_BOOKS.forEach(b => {
      bookOdds[b.key] = {
        ml_away: getOdds(b.key, "h2h", away),
        ml_home: getOdds(b.key, "h2h", home),
        ml_draw: getOdds(b.key, "h2h", "Draw"),
        ml_away_size: getOdds(b.key, "h2h", away, "size"),
        ml_home_size: getOdds(b.key, "h2h", home, "size"),
        ml_draw_size: getOdds(b.key, "h2h", "Draw", "size"),
        ml_away_updatedAt: getOdds(b.key, "h2h", away, "updatedAt"),
        ml_home_updatedAt: getOdds(b.key, "h2h", home, "updatedAt"),
        ml_draw_updatedAt: getOdds(b.key, "h2h", "Draw", "updatedAt"),
        ml_away_prediction: getOdds(b.key, "h2h", away, "predictionAmerican"),
        ml_home_prediction: getOdds(b.key, "h2h", home, "predictionAmerican"),
        ml_draw_prediction: getOdds(b.key, "h2h", "Draw", "predictionAmerican"),
        ml_away_probability: getOdds(b.key, "h2h", away, "contractProbability"),
        ml_home_probability: getOdds(b.key, "h2h", home, "contractProbability"),
        ml_draw_probability: getOdds(b.key, "h2h", "Draw", "contractProbability"),
        ml_away_no: getOdds(b.key, "h2h_lay", away),
        ml_home_no: getOdds(b.key, "h2h_lay", home),
        ml_draw_no: getOdds(b.key, "h2h_lay", "Draw"),
        ml_away_no_size: getOdds(b.key, "h2h_lay", away, "size"),
        ml_home_no_size: getOdds(b.key, "h2h_lay", home, "size"),
        ml_draw_no_size: getOdds(b.key, "h2h_lay", "Draw", "size"),
        spr_away: getOdds(b.key, "spreads", away),
        spr_away_line: getOdds(b.key, "spreads", away, "point"),
        spr_away_updatedAt: getOdds(b.key, "spreads", away, "updatedAt"),
        spr_home: getOdds(b.key, "spreads", home),
        spr_home_line: getOdds(b.key, "spreads", home, "point"),
        spr_home_updatedAt: getOdds(b.key, "spreads", home, "updatedAt"),
        tot_line: getOdds(b.key, "totals", "Over", "point"),
        tot_over: getOdds(b.key, "totals", "Over"),
        tot_over_updatedAt: getOdds(b.key, "totals", "Over", "updatedAt"),
        tot_under: getOdds(b.key, "totals", "Under"),
        tot_under_updatedAt: getOdds(b.key, "totals", "Under", "updatedAt"),
      };
    });

    const bestAwayML = getBestOdds("h2h", away);
    const bestHomeML = getBestOdds("h2h", home);
    const bestDrawML = getBestOdds("h2h", "Draw");
    const best_away = bestAwayML.best;
    const best_home = bestHomeML.best;
    const best_draw = bestDrawML.best;

    const isThreeWay = isSoccerSport(sportKey) || bookmakers.some(b => {
      const m = (b.markets || []).find(mk => mk.key === "h2h");
      return m && (m.outcomes || []).some(o => isDrawOutcomeName(o.name));
    });

    const soccerNo = {};
    if (isSoccerSport(sportKey)) {
      for (const side of SOCCER_ML_SIDES) {
        const name = side === "draw" ? "Draw" : (side === "away" ? away : home);
        const otherYes = side === "away" ? bestHomeML : side === "home" ? bestAwayML : null;
        const lay = bestSoccerBinaryNo(bookmakers, name, { sizeOf: outcomeSize, trustedBookKeys: TRUSTED_BOOK_KEYS });
        const picked = preferSoccerBinaryNo(lay, otherYes);
        soccerNo[side] = picked;
      }
    }

    moneylines.push({
      away, home, commence_time, bookOdds, sport: sportKey,
      best_away, best_home, best_draw,
      is_three_way: isThreeWay,
      best_away_book: bestAwayML.bestBook,
      best_home_book: bestHomeML.bestBook,
      best_draw_book: bestDrawML.bestBook,
      best_away_size: bestAwayML.bestSize ?? null,
      best_home_size: bestHomeML.bestSize ?? null,
      best_draw_size: bestDrawML.bestSize ?? null,
      best_away_no: soccerNo.away?.best ?? null,
      best_home_no: soccerNo.home?.best ?? null,
      best_draw_no: soccerNo.draw?.best ?? null,
      best_away_no_book: soccerNo.away?.bestBook ?? null,
      best_home_no_book: soccerNo.home?.bestBook ?? null,
      best_draw_no_book: soccerNo.draw?.bestBook ?? null,
      best_away_no_size: soccerNo.away?.bestSize ?? null,
      best_home_no_size: soccerNo.home?.bestSize ?? null,
      best_draw_no_size: soccerNo.draw?.bestSize ?? null,
      ml_opp_count_away: isSoccerSport(sportKey) ? (soccerNo.away?.count || 0) : countMLLines(home),
      ml_opp_count_home: isSoccerSport(sportKey) ? (soccerNo.home?.count || 0) : countMLLines(away),
      ml_opp_count_draw: soccerNo.draw?.count || 0,
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
        away_prediction: awayOutcome.predictionAmerican ?? null,
        home_prediction: homeOutcome.predictionAmerican ?? null,
        away_probability: awayOutcome.contractProbability ?? null,
        home_probability: homeOutcome.contractProbability ?? null,
        away_size: outcomeSize(awayOutcome), home_size: outcomeSize(homeOutcome),
        away_updatedAt: outcomeUpdatedAt(awayOutcome), home_updatedAt: outcomeUpdatedAt(homeOutcome),
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
        over_prediction: overOutcome.predictionAmerican ?? null,
        under_prediction: underOutcome.predictionAmerican ?? null,
        over_probability: overOutcome.contractProbability ?? null,
        under_probability: underOutcome.contractProbability ?? null,
        over_size: outcomeSize(overOutcome), under_size: outcomeSize(underOutcome),
        over_updatedAt: outcomeUpdatedAt(overOutcome), under_updatedAt: outcomeUpdatedAt(underOutcome),
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

function resolveOpp(args) {
  return resolveOppWithSideGuard(args);
}

function pushSoccerMlLegs(legs, g, bookKey, { seen, minLegOdds, maxLegOdds } = {}) {
  for (const side of SOCCER_ML_SIDES) {
    const odds = g.bookOdds?.[bookKey]?.[`ml_${side}`];
    if (odds == null) continue;
    const offered = underdogCashOfferAmerican(bookKey, odds, true, g.bookOdds?.[bookKey]?.[`ml_${side}_prediction`]);
    if (offered == null || !passesOddsBounds(offered, minLegOdds ?? null, maxLegOdds ?? null)) continue;
    const dedupe = `${g.commence_time || ""}\0${g.away}@${g.home}_ML_${side}_${bookKey}`;
    if (seen) {
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
    }
    const opp = resolveOpp({ ...soccerMlOppResolveArgs(g, side, bookKey), bookOdds: offered });
    if (opp.bestOpp == null) continue;
    legs.push(assignBookUpdatedAt(withUnderdogPromoDk({
      name: soccerYesName(side, g.away, g.home),
      dk: offered,
      market: "ML",
      game: `${g.away} @ ${g.home}`,
      commence_time: g.commence_time,
      sport: g.sport,
      bookKey,
      bestOppName: soccerNoName(side, g.away, g.home),
      soccerBinary: side,
      ...opp,
    }, bookKey, offered), g.bookOdds?.[bookKey]?.[`ml_${side}_updatedAt`]));
  }
}

// Same American-numeric convention as min: odds >= min and odds <= max.
function passesOddsBounds(odds, minOdds, maxOdds) {
  if (odds == null || !Number.isFinite(Number(odds))) return false;
  if (minOdds !== null && odds < minOdds) return false;
  if (maxOdds !== null && odds > maxOdds) return false;
  return true;
}

// Underdog Promo dk is the joined phone American. Other books keep sticker.
function withUnderdogPromoDk(leg, bookKey, offered) {
  if (!leg || bookKey !== "underdog_predict") return leg;
  return { ...leg, dk: offered, predictionAmerican: offered };
}

function oppositePromoAmerican(book, sticker, prediction) {
  const offered = underdogCashOfferAmerican(book, sticker, true, prediction);
  return offered == null ? sticker : offered;
}

function buildAllLegsForBook(data, book, sportFilter = null, minLegOdds = null, dateRange = "any", maxLegOdds = null, opts = null) {
  // Every Promo path uses joined odds.prediction for Underdog. A missing
  // quote omits that leg. A stale Underdog offer (its own updated_at older
  // than UNDERDOG_STALE_MS, 1 hour) is not a Promo candidate. The board
  // keeps that side until UNDERDOG_BOARD_OMIT_MS (24 hours).
  // opts.underdogCash does not restore a sticker or a fee-adjusted sticker.
  // The Odds Board reads bookOdds, not these legs. opts.now freezes the
  // freshness clock in tests.
  const quoteNow = opts && opts.now != null ? Number(opts.now) : Date.now();
  const legs = [];
  const now = new Date();

  if (data.moneylines) {
    data.moneylines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (isSoccerSport(g.sport)) {
        pushSoccerMlLegs(legs, g, book, { minLegOdds, maxLegOdds });
        return;
      }
      if (g.is_three_way) return;
      const awayOdds = g.bookOdds?.[book]?.ml_away;
      const homeOdds = g.bookOdds?.[book]?.ml_home;
      if (underdogPairIncomplete(book, awayOdds, homeOdds)) return;
      const awayOffer = underdogCashOfferAmerican(book, awayOdds, true, g.bookOdds?.[book]?.ml_away_prediction);
      const homeOffer = underdogCashOfferAmerican(book, homeOdds, true, g.bookOdds?.[book]?.ml_home_prediction);
      if (awayOffer != null && passesOddsBounds(awayOffer, minLegOdds, maxLegOdds))
        legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.away} ML`, dk: awayOffer, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.home} ML`, ...resolveOpp({ trustedOpp: g.best_home, trustedBook: g.best_home_book, trustedCount: g.ml_opp_count_away, trustedSize: g.best_home_size, sameBookOpp: oppositePromoAmerican(book, homeOdds, g.bookOdds?.[book]?.ml_home_prediction), sameBookKey: book, sameBookSize: g.bookOdds?.[book]?.ml_home_size, bookOdds: awayOffer }) }, book, awayOffer), g.bookOdds?.[book]?.ml_away_updatedAt));
      if (homeOffer != null && passesOddsBounds(homeOffer, minLegOdds, maxLegOdds))
        legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.home} ML`, dk: homeOffer, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.away} ML`, ...resolveOpp({ trustedOpp: g.best_away, trustedBook: g.best_away_book, trustedCount: g.ml_opp_count_home, trustedSize: g.best_away_size, sameBookOpp: oppositePromoAmerican(book, awayOdds, g.bookOdds?.[book]?.ml_away_prediction), sameBookKey: book, sameBookSize: g.bookOdds?.[book]?.ml_away_size, bookOdds: homeOffer }) }, book, homeOffer), g.bookOdds?.[book]?.ml_home_updatedAt));
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
      if (underdogPairIncomplete(book, awayOdds, homeOdds)) return;
      const ak = `${g.commence_time || ""}\0${g.away}@${g.home}_away_${g.away_line}`;
      const hk = `${g.commence_time || ""}\0${g.away}@${g.home}_home_${g.home_line}`;
      const awayOffer = underdogCashOfferAmerican(book, awayOdds, true, g.away_prediction);
      const homeOffer = underdogCashOfferAmerican(book, homeOdds, true, g.home_prediction);
      if (!seen.has(ak) && awayOffer != null && passesOddsBounds(awayOffer, minLegOdds, maxLegOdds)) { seen.add(ak); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.away} ${g.away_line}`, dk: awayOffer, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_away, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_away, trustedBook: g.bestOpp_away_book, trustedCount: g.bestOppCount_away, trustedSize: g.bestOpp_away_size, sameBookOpp: oppositePromoAmerican(book, homeOdds, g.home_prediction), sameBookKey: book, sameBookSize: g.home_size, bookOdds: awayOffer }) }, book, awayOffer), g.away_updatedAt ?? g.bookOdds?.[book]?.spr_away_updatedAt)); }
      if (!seen.has(hk) && homeOffer != null && passesOddsBounds(homeOffer, minLegOdds, maxLegOdds)) { seen.add(hk); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.home} ${g.home_line}`, dk: homeOffer, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_home, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_home, trustedBook: g.bestOpp_home_book, trustedCount: g.bestOppCount_home, trustedSize: g.bestOpp_home_size, sameBookOpp: oppositePromoAmerican(book, awayOdds, g.away_prediction), sameBookKey: book, sameBookSize: g.away_size, bookOdds: homeOffer }) }, book, homeOffer), g.home_updatedAt ?? g.bookOdds?.[book]?.spr_home_updatedAt)); }
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
      if (underdogPairIncomplete(book, overOdds, underOdds)) return;
      const ok = `${g.commence_time || ""}\0${g.away}@${g.home}_over_${g.line}`;
      const uk = `${g.commence_time || ""}\0${g.away}@${g.home}_under_${g.line}`;
      const overOffer = underdogCashOfferAmerican(book, overOdds, true, g.over_prediction);
      const underOffer = underdogCashOfferAmerican(book, underOdds, true, g.under_prediction);
      if (!seen.has(ok) && overOffer != null && passesOddsBounds(overOffer, minLegOdds, maxLegOdds)) { seen.add(ok); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.away}/${g.home} o${g.line}`, dk: overOffer, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, trustedSize: g.bestOpp_over_size, sameBookOpp: oppositePromoAmerican(book, underOdds, g.under_prediction), sameBookKey: book, sameBookSize: g.under_size, bookOdds: overOffer }) }, book, overOffer), g.over_updatedAt ?? g.bookOdds?.[book]?.tot_over_updatedAt)); }
      if (!seen.has(uk) && underOffer != null && passesOddsBounds(underOffer, minLegOdds, maxLegOdds)) { seen.add(uk); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.away}/${g.home} u${g.line}`, dk: underOffer, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, trustedSize: g.bestOpp_under_size, sameBookOpp: oppositePromoAmerican(book, overOdds, g.over_prediction), sameBookKey: book, sameBookSize: g.over_size, bookOdds: underOffer }) }, book, underOffer), g.under_updatedAt ?? g.bookOdds?.[book]?.tot_under_updatedAt)); }
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
      if (underdogPairIncomplete(book, overOdds, underOdds)) return;
      const ok = `${g.commence_time || ""}\0${g.away}@${g.home}_TT_${g.team}_o_${g.line}`;
      const uk = `${g.commence_time || ""}\0${g.away}@${g.home}_TT_${g.team}_u_${g.line}`;
      const overOffer = underdogCashOfferAmerican(book, overOdds, true, g.over_prediction);
      const underOffer = underdogCashOfferAmerican(book, underOdds, true, g.under_prediction);
      if (!seen.has(ok) && overOffer != null && passesOddsBounds(overOffer, minLegOdds, maxLegOdds)) { seen.add(ok); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.team} TT o${g.line}`, dk: overOffer, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, trustedSize: g.bestOpp_over_size, sameBookOpp: oppositePromoAmerican(book, underOdds, g.under_prediction), sameBookKey: book, sameBookSize: g.under_size, bookOdds: overOffer }) }, book, overOffer), g.over_updatedAt)); }
      if (!seen.has(uk) && underOffer != null && passesOddsBounds(underOffer, minLegOdds, maxLegOdds)) { seen.add(uk); legs.push(assignBookUpdatedAt(withUnderdogPromoDk({ name: `${g.team} TT u${g.line}`, dk: underOffer, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, trustedSize: g.bestOpp_under_size, sameBookOpp: oppositePromoAmerican(book, overOdds, g.over_prediction), sameBookKey: book, sameBookSize: g.over_size, bookOdds: underOffer }) }, book, underOffer), g.under_updatedAt)); }
    });
  }

  if (data.playerTds && data.playerTds.length) {
    for (const leg of playerTdLegsForBook(data.playerTds, book, {
      sportFilter,
      minLegOdds,
      maxLegOdds,
      dateRange,
      now: quoteNow,
      isWithinDateRange,
      passesOddsBounds,
      resolveOpp,
    })) legs.push(leg);
  }

  const priced = applyUnderdogCashLegPrices(stampUnderdogPredictionLegs(legs.filter((l) => l.bestOpp != null), data), true);
  return priced.filter((l) => passesOddsBounds(l.dk, minLegOdds, maxLegOdds) && underdogOfferIsRankable(l, quoteNow));
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
      let best = null;
      for (const cand of legs) {
        if (conflictsWithAny(cand, current.legs)) continue;
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

  if (numLegs === 1) {
    legs.forEach(l => {
      const r = calcParlayEV([l], boostPct, stake);
      if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) return;
      results.push({ legs: [l], ...r });
    });
  } else if (numLegs === 2) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (promoLegsCorrelate(legs[i], legs[j])) continue;
        const r = calcParlayEV([legs[i], legs[j]], boostPct, stake);
        if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) continue;
        results.push({ legs: [legs[i], legs[j]], ...r });
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (promoLegsCorrelate(legs[i], legs[j])) continue;
        for (let k = j + 1; k < legs.length; k++) {
          if (promoLegsCorrelate(legs[k], legs[i]) || promoLegsCorrelate(legs[k], legs[j])) continue;
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
  return ALL_BOOKS.find(b => b.key === bookKey)?.label || soccerLayBookLabel(bookKey) || bookKey;
}

module.exports = {
  ALL_BOOKS,
  TRUSTED_BOOK_KEYS,
  SPORTS,
  SPORT_KEYS,
  SOCCER_SPORT_KEYS,
  isSoccerSport,
  pushSoccerMlLegs,
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
  oppQuoteLooksInverted,
  pickHasInvertedOpp,
  rankPicksAfterOppGuard,
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
