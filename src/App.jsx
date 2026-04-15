import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Transform Odds API format into app format
function transformOddsData(gamesArray) {
  const moneylines = [];
  const spreads = [];
  const totals = [];

  gamesArray.forEach(game => {
    const away = game.away_team;
    const home = game.home_team;
    const bookmakers = game.bookmakers || [];

    const getOdds = (bookKey, marketKey, teamName, prop = "price") => {
      const book = bookmakers.find(b => b.key === bookKey);
      if (!book) return null;
      const market = book.markets.find(m => m.key === marketKey);
      if (!market) return null;
      const outcome = market.outcomes.find(o => o.name === teamName);
      return outcome ? outcome[prop] : null;
    };

    const getBestOdds = (marketKey, teamName, prop = "price") => {
      let best = null;
      bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketKey);
        if (!market) return;
        const outcome = market.outcomes.find(o => o.name === teamName);
        if (!outcome) return;
        const val = outcome[prop];
        if (val === null || val === undefined) return;
        if (best === null || val > best) best = val;
      });
      return best;
    };

    // Moneylines
    const ml = {
      away,
      home,
      dk_away: getOdds("draftkings", "h2h", away),
      dk_home: getOdds("draftkings", "h2h", home),
      fd_away: getOdds("fanduel", "h2h", away),
      fd_home: getOdds("fanduel", "h2h", home),
      cs_away: getOdds("williamhill_us", "h2h", away),
      cs_home: getOdds("williamhill_us", "h2h", home),
      mgm_away: getOdds("betmgm", "h2h", away),
      mgm_home: getOdds("betmgm", "h2h", home),
      best_away: getBestOdds("h2h", away),
      best_home: getBestOdds("h2h", home),
    };
    if (ml.dk_away !== null || ml.dk_home !== null) moneylines.push(ml);

    // Spreads
    const dkSpreadAway = bookmakers.find(b => b.key === "draftkings")
      ?.markets.find(m => m.key === "spreads")
      ?.outcomes.find(o => o.name === away);
    const dkSpreadHome = bookmakers.find(b => b.key === "draftkings")
      ?.markets.find(m => m.key === "spreads")
      ?.outcomes.find(o => o.name === home);

    if (dkSpreadAway && dkSpreadHome) {
      const getBestSpread = (teamName) => {
        let best = null;
        bookmakers.forEach(book => {
          const market = book.markets.find(m => m.key === "spreads");
          if (!market) return;
          const outcome = market.outcomes.find(o => o.name === teamName);
          if (!outcome) return;
          if (best === null || outcome.price > best) best = outcome.price;
        });
        return best;
      };

      spreads.push({
        away,
        home,
        dk_away_line: `${dkSpreadAway.point > 0 ? "+" : ""}${dkSpreadAway.point}`,
        dk_home_line: `${dkSpreadHome.point > 0 ? "+" : ""}${dkSpreadHome.point}`,
        dk_away: dkSpreadAway.price,
        dk_home: dkSpreadHome.price,
        fd_away: getOdds("fanduel", "spreads", away),
        fd_home: getOdds("fanduel", "spreads", home),
        cs_away: getOdds("williamhill_us", "spreads", away),
        cs_home: getOdds("williamhill_us", "spreads", home),
        mgm_away: getOdds("betmgm", "spreads", away),
        mgm_home: getOdds("betmgm", "spreads", home),
        best_away: getBestSpread(away),
        best_home: getBestSpread(home),
      });
    }

    // Totals
    const dkTotals = bookmakers.find(b => b.key === "draftkings")
      ?.markets.find(m => m.key === "totals");
    if (dkTotals) {
      const dkOver = dkTotals.outcomes.find(o => o.name === "Over");
      const dkUnder = dkTotals.outcomes.find(o => o.name === "Under");
      const dkLine = dkOver?.point;

      const getBestTotal = (side) => {
        let best = null;
        bookmakers.forEach(book => {
          const market = book.markets.find(m => m.key === "totals");
          if (!market) return;
          const outcome = market.outcomes.find(o => o.name === side);
          if (!outcome) return;
          if (best === null || outcome.price > best) best = outcome.price;
        });
        return best;
      };

      // Check if all books have same line
      const allLines = bookmakers.map(b => {
        const m = b.markets.find(m => m.key === "totals");
        return m?.outcomes.find(o => o.name === "Over")?.point;
      }).filter(Boolean);
      const linesMatch = allLines.every(l => l === dkLine);

      totals.push({
        away,
        home,
        dk_line: dkLine,
        best_line: dkLine,
        dk_over: dkOver?.price,
        dk_under: dkUnder?.price,
        fd_line: getOdds("fanduel", "totals", "Over", "point"),
        fd_over: getOdds("fanduel", "totals", "Over"),
        fd_under: getOdds("fanduel", "totals", "Under"),
        cs_line: getOdds("williamhill_us", "totals", "Over", "point"),
        cs_over: getOdds("williamhill_us", "totals", "Over"),
        cs_under: getOdds("williamhill_us", "totals", "Under"),
        mgm_line: getOdds("betmgm", "totals", "Over", "point"),
        mgm_over: getOdds("betmgm", "totals", "Over"),
        mgm_under: getOdds("betmgm", "totals", "Under"),
        best_over: getBestTotal("Over"),
        best_under: getBestTotal("Under"),
        match: linesMatch,
      });
    }
  });

  return { moneylines, run_lines: spreads, totals };
}

