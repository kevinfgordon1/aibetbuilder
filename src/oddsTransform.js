// Odds transforms for Promo Builder / Odds Board / +EV.
// trustedBookKeys gates getBestOdds / opp-count helpers. Offer-side bookOdds
// still iterate allBooks so an unchecked matching book can price the promo.

import { outcomeSize } from "./trueOddsLine.js";

export function transformOddsData(gamesArray, sportKey, trustedBookKeys, allBooks) {
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
        if (!trustedBookKeys.has(book.key)) return;
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
        if (!trustedBookKeys.has(book.key)) return;
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
        if (!trustedBookKeys.has(book.key)) return;
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
        if (!trustedBookKeys.has(book.key)) return;
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
        if (!trustedBookKeys.has(book.key)) return;
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
        if (!trustedBookKeys.has(book.key)) return;
        const market = book.markets.find(m => m.key === "h2h");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName);
        if (outcome) count++;
      });
      return count;
    };

    const bookOdds = {};
    allBooks.forEach(b => {
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

    allBooks.forEach(b => {
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

    allBooks.forEach(b => {
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

export function transformEventOddsData(game, sportKey, trustedBookKeys, allBooks) {
  const run_lines = [];
  const totals = [];
  const team_totals = [];
  const empty = { moneylines: [], run_lines, totals, team_totals };
  if (!game || !game.bookmakers) return empty;
  if (new Date(game.commence_time) <= new Date()) return empty;

  const away = game.away_team;
  const home = game.home_team;
  const commence_time = game.commence_time;
  const bookmakers = game.bookmakers;
  const isHalf = (p) => p != null && Math.abs(p % 1) === 0.5;
  const fmtPoint = (p) => (p > 0 ? `+${p}` : `${p}`);

  const bestSpreadAt = (teamName, point) => {
    let best = null, bestBook = null, bestSize = null, count = 0;
    bookmakers.forEach(b => {
      if (!trustedBookKeys.has(b.key)) return;
      const m = (b.markets || []).find(mk => mk.key === "alternate_spreads");
      if (!m) return;
      const o = m.outcomes.find(x => x.name === teamName && x.point === point);
      if (!o || o.price == null) return;
      count++;
      if (best === null || o.price > best) { best = o.price; bestBook = b.key; bestSize = outcomeSize(o); }
    });
    return { best, bestBook, bestSize, count };
  };

  const bestTotalAt = (side, point) => {
    let best = null, bestBook = null, bestSize = null, count = 0;
    bookmakers.forEach(b => {
      if (!trustedBookKeys.has(b.key)) return;
      const m = (b.markets || []).find(mk => mk.key === "alternate_totals");
      if (!m) return;
      const o = m.outcomes.find(x => x.name === side && x.point === point);
      if (!o || o.price == null) return;
      count++;
      if (best === null || o.price > best) { best = o.price; bestBook = b.key; bestSize = outcomeSize(o); }
    });
    return { best, bestBook, bestSize, count };
  };

  const bestTeamTotalAt = (team, side, point) => {
    let best = null, bestBook = null, bestSize = null, count = 0;
    bookmakers.forEach(b => {
      if (!trustedBookKeys.has(b.key)) return;
      (b.markets || []).forEach(m => {
        if (m.key !== "team_totals" && m.key !== "alternate_team_totals") return;
        const o = m.outcomes.find(x => x.name === side && x.description === team && x.point === point);
        if (!o || o.price == null) return;
        count++;
        if (best === null || o.price > best) { best = o.price; bestBook = b.key; bestSize = outcomeSize(o); }
      });
    });
    return { best, bestBook, bestSize, count };
  };

  allBooks.forEach(b => {
    const bm = bookmakers.find(x => x.key === b.key);
    if (!bm) return;
    const markets = bm.markets || [];

    const sprM = markets.find(m => m.key === "alternate_spreads");
    if (sprM) {
      const awayPts = new Map();
      const homePts = new Map();
      sprM.outcomes.forEach(o => {
        if (!isHalf(o.point) || o.price == null) return;
        const rec = { price: o.price, size: outcomeSize(o) };
        if (o.name === away) awayPts.set(o.point, rec);
        else if (o.name === home) homePts.set(o.point, rec);
      });
      awayPts.forEach((awayRec, P) => {
        const homeRec = homePts.get(-P);
        if (!homeRec) return;
        const awayOdds = awayRec.price, homeOdds = homeRec.price;
        const oppA = bestSpreadAt(home, -P);
        const oppH = bestSpreadAt(away, P);
        run_lines.push({
          away, home, commence_time, sport: sportKey, book: b.key, is_alt: true,
          away_odds: awayOdds, home_odds: homeOdds,
          away_size: awayRec.size, home_size: homeRec.size,
          away_line: fmtPoint(P), home_line: fmtPoint(-P),
          away_point: P, home_point: -P,
          bestOpp_away: oppA.best != null ? oppA.best : homeOdds,
          bestOpp_away_book: oppA.best != null ? oppA.bestBook : b.key,
          bestOpp_away_size: oppA.best != null ? oppA.bestSize : homeRec.size,
          bestOpp_home: oppH.best != null ? oppH.best : awayOdds,
          bestOpp_home_book: oppH.best != null ? oppH.bestBook : b.key,
          bestOpp_home_size: oppH.best != null ? oppH.bestSize : awayRec.size,
          bestOppCount_away: oppA.count || 1, bestOppName_away: `${home} ${fmtPoint(-P)}`,
          bestOppCount_home: oppH.count || 1, bestOppName_home: `${away} ${fmtPoint(P)}`,
        });
      });
    }

    const totM = markets.find(m => m.key === "alternate_totals");
    if (totM) {
      const byLine = new Map();
      totM.outcomes.forEach(o => {
        if (!isHalf(o.point) || o.price == null) return;
        const cur = byLine.get(o.point) || { line: o.point, over: null, under: null, overSize: null, underSize: null };
        if (o.name === "Over") { cur.over = o.price; cur.overSize = outcomeSize(o); }
        else if (o.name === "Under") { cur.under = o.price; cur.underSize = outcomeSize(o); }
        byLine.set(o.point, cur);
      });
      byLine.forEach(({ line, over, under, overSize, underSize }) => {
        if (over == null || under == null) return;
        const oppO = bestTotalAt("Under", line);
        const oppU = bestTotalAt("Over", line);
        totals.push({
          away, home, commence_time, sport: sportKey, book: b.key, is_alt: true,
          line, over_odds: over, under_odds: under,
          over_size: overSize, under_size: underSize,
          bestOpp_over: oppO.best != null ? oppO.best : under,
          bestOpp_over_book: oppO.best != null ? oppO.bestBook : b.key,
          bestOpp_over_size: oppO.best != null ? oppO.bestSize : underSize,
          bestOpp_under: oppU.best != null ? oppU.best : over,
          bestOpp_under_book: oppU.best != null ? oppU.bestBook : b.key,
          bestOpp_under_size: oppU.best != null ? oppU.bestSize : overSize,
          bestOppCount_over: oppO.count || 1, bestOppName_over: `${away}/${home} u${line}`,
          bestOppCount_under: oppU.count || 1, bestOppName_under: `${away}/${home} o${line}`,
          match: true,
        });
      });
    }

    const ttMarkets = markets.filter(m => m.key === "team_totals" || m.key === "alternate_team_totals");
    if (ttMarkets.length) {
      const byTeamLine = new Map();
      ttMarkets.forEach(m => {
        m.outcomes.forEach(o => {
          if (!isHalf(o.point) || o.price == null || !o.description) return;
          const key = `${o.description}|${o.point}`;
          const cur = byTeamLine.get(key) || { team: o.description, line: o.point, over: null, under: null, overSize: null, underSize: null };
          if (o.name === "Over") { cur.over = o.price; cur.overSize = outcomeSize(o); }
          else if (o.name === "Under") { cur.under = o.price; cur.underSize = outcomeSize(o); }
          byTeamLine.set(key, cur);
        });
      });
      byTeamLine.forEach(({ team, line, over, under, overSize, underSize }) => {
        if (over == null || under == null) return;
        const oppO = bestTeamTotalAt(team, "Under", line);
        const oppU = bestTeamTotalAt(team, "Over", line);
        team_totals.push({
          away, home, commence_time, sport: sportKey, book: b.key, team, line, is_alt: true,
          over_odds: over, under_odds: under,
          over_size: overSize, under_size: underSize,
          bestOpp_over: oppO.best != null ? oppO.best : under,
          bestOpp_over_book: oppO.best != null ? oppO.bestBook : b.key,
          bestOpp_over_size: oppO.best != null ? oppO.bestSize : underSize,
          bestOpp_under: oppU.best != null ? oppU.best : over,
          bestOpp_under_book: oppU.best != null ? oppU.bestBook : b.key,
          bestOpp_under_size: oppU.best != null ? oppU.bestSize : overSize,
          bestOppCount_over: oppO.count || 1, bestOppName_over: `${team} u${line}`,
          bestOppCount_under: oppU.count || 1, bestOppName_under: `${team} o${line}`,
        });
      });
    }
  });

  return { moneylines: [], run_lines, totals, team_totals };
}

