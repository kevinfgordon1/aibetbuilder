import { useState, useEffect, useMemo } from "react";
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

// ── Exact analytical hedge solver ──────────────────────────────────────────
function toDecimal(american) {
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function impliedProbFromOdds(american) {
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100);
}

function ourTrueProbFromOpp(bestOpp) {
  return 1 - impliedProbFromOdds(bestOpp);
}

function getHedgeOdds(bestOpp) {
  const p = ourTrueProbFromOpp(bestOpp);
  const oppP = 1 - p;
  if (oppP >= 0.5) return Math.round(-100 * oppP / (1 - oppP));
  return Math.round(100 * (1 - oppP) / oppP);
}

function getAllOutcomes(n) {
  const outcomes = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    outcomes.push(Array.from({ length: n }, (_, i) => !!(mask & (1 << i))));
  }
  return outcomes;
}

function calcOutcomeProfit(outcome, hedgeStakes, hedgeDecs, boostedProfit, stake) {
  const allWin = outcome.every(w => w);
  let p = allWin ? boostedProfit : -stake;
  outcome.forEach((win, i) => {
    p += win ? hedgeStakes[i] * (hedgeDecs[i] - 1) : -hedgeStakes[i];
  });
  return p;
}

function solveHedgesAnalytical(legs, stake, boostedProfit) {
  const n = legs.length;
  const hedgeOdds = legs.map(l => getHedgeOdds(l.bestOpp));
  const d = hedgeOdds.map(o => toDecimal(o));
  const a = d.map(di => di - 1);

  let hedgeStakes;
  let isGuaranteed = false;

  if (n === 1) {
    const H0 = stake / a[0];
    hedgeStakes = [H0];
    isGuaranteed = H0 <= boostedProfit;

  } else if (n === 2) {
    const det = a[0] * a[1] - 1;
    if (det <= 0) {
      return { hedgeStakes: [0, 0], hedgeOdds, isGuaranteed: false, profits: [], outcomes: getAllOutcomes(2) };
    }
    const H1 = stake * d[1] / det;
    const H2 = stake * d[0] / det;
    hedgeStakes = [H1, H2];
    isGuaranteed = boostedProfit >= H1 + H2;

  } else if (n === 3) {
    const abc = a[0] * a[1] * a[2];
    const sumA = a[0] + a[1] + a[2];
    const det = abc - sumA - 2;
    if (det <= 0) {
      return { hedgeStakes: [0, 0, 0], hedgeOdds, isGuaranteed: false, profits: [], outcomes: getAllOutcomes(3) };
    }
    const H1 = stake * d[1] * d[2] / det;
    const H2 = stake * d[0] * d[2] / det;
    const H3 = stake * d[0] * d[1] / det;
    hedgeStakes = [H1, H2, H3];
    isGuaranteed = boostedProfit >= H1 + H2 + H3;

  } else {
    return { hedgeStakes: legs.map(() => 0), hedgeOdds, isGuaranteed: false, profits: [], outcomes: getAllOutcomes(n) };
  }

  const outcomes = getAllOutcomes(n);
  const profits = outcomes.map(o => calcOutcomeProfit(o, hedgeStakes, d, boostedProfit, stake));

  return { hedgeStakes, hedgeOdds, isGuaranteed, profits, outcomes };
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

function GuaranteedBadge({ legs, numLegs, stake, boostedProfit, ev, hedgeResult }) {
  const [open, setOpen] = useState(false);
  const isRare = numLegs >= 2;
  const result = hedgeResult;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "rgba(139,92,246,0.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.3)" }}>
          🔒 {isRare ? "Rare — " : ""}Guaranteed Profit Eligible
        </span>
        <button
          onClick={e => { e.stopPropagation(); setOpen(!open); }}
          style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#9ca3af", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          ⓘ
        </button>
      </div>

      {open && result && (
        <div style={{ marginTop: 12, background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "16px" }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 4 }}>How to lock in guaranteed profit</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>Place these hedge bets at the same time as your parlay. Every possible outcome results in $0 or better.</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Step 1 — Place your boosted parlay: ${stake} stake</div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 12 }}>Step 2 — Place these hedge bets simultaneously</div>
            {legs.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>Bet AGAINST {l.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    Fair hedge odds: {result.hedgeOdds[i] > 0 ? "+" : ""}{result.hedgeOdds[i]} — find best available odds on this side
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 16 }}>
                    ${result.hedgeStakes[i].toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>stake</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8, fontStyle: "italic" }}>
              Total hedge cost: ${result.hedgeStakes.reduce((s, h) => s + h, 0).toFixed(2)}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Outcome matrix — worst case is $0</div>
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${legs.length}, 1fr) 80px 90px`, padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {legs.map((l, i) => <div key={i}>{l.name.split(" ").slice(0, 2).join(" ")}</div>)}
                <div>Prob</div>
                <div style={{ textAlign: "right" }}>P/L</div>
              </div>
              {result.outcomes.map((outcome, oi) => {
                const profit = result.profits[oi];
                const prob = outcome.reduce((p, win, i) => p * (win ? ourTrueProbFromOpp(legs[i].bestOpp) : 1 - ourTrueProbFromOpp(legs[i].bestOpp)), 1);
                return (
                  <div key={oi} style={{ display: "grid", gridTemplateColumns: `repeat(${legs.length}, 1fr) 80px 90px`, padding: "8px 12px", borderBottom: oi < result.outcomes.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", fontSize: 12, alignItems: "center" }}>
                    {outcome.map((win, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: win ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: win ? "#10b981" : "#ef4444", display: "inline-block", width: "fit-content" }}>
                        {win ? "Win" : "Loss"}
                      </span>
                    ))}
                    <div style={{ color: "#6b7280" }}>{(prob * 100).toFixed(1)}%</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: profit >= -0.01 ? "#10b981" : "#ef4444", textAlign: "right" }}>
                      {profit >= -0.01 ? "+" : ""}${Math.max(0, profit).toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "12px 14px", background: "rgba(245,158,11,0.06)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.2)", fontSize: 12, color: "#9ca3af", lineHeight: 1.7 }}>
            <strong style={{ color: "#f59e0b" }}>⚠ EV tradeoff:</strong> By hedging this parlay you are guaranteeing a minimum of <strong style={{ color: "#10b981" }}>$0</strong> on every possible outcome. However you are giving up your expected value of <strong style={{ color: "#3b82f6" }}>+${ev.toFixed(2)}</strong>. Long-run, taking the +EV without hedging is the mathematically correct play. Only hedge if you prefer certainty over maximizing profit.
          </div>
        </div>
      )}
    </div>
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
        away_odds: awayOutcome.price, home_odds: homeOutcome.price,
        away_line: fmtPoint(awayPoint), home_line: fmtPoint(homePoint),
        away_point: awayPoint, home_point: homePoint,
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
        line, over_odds: overOutcome.price, under_odds: underOutcome.price,
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
      if (awayOdds == null || homeOdds == null) return;
      if (minLegOdds === null || awayOdds >= minLegOdds)
        legs.push({ name: `${g.away} ML`, dk: awayOdds, bestOpp: g.best_home, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.ml_opp_count_away, bestOppName: `${g.home} ML` });
      if (minLegOdds === null || homeOdds >= minLegOdds)
        legs.push({ name: `${g.home} ML`, dk: homeOdds, bestOpp: g.best_away, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.ml_opp_count_home, bestOppName: `${g.away} ML` });
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
      if (!seen.has(ak) && (minLegOdds === null || awayOdds >= minLegOdds)) { seen.add(ak); legs.push({ name: `${g.away} ${g.away_line}`, dk: awayOdds, bestOpp: g.bestOpp_away, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.bestOppCount_away, bestOppName: g.bestOppName_away }); }
      if (!seen.has(hk) && (minLegOdds === null || homeOdds >= minLegOdds)) { seen.add(hk); legs.push({ name: `${g.home} ${g.home_line}`, dk: homeOdds, bestOpp: g.bestOpp_home, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.bestOppCount_home, bestOppName: g.bestOppName_home }); }
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
      if (!seen.has(ok) && (minLegOdds === null || overOdds >= minLegOdds)) { seen.add(ok); legs.push({ name: `${g.away}/${g.home} o${g.line}`, dk: overOdds, bestOpp: g.bestOpp_over, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.bestOppCount_over, bestOppName: g.bestOppName_over }); }
      if (!seen.has(uk) && (minLegOdds === null || underOdds >= minLegOdds)) { seen.add(uk); legs.push({ name: `${g.away}/${g.home} u${g.line}`, dk: underOdds, bestOpp: g.bestOpp_under, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppCount: g.bestOppCount_under, bestOppName: g.bestOppName_under }); }
    });
  }

  return legs;
}

function buildAllLegsAllBooks(data, sportFilter = null) {
  const now = new Date();
  const seen = new Set();
  const legs = [];

  ALL_BOOKS.forEach(book => {
    if (data.moneylines) {
      data.moneylines.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        const awayOdds = g.bookOdds?.[book.key]?.ml_away;
        const homeOdds = g.bookOdds?.[book.key]?.ml_home;
        if (awayOdds == null || homeOdds == null) return;
        const ak = `${g.away}@${g.home}_ML_away_${book.key}`;
        const hk = `${g.away}@${g.home}_ML_home_${book.key}`;
        if (!seen.has(ak)) { seen.add(ak); legs.push({ name: `${g.away} ML`, dk: awayOdds, bestOpp: g.best_home, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.ml_opp_count_away, bestOppName: `${g.home} ML` }); }
        if (!seen.has(hk)) { seen.add(hk); legs.push({ name: `${g.home} ML`, dk: homeOdds, bestOpp: g.best_away, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.ml_opp_count_home, bestOppName: `${g.away} ML` }); }
      });
    }
    if (data.run_lines) {
      data.run_lines.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.book !== book.key) return;
        const awayOdds = g.away_odds;
        const homeOdds = g.home_odds;
        if (awayOdds == null || homeOdds == null) return;
        const ak = `${g.away}@${g.home}_SPR_away_${g.away_line}_${book.key}`;
        const hk = `${g.away}@${g.home}_SPR_home_${g.home_line}_${book.key}`;
        if (!seen.has(ak)) { seen.add(ak); legs.push({ name: `${g.away} ${g.away_line}`, dk: awayOdds, bestOpp: g.bestOpp_away, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.bestOppCount_away, bestOppName: g.bestOppName_away }); }
        if (!seen.has(hk)) { seen.add(hk); legs.push({ name: `${g.home} ${g.home_line}`, dk: homeOdds, bestOpp: g.bestOpp_home, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.bestOppCount_home, bestOppName: g.bestOppName_home }); }
      });
    }
    if (data.totals) {
      data.totals.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.book !== book.key) return;
        const overOdds = g.over_odds;
        const underOdds = g.under_odds;
        if (overOdds == null || underOdds == null) return;
        const ok = `${g.away}@${g.home}_TOT_over_${g.line}_${book.key}`;
        const uk = `${g.away}@${g.home}_TOT_under_${g.line}_${book.key}`;
        if (!seen.has(ok)) { seen.add(ok); legs.push({ name: `${g.away}/${g.home} o${g.line}`, dk: overOdds, bestOpp: g.bestOpp_over, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.bestOppCount_over, bestOppName: g.bestOppName_over }); }
        if (!seen.has(uk)) { seen.add(uk); legs.push({ name: `${g.away}/${g.home} u${g.line}`, dk: underOdds, bestOpp: g.bestOpp_under, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppCount: g.bestOppCount_under, bestOppName: g.bestOppName_under }); }
      });
    }
  });

  return legs;
}

function findTopParlays(legs, numLegs, boostPct, stake, maxResults = 10, minFinalOdds = null) {
  const results = [];
  const getGame = (leg) => leg.game;

  if (numLegs === 1) {
    legs.forEach(l => {
      const r = calcParlayEV([l], boostPct, stake);
      if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) return;
      results.push({ legs: [l], ...r });
    });
  } else if (numLegs === 2) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (getGame(legs[i]) === getGame(legs[j])) continue;
        const r = calcParlayEV([legs[i], legs[j]], boostPct, stake);
        if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
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
          if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
          results.push({ legs: [legs[i], legs[j], legs[k]], ...r });
        }
      }
    }
  }

  results.sort((a, b) => b.ev - a.ev);
  return results.slice(0, maxResults);
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function EVBadge({ ev }) {
  const color = ev > 10 ? "#10b981" : ev > 5 ? "#f59e0b" : ev > 0 ? "#6b7280" : "#ef4444";
  const bg = ev > 10 ? "rgba(16,185,129,0.12)" : ev > 5 ? "rgba(245,158,11,0.12)" : ev > 0 ? "rgba(107,114,128,0.12)" : "rgba(239,68,68,0.12)";
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color, background: bg }}>
      {ev > 0 ? "+" : ""}{ev.toFixed(1)}%
    </span>
  );
}

function SportBadge({ sport }) {
  const s = SPORTS.find(x => x.key === sport);
  const colors = { basketball_nba: "#f97316", baseball_mlb: "#3b82f6", icehockey_nhl: "#8b5cf6" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: colors[sport] || "#6b7280", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 }}>
      {s?.label || sport}
    </span>
  );
}

function OddsBoard({ oddsData }) {
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(new Set(ALL_BOOKS.map(b => b.key)));
  const [boardSport, setBoardSport] = useState("baseball_mlb");
  const now = new Date();

  const games = (oddsData.moneylines || []).filter(g =>
    g.sport === boardSport && new Date(g.commence_time) > now
  );

  const filteredGames = games.filter(g => {
    const q = search.toLowerCase();
    return g.away.toLowerCase().includes(q) || g.home.toLowerCase().includes(q);
  });

  const grouped = {};
  filteredGames.forEach(g => {
    const dateKey = formatDateGroup(g.commence_time);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(g);
  });

  const toggleBook = (bookKey) => {
    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (next.has(bookKey)) {
        if (next.size === 1) return prev;
        next.delete(bookKey);
      } else {
        next.add(bookKey);
      }
      return next;
    });
  };

  const getCell = (game, bookKey) => {
    if (bookKey === "best") {
      const vals = ALL_BOOKS.filter(b => selectedBooks.has(b.key));
      if (market === "ml") {
        const bestAway = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.ml_away).filter(v => v != null));
        const bestHome = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.ml_home).filter(v => v != null));
        return { top: isFinite(bestAway) ? bestAway : null, bot: isFinite(bestHome) ? bestHome : null, topLine: null, botLine: null };
      }
      if (market === "spr") {
        const bestAway = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.spr_away).filter(v => v != null));
        const bestHome = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.spr_home).filter(v => v != null));
        const dkb = game.bookOdds?.draftkings;
        return { top: isFinite(bestAway) ? bestAway : null, bot: isFinite(bestHome) ? bestHome : null, topLine: dkb?.spr_away_line != null ? (dkb.spr_away_line > 0 ? `+${dkb.spr_away_line}` : `${dkb.spr_away_line}`) : null, botLine: dkb?.spr_home_line != null ? (dkb.spr_home_line > 0 ? `+${dkb.spr_home_line}` : `${dkb.spr_home_line}`) : null };
      }
      if (market === "tot") {
        const bestOver = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.tot_over).filter(v => v != null));
        const bestUnder = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.tot_under).filter(v => v != null));
        const dkb = game.bookOdds?.draftkings;
        return { top: isFinite(bestOver) ? bestOver : null, bot: isFinite(bestUnder) ? bestUnder : null, topLine: dkb?.tot_line ? `o${dkb.tot_line}` : null, botLine: dkb?.tot_line ? `u${dkb.tot_line}` : null };
      }
    }
    const b = game.bookOdds?.[bookKey];
    if (!b) return { top: null, bot: null, topLine: null, botLine: null };
    if (market === "ml") return { top: b.ml_away, bot: b.ml_home, topLine: null, botLine: null };
    if (market === "spr") return { top: b.spr_away, bot: b.spr_home, topLine: b.spr_away_line != null ? (b.spr_away_line > 0 ? `+${b.spr_away_line}` : `${b.spr_away_line}`) : null, botLine: b.spr_home_line != null ? (b.spr_home_line > 0 ? `+${b.spr_home_line}` : `${b.spr_home_line}`) : null };
    if (market === "tot") return { top: b.tot_over, bot: b.tot_under, topLine: b.tot_line ? `o${b.tot_line}` : null, botLine: b.tot_line ? `u${b.tot_line}` : null };
    return { top: null, bot: null, topLine: null, botLine: null };
  };

  const getBestForGame = (game) => {
    let bestAway = null, bestHome = null;
    ALL_BOOKS.forEach(b => {
      if (!selectedBooks.has(b.key)) return;
      const cell = getCell(game, b.key);
      if (cell.top !== null && (bestAway === null || cell.top > bestAway)) bestAway = cell.top;
      if (cell.bot !== null && (bestHome === null || cell.bot > bestHome)) bestHome = cell.bot;
    });
    return { bestAway, bestHome };
  };

  const visibleBooks = [{ key: "best", label: "Best Odds" }, ...ALL_BOOKS.filter(b => selectedBooks.has(b.key))];
  const teamColWidth = 170;
  const oddsColWidth = 88;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => setBoardSport(s.key)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: boardSport === s.key ? "#3b82f6" : "rgba(255,255,255,0.05)", color: boardSport === s.key ? "#fff" : "#6b7280" }}>
            {s.label}
          </button>
        ))}
      </div>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search team or matchup..." style={{ width: "100%", maxWidth: 400, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8eaed", padding: "10px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["ml", "spr", "tot"].map(m => (
          <button key={m} onClick={() => setMarket(m)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: market === m ? "#3b82f6" : "rgba(255,255,255,0.05)", color: market === m ? "#fff" : "#6b7280" }}>
            {m === "ml" ? "Moneyline" : m === "spr" ? "Spread" : "Totals"}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        {ALL_BOOKS.map(b => (
          <button key={b.key} onClick={() => toggleBook(b.key)} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: selectedBooks.has(b.key) ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: selectedBooks.has(b.key) ? "#3b82f6" : "#4b5563", border: selectedBooks.has(b.key) ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>
            {b.label}
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + visibleBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>Game</th>
              {visibleBooks.map(b => (
                <th key={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(grouped).length === 0 && (
              <tr><td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>No games found{search ? ` for "${search}"` : ""}</td></tr>
            )}
            {Object.entries(grouped).map(([dateKey, dateGames]) => (
              <>
                <tr key={dateKey + "_h"} style={{ background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>{dateKey}</td>
                </tr>
                {dateGames.map((game, gi) => {
                  const { bestAway, bestHome } = getBestForGame(game);
                  return (
                    <tr key={gi} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 0, width: teamColWidth, position: "sticky", left: 0, background: "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ padding: "8px 16px 4px" }}>
                          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>{new Date(game.commence_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })} ET</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", marginBottom: 6 }}>{game.away}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{game.home}</div>
                        </div>
                      </td>
                      {visibleBooks.map(b => {
                        const cell = getCell(game, b.key);
                        const isBestAway = b.key !== "best" && cell.top !== null && cell.top === bestAway;
                        const isBestHome = b.key !== "best" && cell.bot !== null && cell.bot === bestHome;
                        const isBestCol = b.key === "best";
                        return (
                          <td key={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <div style={{ padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.03)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: cell.top === null ? "#2d3748" : (isBestCol || isBestAway) ? "#10b981" : "#e8eaed", background: isBestAway ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                {cell.topLine && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{cell.topLine}</div>}
                                {formatOdds(cell.top)}
                              </div>
                              <div style={{ padding: "8px 6px", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: cell.bot === null ? "#2d3748" : (isBestCol || isBestHome) ? "#10b981" : "#e8eaed", background: isBestHome ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                {cell.botLine && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{cell.botLine}</div>}
                                {formatOdds(cell.bot)}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 12 }}>✅ Green = best available odds for that side across selected books</div>
    </div>
  );
}

export default function App() {
  const [allOddsData, setAllOddsData] = useState({ moneylines: [], run_lines: [], totals: [] });
  const [activeTab, setActiveTab] = useState("promo");
  const [boostPct, setBoostPct] = useState(30);
  const [stake, setStake] = useState(100);
  const [numLegs, setNumLegs] = useState(3);
  const [minFinalOdds, setMinFinalOdds] = useState("");
  const [minLegOdds, setMinLegOdds] = useState("");
  const [promoDateRange, setPromoDateRange] = useState("any");
  const [promoPage, setPromoPage] = useState(5);
  const [expandedPromo, setExpandedPromo] = useState(null);
  const [expandedEV, setExpandedEV] = useState(null);
  const [promoBook, setPromoBook] = useState("draftkings");
  const [promoSports, setPromoSports] = useState(new Set(["basketball_nba", "baseball_mlb", "icehockey_nhl"]));
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchOdds() {
      setDataLoading(true);
      const { data, error } = await supabase
        .from("odds_cache")
        .select("*")
        .in("sport", ["basketball_nba", "baseball_mlb", "icehockey_nhl"]);
      if (error || !data) { setDataLoading(false); return; }
      const transformed = data.map(row => transformOddsData(row.data, row.sport));
      setAllOddsData(mergeOddsData(transformed));
      setFetchedAt(data[0]?.fetched_at);
      setDataLoading(false);
    }
    fetchOdds();
  }, []);

  // Reset pagination and expanded state when any promo param changes
  useEffect(() => {
    setPromoPage(5);
    setExpandedPromo(null);
  }, [promoBook, promoSports, promoDateRange, boostPct, stake, numLegs, minFinalOdds, minLegOdds]);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const allEvLegs = buildAllLegsAllBooks(allOddsData, null);
  const evBets = allEvLegs.map(l => {
    const { prob, ev, profit } = calcEV(l.dk, l.bestOpp);
    return { ...l, prob, ev, profit };
  }).sort((a, b) => b.ev - a.ev);
  const positiveEV = evBets.filter(b => b.ev > 0);

  const promoSportFilter = promoSports.size === 3 ? null : [...promoSports];
  const parsedMinLeg = minLegOdds !== "" ? Number(minLegOdds) : null;
  const promoLegs = buildAllLegsForBook(allOddsData, promoBook, promoSportFilter, parsedMinLeg, promoDateRange);
  const parsedMinFinal = minFinalOdds !== "" ? Number(minFinalOdds) : null;
  const topParlays = findTopParlays(promoLegs, numLegs, boostPct, stake, 10, parsedMinFinal);

  const topParlaysWithHedge = useMemo(() => {
    return topParlays.map(p => {
      const hedgeLegs = p.legs.map(l => ({ name: l.name, bestOpp: l.bestOpp }));
      const hedgeResult = solveHedgesAnalytical(hedgeLegs, stake, p.boostedProfit);
      return { ...p, hedgeLegs, hedgeResult, isGuaranteed: hedgeResult.isGuaranteed };
    });
  }, [topParlays, stake, boostPct]);

  const togglePromoSport = (sportKey) => {
    setPromoSports(prev => {
      const next = new Set(prev);
      if (next.has(sportKey)) {
        if (next.size === 1) return prev;
        next.delete(sportKey);
      } else {
        next.add(sportKey);
      }
      return next;
    });
  };

  const tabStyle = (tab) => ({
    padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600,
    color: activeTab === tab ? "#f0f0f0" : "#6b7280",
    background: "none", border: "none",
    borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
    transition: "all 0.2s",
  });

  const controlBox = (children) => (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
      {children}
    </div>
  );

  const labelStyle = { fontSize: 13, fontWeight: 600, color: "#8a8f98" };
  const activePromoBookData = ALL_BOOKS.find(b => b.key === promoBook) || ALL_BOOKS[0];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0b0f", color: "#e8eaed", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {!authLoading && !user && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,11,15,0.85)", backdropFilter: "blur(8px)" }}>
          <div style={{ background: "linear-gradient(135deg, rgba(30,32,44,0.98), rgba(20,22,32,0.98))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "48px 40px", textAlign: "center", maxWidth: 420, width: "90%", boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, margin: "0 auto 20px" }}>B</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: -0.5 }}>AI Bet Builder</h1>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 8px" }}>Powered by Claude</p>
            <p style={{ fontSize: 15, color: "#9ca3af", margin: "0 0 28px", lineHeight: 1.6 }}>Find the best +EV plays for your sportsbook promotions. Analyze boosts, build optimal parlays, and maximize your edge.</p>
            <button onClick={signInWithGoogle} style={{ background: "#fff", color: "#333", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%" }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google — It's Free
            </button>
            <p style={{ fontSize: 12, color: "#4b5563", margin: "16px 0 0" }}>No credit card required.</p>
          </div>
        </div>
      )}

      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>AI Bet Builder</div>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>Powered by Claude</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {fetchedAt && <div style={{ fontSize: 11, color: "#4b5563" }}>Updated {new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })} ET</div>}
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={user.user_metadata?.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)" }} />
              <button onClick={signOut} style={{ background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
            </div>
          ) : (
            <button onClick={signInWithGoogle} style={{ background: "#fff", color: "#333", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign in with Google</button>
          )}
        </div>
      </div>

      <div style={{ padding: "24px 32px 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="Total Bets Analyzed" value={dataLoading ? "..." : allEvLegs.length} sub="all sports & books" />
        <StatCard label="+EV Bets Found" value={dataLoading ? "..." : positiveEV.length} color="#10b981" />
        <StatCard label="Best Single EV" value={dataLoading ? "..." : evBets[0] ? `+$${evBets[0].ev.toFixed(2)}` : "--"} color="#3b82f6" sub={evBets[0] ? evBets[0].name : ""} />
      </div>

      <div style={{ padding: "20px 32px 0", display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button style={tabStyle("promo")} onClick={() => setActiveTab("promo")}>Promo Builder</button>
        <button style={tabStyle("ev")} onClick={() => setActiveTab("ev")}>+EV Bets</button>
        <button style={tabStyle("odds")} onClick={() => setActiveTab("odds")}>Odds Board</button>
      </div>

      {dataLoading && (
        <div style={{ padding: "60px 32px", textAlign: "center", color: "#4b5563" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14 }}>Loading live odds...</div>
        </div>
      )}

      {!dataLoading && (
        <div style={{ padding: "20px 32px" }}>

          {activeTab === "odds" && <OddsBoard oddsData={allOddsData} />}

          {activeTab === "ev" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                All bets ranked by EV across all sportsbooks and sports. True probability from best opposing odds at matching lines.
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                  <div>Bet</div>
                  <div style={{ textAlign: "center" }}>Sportsbook</div>
                  <div style={{ textAlign: "center" }}>Odds</div>
                  <div style={{ textAlign: "center" }}>True Prob</div>
                  <div style={{ textAlign: "center" }}>Implied</div>
                  <div style={{ textAlign: "center" }}>Edge</div>
                  <div style={{ textAlign: "center" }}>EV ($100)</div>
                </div>
                {evBets.slice(0, 30).map((b, i) => {
                  const bookImplied = impliedProb(b.dk);
                  const edge = b.prob - bookImplied;
                  const isExpanded = expandedEV === i;
                  const profit = (dkDecimal(b.dk) - 1) * 100;
                  const trueProbAm = probToAmerican(b.prob);
                  return (
                    <div key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", cursor: "pointer" }}
                      onClick={() => setExpandedEV(isExpanded ? null : i)}>
                      <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1fr 1fr 1fr 1fr", padding: "14px 20px", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                            <SportBadge sport={b.sport} />
                            <span style={{ fontSize: 11, color: "#6b7280" }}>{b.market} — {b.game}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{formatET(b.commence_time)}</div>
                          <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 2 }}>{isExpanded ? "▲ collapse" : "▼ breakdown"}</div>
                        </div>
                        <div style={{ textAlign: "center" }}><BookBadge bookKey={b.bookKey} /></div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: b.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(b.dk)}</div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{(b.prob * 100).toFixed(1)}%</div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#6b7280" }}>{(bookImplied * 100).toFixed(1)}%</div>
                        <div style={{ textAlign: "center" }}><EVBadge ev={edge * 100} /></div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "+" : ""}${b.ev.toFixed(2)}</div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 20px", background: "rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>True Win Prob</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>{(b.prob * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>({trueProbAm > 0 ? "+" : ""}{trueProbAm} fair odds)</div>
                              {b.bestOppCount != null && b.bestOppName && (
                                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{b.bestOppCount} {b.bestOppCount === 1 ? "line" : "lines"} @ {b.bestOppName}</div>
                              )}
                            </div>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Book Implied</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: "#e8eaed" }}>{(bookImplied * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>({formatOdds(b.dk)} odds)</div>
                            </div>
                            <div style={{ background: edge > 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${edge > 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Your Edge</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: edge > 0 ? "#10b981" : "#ef4444" }}>{edge > 0 ? "+" : ""}{(edge * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{edge > 0 ? "Book is underpricing this" : "Book has the edge here"}</div>
                            </div>
                          </div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 }}>
                            <div>Win <strong style={{ color: "#10b981" }}>${profit.toFixed(2)}</strong> × <strong style={{ color: "#f59e0b" }}>{(b.prob * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(profit * b.prob).toFixed(2)}</strong></div>
                            <div>Lose <strong style={{ color: "#ef4444" }}>$100</strong> × <strong style={{ color: "#f59e0b" }}>{((1 - b.prob) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>-${(100 * (1 - b.prob)).toFixed(2)}</strong></div>
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = ${(profit * b.prob).toFixed(2)} - ${(100 * (1 - b.prob)).toFixed(2)} = <strong style={{ color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "+" : ""}${b.ev.toFixed(2)}</strong></div>
                          </div>
                          <div style={{ fontSize: 13, color: "#9ca3af", padding: "10px 16px", background: b.ev > 0 ? "rgba(16,185,129,0.04)" : "rgba(239,68,68,0.04)", borderRadius: 8, border: `1px solid ${b.ev > 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)"}` }}>
                            <strong style={{ color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "✓ Positive EV:" : "✗ Negative EV:"}</strong>{" "}
                            {b.ev > 0 ? `This bet wins ${(b.prob * 100).toFixed(1)}% of the time but the book is only pricing it at ${(bookImplied * 100).toFixed(1)}%. Expected profit of +$${b.ev.toFixed(2)} per $100 bet.` : `This bet wins ${(b.prob * 100).toFixed(1)}% of the time but the book has the edge at ${(bookImplied * 100).toFixed(1)}% implied. Avoid this bet.`}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "promo" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Configure your boost and find the optimal parlay legs ranked by expected value.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                {controlBox(<>
                  <label style={labelStyle}>Sportsbook</label>
                  <select value={promoBook} onChange={e => { setPromoBook(e.target.value); }} style={{ background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: activePromoBookData.color, padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, cursor: "pointer" }}>
                    {ALL_BOOKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Sports</label>
                  {SPORTS.map(s => (
                    <button key={s.key} onClick={() => togglePromoSport(s.key)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: promoSports.has(s.key) ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: promoSports.has(s.key) ? "#3b82f6" : "#6b7280" }}>
                      {s.label}
                    </button>
                  ))}
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Date</label>
                  {DATE_RANGES.map(opt => (
                    <button key={opt.val} onClick={() => setPromoDateRange(opt.val)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: promoDateRange === opt.val ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: promoDateRange === opt.val ? "#3b82f6" : "#6b7280" }}>
                      {opt.label}
                    </button>
                  ))}
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Boost %</label>
                  <input type="number" value={boostPct} onChange={(e) => setBoostPct(Number(e.target.value))} style={{ width: 60, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Stake $</label>
                  <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} style={{ width: 70, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Legs</label>
                  {[1, 2, 3].map(n => (
                    <button key={n} onClick={() => setNumLegs(n)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: numLegs === n ? "#3b82f6" : "rgba(255,255,255,0.05)", color: numLegs === n ? "#fff" : "#6b7280" }}>{n}</button>
                  ))}
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Min Final Odds</label>
                  <input type="number" value={minFinalOdds} onChange={(e) => setMinFinalOdds(e.target.value)} placeholder="e.g. 400" style={{ width: 80, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </>)}
                {numLegs >= 2 && controlBox(<>
                  <label style={labelStyle}>Min Leg Odds</label>
                  <input type="number" value={minLegOdds} onChange={(e) => setMinLegOdds(e.target.value)} placeholder="e.g. -200" style={{ width: 80, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </>)}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {topParlaysWithHedge.length === 0 && (
                  <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>No Results Found</div>
                    <div style={{ fontSize: 13, color: "#9ca3af" }}>Try adjusting your filters.</div>
                  </div>
                )}
                {topParlaysWithHedge.slice(0, promoPage).map((p, i) => {
                  const isExpanded = expandedPromo === i;
                  const trueParlayOdds = probToAmerican(p.combinedProb);
                  const boostedOdds = Math.round((p.boostedProfit / stake) * 100);

                  return (
                    <div key={i} style={{ background: i === 0 ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
                      onClick={() => setExpandedPromo(isExpanded ? null : i)}>
                      <div style={{ padding: "20px 24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: i === 0 ? "#3b82f6" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: i === 0 ? "#fff" : "#6b7280" }}>{i + 1}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1 }}>{i === 0 ? "★ Best Pick" : `Option ${i + 1}`}</div>
                          </div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: p.ev > 0 ? "#10b981" : "#ef4444" }}>+${p.ev.toFixed(2)} EV</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                          {p.legs.map((l, li) => (
                            <div key={li} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 14px", flex: 1, minWidth: 150 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>{l.market}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: l.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(l.dk)}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{formatET(l.commence_time)}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8a8f98", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                          <span>{activePromoBookData.label} Parlay: <strong style={{ color: "#e8eaed" }}>+{p.parlayOdds}</strong></span>
                          <span>With Boost: <strong style={{ color: "#10b981" }}>+{boostedOdds}</strong></span>
                          <span>True Odds: <strong style={{ color: "#f59e0b" }}>{trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds}</strong></span>
                          <span>EV: <strong style={{ color: "#10b981" }}>+{(p.ev / stake * 100).toFixed(1)}%</strong></span>
                        </div>

                        {p.isGuaranteed && (
                          <div onClick={e => e.stopPropagation()}>
                            <GuaranteedBadge
                              legs={p.hedgeLegs}
                              numLegs={p.legs.length}
                              stake={stake}
                              boostedProfit={p.boostedProfit}
                              ev={p.ev}
                              hedgeResult={p.hedgeResult}
                            />
                          </div>
                        )}
                      </div>

                      {isExpanded && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px", background: "rgba(0,0,0,0.2)" }}
                          onClick={e => e.stopPropagation()}>
                          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.2fr 0.8fr", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                              <div>Leg</div>
                              <div style={{ textAlign: "center" }}>True Win Prob</div>
                              <div style={{ textAlign: "center" }}>{activePromoBookData.label} Odds</div>
                              <div style={{ textAlign: "center" }}>Edge</div>
                            </div>
                            {p.legs.map((l, li) => {
                              const tp = ourTrueProb(l.bestOpp);
                              const bookImpl = impliedProb(l.dk);
                              const edge = tp - bookImpl;
                              const tpAm = probToAmerican(tp);
                              return (
                                <div key={li} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.2fr 0.8fr", padding: "12px 16px", borderBottom: li < p.legs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", alignItems: "center", background: li % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{l.name}</div>
                                  <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>
                                    {tpAm > 0 ? "+" : ""}{tpAm} ({(tp * 100).toFixed(1)}%)
                                  </div>
                                  <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{formatOdds(l.dk)}</div>
                                  <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: edge >= 0 ? "#10b981" : "#ef4444" }}>{edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}%</div>
                                </div>
                              );
                            })}
                            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.2fr 0.8fr", padding: "12px 16px", borderTop: "2px solid rgba(255,255,255,0.1)", alignItems: "center", background: "rgba(255,255,255,0.03)" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>
                                Parlay Total <span style={{ color: "#10b981", marginLeft: 6 }}>(+{boostedOdds} w/ boost)</span>
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>
                                {trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds} ({(p.combinedProb * 100).toFixed(1)}%)
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>+{p.parlayOdds}</div>
                              <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#10b981" }}>+{(p.ev / stake * 100).toFixed(1)}%</div>
                            </div>
                          </div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 }}>
                            <div>Win <strong style={{ color: "#10b981" }}>${p.boostedProfit.toFixed(0)}</strong> × <strong style={{ color: "#f59e0b" }}>{(p.combinedProb * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(p.boostedProfit * p.combinedProb).toFixed(2)}</strong></div>
                            <div>Lose <strong style={{ color: "#ef4444" }}>${stake}</strong> × <strong style={{ color: "#f59e0b" }}>{((1 - p.combinedProb) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>-${(stake * (1 - p.combinedProb)).toFixed(2)}</strong></div>
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong></div>
                          </div>
                          <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
                            <strong style={{ color: "#10b981" }}>Bottom line:</strong> This parlay has a {(p.combinedProb * 100).toFixed(1)}% chance of hitting and pays <strong style={{ color: "#e8eaed" }}>${(p.boostedProfit + stake).toFixed(0)}</strong> with your boost. Expected profit: <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong> on a ${stake} bet.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Show more button */}
                {topParlaysWithHedge.length > promoPage && (
                  <button
                    onClick={() => setPromoPage(prev => prev + 5)}
                    style={{ width: "100%", padding: "14px", marginTop: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                    onMouseEnter={e => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "#9ca3af"; }}
                    onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.color = "#6b7280"; }}
                  >
                    Show more ({topParlaysWithHedge.length - promoPage} remaining)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "20px 32px", borderTop: "1px solid rgba(255,255,255,0.06)", textAlign: "center", fontSize: 11, color: "#4b5563" }}>
        AI Bet Builder — aibetbuilder.io — For informational purposes only. Not financial advice. Please gamble responsibly.
      </div>
    </div>
  );
}