function trueProb(bestOpponentOdds) {
  if (!bestOpponentOdds) return 0.5;
  let oppImplied;
  if (bestOpponentOdds < 0) {
    oppImplied = Math.abs(bestOpponentOdds) / (Math.abs(bestOpponentOdds) + 100);
  } else {
    oppImplied = 100 / (bestOpponentOdds + 100);
  }
  return 1 - oppImplied;
}

function dkDecimal(odds) {
  if (!odds) return 1;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

function formatOdds(odds) {
  if (!odds) return "N/A";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function probToAmerican(prob) {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  } else {
    return Math.round(100 * (1 - prob) / prob);
  }
}

function formatProbAmerican(prob) {
  const am = probToAmerican(prob);
  return am > 0 ? `+${am}` : `${am}`;
}

function calcEV(dkOdds, bestOpponentOdds) {
  const prob = trueProb(bestOpponentOdds);
  const dec = dkDecimal(dkOdds);
  const profit = (dec - 1) * 100;
  const ev = (prob * profit) - ((1 - prob) * 100);
  return { prob, ev, profit };
}

function calcParlayEV(legs, boostPct, stake) {
  let parlayDec = 1;
  let combinedProb = 1;
  legs.forEach(l => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= trueProb(l.bestOpp);
  });
  const boostedProfit = (parlayDec - 1) * stake * (1 + boostPct / 100);
  const ev = (combinedProb * boostedProfit) - ((1 - combinedProb) * stake);
  return { parlayDec, combinedProb, boostedProfit, ev, parlayOdds: Math.round((parlayDec - 1) * 100) };
}

