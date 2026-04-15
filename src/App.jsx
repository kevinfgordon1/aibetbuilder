import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const ALL_BOOKS = [
  { key: "draftkings", label: "DraftKings", color: "#53d769", bg: "rgba(83,215,105,0.15)", logo: "https://www.draftkings.com/favicon.ico" },
  { key: "fanduel", label: "FanDuel", color: "#1493ff", bg: "rgba(20,147,255,0.15)", logo: "https://www.fanduel.com/favicon.ico" },
  { key: "williamhill_us", label: "Caesars", color: "#d4a843", bg: "rgba(212,168,67,0.15)", logo: "https://www.caesars.com/favicon.ico" },
  { key: "betmgm", label: "BetMGM", color: "#c4a962", bg: "rgba(196,169,98,0.15)", logo: "https://sports.betmgm.com/favicon.ico" },
  { key: "betrivers", label: "BetRivers", color: "#4a9eff", bg: "rgba(74,158,255,0.15)", logo: "https://www.betrivers.com/favicon.ico" },
  { key: "fanatics", label: "Fanatics", color: "#ef4444", bg: "rgba(239,68,68,0.15)", logo: "https://sportsbook.fanatics.com/favicon.ico" },
  { key: "bovada", label: "Bovada", color: "#f97316", bg: "rgba(249,115,22,0.15)", logo: null },
  { key: "mybookieag", label: "MyBookie", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", logo: null },
  { key: "betonlineag", label: "BetOnline", color: "#10b981", bg: "rgba(16,185,129,0.15)", logo: null },
  { key: "lowvig", label: "LowVig", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", logo: null },
  { key: "betus", label: "BetUS", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", logo: null },
];

const SPORTS = [
  { key: "basketball_nba", label: "NBA" },
  { key: "baseball_mlb", label: "MLB" },
  { key: "icehockey_nhl", label: "NHL" },
];

const DATE_RANGES = [
  { val: "today", label: "Today" },
  { val: "24h", label: "Next 24h" },
  { val: "7d", label: "7 Days" },
  { val: "any", label: "Any" },
];

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

function BookBadge({ bookKey }) {
  const book = ALL_BOOKS.find(b => b.key === bookKey);
  if (!book) return null;
  const [logoError, setLogoError] = useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, color: book.color, background: book.bg, whiteSpace: "nowrap" }}>
      {book.logo && !logoError && (
        <img src={book.logo} alt="" width={12} height={12} style={{ borderRadius: 2 }} onError={() => setLogoError(true)} />
      )}
      {book.label}
    </span>
  );
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
      return outcome ? outcome[prop] : null;
    };

    const getBestOdds = (marketKey, teamName) => {
      let best = null;
      bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketKey);
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName);
        if (!outcome) return;
        const val = outcome.price;
        if (val === null || val === undefined) return;
        if (best === null || val > best) best = val;
      });
      return best;
    };

    const getBestSpreadOddsAtLine = (teamName, targetPoint) => {
      let best = null;
      bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === "spreads");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName && o.point === targetPoint);
        if (!outcome) return;
        if (best === null || outcome.price > best) best = outcome.price;
      });
      return best;
    };

    const countSpreadLinesAtPoint = (teamName, targetPoint) => {
      let count = 0;
      bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === "spreads");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName && o.point === targetPoint);
        if (outcome) count++;
      });
      return count;
    };

    const getBestTotalOddsAtLine = (side, targetPoint) => {
      let best = null;
      bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === "totals");
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === side && o.point === targetPoint);
        if (!outcome) return;
        if (best === null || outcome.price > best) best = outcome.price;
      });
      return best;
    };

    const countTotalLinesAtPoint = (side, targetPoint) => {
      let count = 0;
      bookmakers.forEach(book => {
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
        spr_away: getOdds(b.key, "spreads", away),
        spr_away_line: getOdds(b.key, "spreads", away, "point"),
        spr_home: getOdds(b.key, "spreads", home),
        spr_home_line: getOdds(b.key, "spreads", home, "point"),
        tot_line: getOdds(b.key, "totals", "Over", "point"),
        tot_over: getOdds(b.key, "totals", "Over"),
        tot_under: getOdds(b.key, "totals", "Under"),
      };
    });

    const best_away = getBestOdds("h2h", away);
    const best_home = getBestOdds("h2h", home);

    moneylines.push({
      away, home, commence_time, bookOdds, sport: sportKey,
      best_away, best_home,
      ml_opp_count_away: countMLLines(home),
      ml_opp_count_home: countMLLines(away),
      dk_away: getOdds("draftkings", "h2h", away),
      dk_home: getOdds("draftkings", "h2h", home),
      fd_away: getOdds("fanduel", "h2h", away),
      fd_home: getOdds("fanduel", "h2h", home),
      cs_away: getOdds("williamhill_us", "h2h", away),
      cs_home: getOdds("williamhill_us", "h2h", home),
      mgm_away: getOdds("betmgm", "h2h", away),
      mgm_home: getOdds("betmgm", "h2h", home),
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

      let bestOppForAway = getBestSpreadOddsAtLine(home, -awayPoint);
      const oppCountForAway = countSpreadLinesAtPoint(home, -awayPoint);
      if (bestOppForAway === null) bestOppForAway = homeOutcome.price;

      let bestOppForHome = getBestSpreadOddsAtLine(away, -homePoint);
      const oppCountForHome = countSpreadLinesAtPoint(away, -homePoint);
      if (bestOppForHome === null) bestOppForHome = awayOutcome.price;

      spreads.push({
        away, home, commence_time, bookOdds, sport: sportKey,
        best_away, best_home, book: b.key,
        dk_away_line: fmtPoint(awayPoint),
        dk_home_line: fmtPoint(homePoint),
        dk_away: awayOutcome.price, dk_home: homeOutcome.price,
        fd_away: getOdds("fanduel", "spreads", away), fd_home: getOdds("fanduel", "spreads", home),
        cs_away: getOdds("williamhill_us", "spreads", away), cs_home: getOdds("williamhill_us", "spreads", home),
        mgm_away: getOdds("betmgm", "spreads", away), mgm_home: getOdds("betmgm", "spreads", home),
        bestOpp_away: bestOppForAway, bestOpp_home: bestOppForHome,
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

      let bestOppForOver = getBestTotalOddsAtLine("Under", line);
      const oppCountForOver = countTotalLinesAtPoint("Under", line);
      if (bestOppForOver === null) bestOppForOver = underOutcome.price;

      let bestOppForUnder = getBestTotalOddsAtLine("Over", line);
      const oppCountForUnder = countTotalLinesAtPoint("Over", line);
      if (bestOppForUnder === null) bestOppForUnder = overOutcome.price;

      totals.push({
        away, home, commence_time, bookOdds, sport: sportKey,
        best_away, best_home, book: b.key,
        dk_line: line, best_line: line,
        dk_over: overOutcome.price, dk_under: underOutcome.price,
        fd_line: getOdds("fanduel", "totals", "Over", "point"),
        fd_over: getOdds("fanduel", "totals", "Over"), fd_under: getOdds("fanduel", "totals", "Under"),
        cs_line: getOdds("williamhill_us", "totals", "Over", "point"),
        cs_over: getOdds("williamhill_us", "totals", "Over"), cs_under: getOdds("williamhill_us", "totals", "Under"),
        mgm_line: getOdds("betmgm", "totals", "Over", "point"),
        mgm_over: getOdds("betmgm", "totals", "Over"), mgm_under: getOdds("betmgm", "totals", "Under"),
        bestOpp_over: bestOppForOver, bestOpp_under: bestOppForUnder,
        bestOppCount_over: oppCountForOver || 1,
        bestOppName_over: `u${line}`,
        bestOppCount_under: oppCountForUnder || 1,
        bestOppName_under: `o${line}`,
        match: true,
      });
    });
  });

  return { moneylines, run_lines: spreads, totals };
}