function buildAllLegs(data, book = "dk") {
  const legs = [];
  if (data.moneylines) {
    data.moneylines.forEach(g => {
      const awayOdds = g[book + "_away"];
      const homeOdds = g[book + "_home"];
      if (awayOdds == null || homeOdds == null) return;
      legs.push({ name: `${g.away} ML`, dk: awayOdds, bestOpp: g.best_home, market: "ML", game: `${g.away} @ ${g.home}` });
      legs.push({ name: `${g.home} ML`, dk: homeOdds, bestOpp: g.best_away, market: "ML", game: `${g.away} @ ${g.home}` });
    });
  }
  if (data.run_lines) {
    data.run_lines.forEach(g => {
      const awayOdds = g[book + "_away"] ?? g.dk_away;
      const homeOdds = g[book + "_home"] ?? g.dk_home;
      if (awayOdds == null || homeOdds == null) return;
      legs.push({ name: `${g.away} ${g.dk_away_line}`, dk: awayOdds, bestOpp: g.best_home, market: "SPR", game: `${g.away} @ ${g.home}` });
      legs.push({ name: `${g.home} ${g.dk_home_line}`, dk: homeOdds, bestOpp: g.best_away, market: "SPR", game: `${g.away} @ ${g.home}` });
    });
  }
  if (data.totals) {
    data.totals.forEach(g => {
      const bookOver = g[book + "_over"] ?? g.dk_over;
      const bookUnder = g[book + "_under"] ?? g.dk_under;
      const bookLine = g[book + "_line"] ?? g.dk_line;
      if (!g.match || bookOver == null || bookUnder == null) return;
      legs.push({ name: `${g.away}/${g.home} o${bookLine}`, dk: bookOver, bestOpp: g.best_under, market: "TOT", game: `${g.away} @ ${g.home}` });
      legs.push({ name: `${g.away}/${g.home} u${bookLine}`, dk: bookUnder, bestOpp: g.best_over, market: "TOT", game: `${g.away} @ ${g.home}` });
    });
  }
  return legs;
}

function findTopParlays(legs, numLegs, boostPct, stake, maxResults = 5, minFinalOdds = null, minLegOdds = null) {
  const results = [];
  const getGame = (leg) => leg.game;
  const filtered = (minLegOdds !== null && numLegs >= 2)
    ? legs.filter(l => l.dk >= minLegOdds)
    : legs;

  if (numLegs === 1) {
    filtered.forEach(l => {
      const r = calcParlayEV([l], boostPct, stake);
      if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) return;
      results.push({ legs: [l], ...r });
    });
  } else if (numLegs === 2) {
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        if (getGame(filtered[i]) === getGame(filtered[j])) continue;
        const r = calcParlayEV([filtered[i], filtered[j]], boostPct, stake);
        if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
        results.push({ legs: [filtered[i], filtered[j]], ...r });
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        if (getGame(filtered[i]) === getGame(filtered[j])) continue;
        for (let k = j + 1; k < filtered.length; k++) {
          if (getGame(filtered[k]) === getGame(filtered[i]) || getGame(filtered[k]) === getGame(filtered[j])) continue;
          const r = calcParlayEV([filtered[i], filtered[j], filtered[k]], boostPct, stake);
          if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
          results.push({ legs: [filtered[i], filtered[j], filtered[k]], ...r });
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

export default function App() {
  const [oddsData, setOddsData] = useState({ moneylines: [], run_lines: [], totals: [] });
  const [activeTab, setActiveTab] = useState("promo");
  const [boostPct, setBoostPct] = useState(30);
  const [stake, setStake] = useState(100);
  const [numLegs, setNumLegs] = useState(3);
  const [minFinalOdds, setMinFinalOdds] = useState("");
  const [minLegOdds, setMinLegOdds] = useState("");
  const [expandedCard, setExpandedCard] = useState(null);
  const [sportsbook, setSportsbook] = useState("dk");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [activeSport, setActiveSport] = useState("basketball_nba");

  const SPORTS = [
    { key: "basketball_nba", label: "NBA" },
    { key: "baseball_mlb", label: "MLB" },
    { key: "icehockey_nhl", label: "NHL" },
  ];

  const BOOKS = [
    { id: "dk", name: "DraftKings", color: "#53d769" },
    { id: "fd", name: "FanDuel", color: "#1493ff" },
    { id: "cs", name: "Caesars", color: "#d4a843" },
    { id: "mgm", name: "BetMGM", color: "#c4a962" },
  ];

  const activeBook = BOOKS.find(b => b.id === sportsbook) || BOOKS[0];

  // Auth
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

  // Fetch odds from Supabase
  useEffect(() => {
    async function fetchOdds() {
      setDataLoading(true);
      const { data, error } = await supabase
        .from("odds_cache")
        .select("*")
        .eq("sport", activeSport)
        .single();

      if (error || !data) {
        setDataLoading(false);
        return;
      }

      const transformed = transformOddsData(data.data);
      setOddsData(transformed);
      setFetchedAt(data.fetched_at);
      setDataLoading(false);
    }
    fetchOdds();
  }, [activeSport]);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const allLegs = buildAllLegs(oddsData, sportsbook);
  const evBets = allLegs.map(l => {
    const { prob, ev, profit } = calcEV(l.dk, l.bestOpp);
    return { ...l, prob, ev, profit };
  }).sort((a, b) => b.ev - a.ev);

  const positiveEV = evBets.filter(b => b.ev > 0);
  const parsedMinFinal = minFinalOdds !== "" ? Number(minFinalOdds) : null;
  const parsedMinLeg = minLegOdds !== "" ? Number(minLegOdds) : null;
  const topParlays = findTopParlays(allLegs, numLegs, boostPct, stake, 5, parsedMinFinal, parsedMinLeg);

  const tabStyle = (tab) => ({
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: activeTab === tab ? "#f0f0f0" : "#6b7280",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
    transition: "all 0.2s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0b0f", color: "#e8eaed", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Auth gate */}
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

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>AI Bet Builder</div>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>Powered by Claude</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {fetchedAt && <div style={{ fontSize: 11, color: "#4b5563" }}>Updated {new Date(fetchedAt).toLocaleTimeString()}</div>}
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

      {/* Sport selector */}
      <div style={{ padding: "16px 32px 0", display: "flex", gap: 8 }}>
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => { setActiveSport(s.key); setExpandedCard(null); }} style={{ padding: "8px 20px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: activeSport === s.key ? "#3b82f6" : "rgba(255,255,255,0.05)", color: activeSport === s.key ? "#fff" : "#6b7280" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ padding: "24px 32px 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="Total Bets Analyzed" value={dataLoading ? "..." : allLegs.length} sub="across all markets" />
        <StatCard label="+EV Bets Found" value={dataLoading ? "..." : positiveEV.length} color="#10b981" sub={allLegs.length > 0 ? `${(positiveEV.length / allLegs.length * 100).toFixed(0)}% of total` : ""} />
        <StatCard label="Best Single EV" value={dataLoading ? "..." : evBets[0] ? `+$${evBets[0].ev.toFixed(2)}` : "--"} color="#3b82f6" sub={evBets[0] ? `on $100 — ${evBets[0].name}` : ""} />
      </div>

      {/* Tabs */}
      <div style={{ padding: "20px 32px 0", display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button style={tabStyle("promo")} onClick={() => setActiveTab("promo")}>Promo Builder</button>
        <button style={tabStyle("ev")} onClick={() => setActiveTab("ev")}>+EV Bets</button>
      </div>

      {/* Loading state */}
      {dataLoading && (
        <div style={{ padding: "60px 32px", textAlign: "center", color: "#4b5563" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14 }}>Loading live odds...</div>
        </div>
      )}

      {/* Content */}
      {!dataLoading && (
        <div style={{ padding: "20px 32px" }}>

          {/* +EV Tab */}
          {activeTab === "ev" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Single bets ranked by expected value on a $100 stake. True probability derived from best opposing odds across all sportsbooks.</div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                  <div>Bet</div>
                  <div style={{ textAlign: "center" }}>{activeBook.name} Odds</div>
                  <div style={{ textAlign: "center" }}>True Prob</div>
                  <div style={{ textAlign: "center" }}>Implied</div>
                  <div style={{ textAlign: "center" }}>Edge</div>
                  <div style={{ textAlign: "center" }}>EV ($100)</div>
                </div>
                {evBets.slice(0, 20).map((b, i) => {
                  const dkImplied = b.dk > 0 ? 100 / (b.dk + 100) : Math.abs(b.dk) / (Math.abs(b.dk) + 100);
                  const edge = b.prob - dkImplied;
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "center", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{b.market} — {b.game}</div>
                      </div>
                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: b.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(b.dk)}</div>
                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{(b.prob * 100).toFixed(1)}%</div>
                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#6b7280" }}>{(dkImplied * 100).toFixed(1)}%</div>
                      <div style={{ textAlign: "center" }}><EVBadge ev={edge * 100} /></div>
                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "+" : ""}${b.ev.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Promo Tab */}
          {activeTab === "promo" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Configure your boost and find the optimal parlay legs ranked by expected value.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#8a8f98" }}>Sportsbook</label>
                  <select value={sportsbook} onChange={(e) => setSportsbook(e.target.value)} style={{ background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: activeBook.color, padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, cursor: "pointer" }}>
                    {BOOKS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#8a8f98" }}>Boost %</label>
                  <input type="number" value={boostPct} onChange={(e) => setBoostPct(Number(e.target.value))} style={{ width: 60, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#8a8f98" }}>Stake $</label>
                  <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} style={{ width: 70, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#8a8f98" }}>Legs</label>
                  {[1, 2, 3].map(n => (
                    <button key={n} onClick={() => setNumLegs(n)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: numLegs === n ? "#3b82f6" : "rgba(255,255,255,0.05)", color: numLegs === n ? "#fff" : "#6b7280" }}>{n}</button>
                  ))}
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#8a8f98" }}>Min Final Odds</label>
                  <input type="number" value={minFinalOdds} onChange={(e) => setMinFinalOdds(e.target.value)} placeholder="e.g. 400" style={{ width: 80, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {topParlays.length === 0 && (
                  <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>No Results Found</div>
                    <div style={{ fontSize: 13, color: "#9ca3af" }}>Try adjusting your filters or switching sports.</div>
                  </div>
                )}
                {topParlays.map((p, i) => {
                  const isExpanded = expandedCard === i;
                  const trueParlayOdds = probToAmerican(p.combinedProb);
                  const boostedOdds = Math.round((p.boostedProfit / stake) * 100);
                  return (
                    <div key={i} style={{ background: i === 0 ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer" }} onClick={() => setExpandedCard(isExpanded ? null : i)}>
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
                              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                <span style={{ fontSize: 12, color: "#6b7280" }}>{l.market}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: l.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(l.dk)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8a8f98", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                          <span>{activeBook.name} Parlay: <strong style={{ color: "#e8eaed" }}>+{p.parlayOdds}</strong></span>
                          <span>With Boost: <strong style={{ color: "#10b981" }}>+{boostedOdds}</strong></span>
                          <span>True Odds: <strong style={{ color: "#f59e0b" }}>{trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds}</strong></span>
                          <span>EV: <strong style={{ color: "#10b981" }}>+{(p.ev / stake * 100).toFixed(1)}%</strong></span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px", background: "rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                            <div>Win <strong style={{ color: "#10b981" }}>${p.boostedProfit.toFixed(0)}</strong> × <strong style={{ color: "#f59e0b" }}>{(p.combinedProb * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(p.boostedProfit * p.combinedProb).toFixed(2)}</strong></div>
                            <div>Lose <strong style={{ color: "#ef4444" }}>${stake}</strong> × <strong style={{ color: "#f59e0b" }}>{((1 - p.combinedProb) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>-${(stake * (1 - p.combinedProb)).toFixed(2)}</strong></div>
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong></div>
                          </div>
                          <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
                            <strong style={{ color: "#10b981" }}>Bottom line:</strong> {(p.combinedProb * 100).toFixed(1)}% chance of hitting, pays <strong style={{ color: "#e8eaed" }}>${(p.boostedProfit + stake).toFixed(0)}</strong> with boost. Expected profit: <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong> on ${stake}.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