function mergeOddsData(allData) {
  return {
    moneylines: allData.flatMap(d => d.moneylines),
    run_lines: allData.flatMap(d => d.run_lines),
    totals: allData.flatMap(d => d.totals),
  };
}

function formatET(commence_time) {
  if (!commence_time) return "";
  return new Date(commence_time).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' ET';
}

function formatDateGroup(commence_time) {
  return new Date(commence_time).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function trueProb(bestOpponentOdds) {
  if (!bestOpponentOdds) return 0.5;
  if (bestOpponentOdds < 0) return Math.abs(bestOpponentOdds) / (Math.abs(bestOpponentOdds) + 100);
  return 100 / (bestOpponentOdds + 100);
}

function ourTrueProb(bestOpponentOdds) {
  return 1 - trueProb(bestOpponentOdds);
}

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
  if (!odds) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
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
  return { parlayDec, combinedProb, boostedProfit, ev, parlayOdds: Math.round((parlayDec - 1) * 100) };
}

function buildAllLegsForBook(data, book, sportFilter = null, minLegOdds = null, dateRange = "any") {
  const legs = [];
  const now = new Date();

  if (data.moneylines) {
    data.moneylines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      const awayOdds = g.bookOdds?.[book]?.ml_away;
      const homeOdds = g.bookOdds?.[book]?.ml_home;
      if
