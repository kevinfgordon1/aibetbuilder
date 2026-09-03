// Map Promo Builder profit-boost legs onto Combo Locks Kalshi create-form rows.
// Identity only — never inserts into Supabase.
// Recommended fill equals fair (true parlay American) when fair is finite;
// otherwise fill stays empty. Fill is the odds you sell at AFTER the maker fee
// (already baked in) — do not apply KFEE again when recommending fill.

export const encVal = (t, s) => `${t}|${s}`;

export const COMBO_SPORT_ORDER = ["mlb", "nfl", "ncaaf"];
export const COMBO_SPORT_LABEL = { mlb: "MLB", nfl: "NFL", ncaaf: "NCAAF" };
const PROMO_TO_SPORT = {
  baseball_mlb: "mlb",
  americanfootball_nfl: "nfl",
  americanfootball_ncaaf: "ncaaf",
};

const MINUS = /[+\-\u2212]/;

// Canonical MLB ids match the 2–3 letter codes Kalshi bakes into game keys.
// Aliases cover Odds API full names, nicknames, and Kalshi abbreviations
// ("Los Angeles D", "New York Y", "Philadelphia").
const MLB_TEAMS = [
  { id: "ARI", aliases: ["arizona diamondbacks", "arizona", "diamondbacks", "dbacks", "d backs", "ari", "az"] },
  { id: "ATL", aliases: ["atlanta braves", "atlanta", "braves", "atl"] },
  { id: "BAL", aliases: ["baltimore orioles", "baltimore", "orioles", "bal"] },
  { id: "BOS", aliases: ["boston red sox", "boston", "red sox", "redsox", "bos"] },
  { id: "CHC", aliases: ["chicago cubs", "cubs", "chc", "chi cubs"] },
  { id: "CWS", aliases: ["chicago white sox", "white sox", "whitesox", "cws", "chw", "chi sox", "chicago ws"] },
  { id: "CIN", aliases: ["cincinnati reds", "cincinnati", "reds", "cin"] },
  { id: "CLE", aliases: ["cleveland guardians", "cleveland", "guardians", "cle"] },
  { id: "COL", aliases: ["colorado rockies", "colorado", "rockies", "col"] },
  { id: "DET", aliases: ["detroit tigers", "detroit", "tigers", "det"] },
  { id: "HOU", aliases: ["houston astros", "houston", "astros", "hou"] },
  { id: "KC", aliases: ["kansas city royals", "kansas city", "royals", "kc", "kcr"] },
  { id: "LAA", aliases: ["los angeles angels", "la angels", "angels", "laa", "anaheim", "anaheim angels", "los angeles a"] },
  { id: "LAD", aliases: ["los angeles dodgers", "la dodgers", "dodgers", "lad", "los angeles d"] },
  { id: "MIA", aliases: ["miami marlins", "miami", "marlins", "mia"] },
  { id: "MIL", aliases: ["milwaukee brewers", "milwaukee", "brewers", "mil"] },
  { id: "MIN", aliases: ["minnesota twins", "minnesota", "twins", "min"] },
  { id: "NYM", aliases: ["new york mets", "ny mets", "mets", "nym", "new york m"] },
  { id: "NYY", aliases: ["new york yankees", "ny yankees", "yankees", "nyy", "new york y"] },
  { id: "ATH", aliases: ["athletics", "oakland athletics", "oakland", "ath", "oak", "sacramento athletics", "sacramento", "a's", "as", "a s"] },
  { id: "PHI", aliases: ["philadelphia phillies", "philadelphia", "phillies", "phi"] },
  { id: "PIT", aliases: ["pittsburgh pirates", "pittsburgh", "pirates", "pit"] },
  { id: "SD", aliases: ["san diego padres", "san diego", "padres", "sd", "sdp"] },
  { id: "SF", aliases: ["san francisco giants", "san francisco", "giants", "sf", "sfg"] },
  { id: "SEA", aliases: ["seattle mariners", "seattle", "mariners", "sea"] },
  { id: "STL", aliases: ["st louis cardinals", "saint louis cardinals", "st louis", "cardinals", "stl"] },
  { id: "TB", aliases: ["tampa bay rays", "tampa bay", "rays", "tb", "tbr", "tampa"] },
  { id: "TEX", aliases: ["texas rangers", "texas", "rangers", "tex"] },
  { id: "TOR", aliases: ["toronto blue jays", "toronto", "blue jays", "bluejays", "jays", "tor"] },
  { id: "WSH", aliases: ["washington nationals", "washington", "nationals", "wsh", "was"] },
];

const NFL_TEAMS = [
  { id: "ARI", aliases: ["arizona cardinals", "arizona", "cardinals", "ari"] },
  { id: "ATL", aliases: ["atlanta falcons", "atlanta", "falcons", "atl"] },
  { id: "BAL", aliases: ["baltimore ravens", "baltimore", "ravens", "bal"] },
  { id: "BUF", aliases: ["buffalo bills", "buffalo", "bills", "buf"] },
  { id: "CAR", aliases: ["carolina panthers", "carolina", "panthers", "car"] },
  { id: "CHI", aliases: ["chicago bears", "chicago", "bears", "chi"] },
  { id: "CIN", aliases: ["cincinnati bengals", "cincinnati", "bengals", "cin"] },
  { id: "CLE", aliases: ["cleveland browns", "cleveland", "browns", "cle"] },
  { id: "DAL", aliases: ["dallas cowboys", "dallas", "cowboys", "dal"] },
  { id: "DEN", aliases: ["denver broncos", "denver", "broncos", "den"] },
  { id: "DET", aliases: ["detroit lions", "detroit", "lions", "det"] },
  { id: "GB", aliases: ["green bay packers", "green bay", "packers", "gb", "gnb"] },
  { id: "HOU", aliases: ["houston texans", "houston", "texans", "hou"] },
  { id: "IND", aliases: ["indianapolis colts", "indianapolis", "colts", "ind"] },
  { id: "JAC", aliases: ["jacksonville jaguars", "jacksonville", "jaguars", "jac", "jax"] },
  { id: "KC", aliases: ["kansas city chiefs", "kansas city", "chiefs", "kc", "kcc"] },
  { id: "LAC", aliases: ["los angeles chargers", "la chargers", "chargers", "lac", "los angeles c"] },
  { id: "LAR", aliases: ["los angeles rams", "la rams", "rams", "lar", "los angeles r"] },
  { id: "LV", aliases: ["las vegas raiders", "las vegas", "raiders", "lv", "lvr", "oakland raiders"] },
  { id: "MIA", aliases: ["miami dolphins", "miami", "dolphins", "mia"] },
  { id: "MIN", aliases: ["minnesota vikings", "minnesota", "vikings", "min"] },
  { id: "NE", aliases: ["new england patriots", "new england", "patriots", "ne", "nwe"] },
  { id: "NO", aliases: ["new orleans saints", "new orleans", "saints", "no", "nor"] },
  { id: "NYG", aliases: ["new york giants", "ny giants", "giants", "nyg", "new york g"] },
  { id: "NYJ", aliases: ["new york jets", "ny jets", "jets", "nyj", "new york j"] },
  { id: "PHI", aliases: ["philadelphia eagles", "philadelphia", "eagles", "phi"] },
  { id: "PIT", aliases: ["pittsburgh steelers", "pittsburgh", "steelers", "pit"] },
  { id: "SEA", aliases: ["seattle seahawks", "seattle", "seahawks", "sea"] },
  { id: "SF", aliases: ["san francisco 49ers", "san francisco", "49ers", "niners", "sf", "sfo"] },
  { id: "TB", aliases: ["tampa bay buccaneers", "tampa bay", "buccaneers", "bucs", "tb", "tam", "tampa"] },
  { id: "TEN", aliases: ["tennessee titans", "tennessee", "titans", "ten"] },
  { id: "WAS", aliases: ["washington commanders", "washington", "commanders", "was", "wsh", "football team"] },
];

function buildSportIndex(teams, extraTwo = []) {
  const twoLetter = new Set(extraTwo);
  const codeToId = {};
  const aliases = [];
  for (const t of teams) {
    if (t.id.length === 2) twoLetter.add(t.id);
    codeToId[t.id] = t.id;
    for (const a of t.aliases) {
      if (/^[a-z]{2,4}$/.test(a)) codeToId[a.toUpperCase()] = t.id;
      const n = normalize(a);
      aliases.push({ id: t.id, alias: n, len: n.length });
    }
  }
  aliases.sort((a, b) => b.len - a.len);
  return { twoLetter, codeToId, aliases };
}

const SPORT_INDEX = {
  mlb: buildSportIndex(MLB_TEAMS, ["AZ", "KC", "SD", "SF", "TB"]),
  nfl: buildSportIndex(NFL_TEAMS, ["NE", "SF", "GB", "KC", "TB", "LV", "NO"]),
};

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function identifyTeam(raw, sport = "mlb") {
  const index = SPORT_INDEX[sport] || SPORT_INDEX.mlb;
  const n = normalize(String(raw || "").replace(/\b(ml|moneyline)\b/gi, ""));
  if (!n) return null;
  for (const a of index.aliases) {
    if (n === a.alias) return a.id;
  }
  // Prefer the longest alias that is a whole-token substring ("angels" in "la angels").
  let best = null;
  for (const a of index.aliases) {
    if (a.len < 3) continue;
    const padded = ` ${n} `;
    if (padded.includes(` ${a.alias} `) || n.endsWith(" " + a.alias) || n.startsWith(a.alias + " ")) {
      if (!best || a.len > best.len) best = a;
    }
  }
  return best ? best.id : null;
}

function splitAt(game) {
  const parts = String(game || "").split(/\s+@\s+/);
  if (parts.length === 2) return parts.map((p) => p.trim());
  const vs = String(game || "").split(/\s+vs\.?\s+/i);
  if (vs.length === 2) return vs.map((p) => p.trim());
  return [];
}

function parseGameKeyIds(key, sport = "mlb") {
  const index = SPORT_INDEX[sport] || SPORT_INDEX.mlb;
  const timed = /^(\d{2}[A-Z]{3}\d{2}\d{2}\d{2})([A-Z]+)$/.exec(key || "");
  const dated = /^(\d{2}[A-Z]{3}\d{2})([A-Z]+)$/.exec(key || "");
  const rest = timed ? timed[2] : (dated ? dated[2] : "");
  if (!rest) return [];
  let codes = [];
  if (rest.length === 6) codes = [rest.slice(0, 3), rest.slice(3)];
  else if (rest.length === 5) {
    if (index.twoLetter.has(rest.slice(0, 2))) codes = [rest.slice(0, 2), rest.slice(2)];
    else if (index.twoLetter.has(rest.slice(-2))) codes = [rest.slice(0, 3), rest.slice(3)];
  } else if (rest.length === 4) codes = [rest.slice(0, 2), rest.slice(2)];
  return codes.map((c) => index.codeToId[c]).filter(Boolean);
}

function kalshiTeamIds(game, sport = "mlb") {
  const fromKey = parseGameKeyIds(game.key, sport);
  if (fromKey.length === 2) return fromKey;
  const idOf = (raw) => identifyTeam(raw, sport);
  const fromDate = splitAt(game.date).map(idOf).filter(Boolean);
  if (fromDate.length === 2) return fromDate;
  const fromTitle = splitAt(game.title).map(idOf).filter(Boolean);
  if (fromTitle.length === 2) return fromTitle;
  const fromSides = (game.markets?.side || []).map((m) => idOf(m.label)).filter(Boolean);
  return fromSides;
}

function significantTokens(s) {
  return normalize(s).split(" ").filter((t) => t.length >= 3 && t !== "the" && t !== "and");
}

function nameMatchesLabel(promoName, label) {
  const p = normalize(promoName);
  const k = normalize(label);
  if (!p || !k) return false;
  if (p === k || p.includes(k) || k.includes(p)) return true;
  const pt = significantTokens(promoName);
  const kt = significantTokens(label);
  if (!pt.length || !kt.length) return false;
  const longest = pt.reduce((a, b) => (a.length >= b.length ? a : b));
  if (longest.length >= 4 && (kt.includes(longest) || k.includes(longest))) return true;
  const overlap = pt.filter((t) => kt.includes(t) || k.includes(t));
  return overlap.length >= Math.min(2, pt.length);
}

function ncaafTeamsMatch(promoGame, kalshiGame) {
  const [away, home] = splitAt(promoGame);
  if (!away || !home) return false;
  const sides = (kalshiGame.markets?.side || []).map((m) => m.label).filter(Boolean);
  if (sides.length >= 2) {
    const a0 = nameMatchesLabel(away, sides[0]);
    const a1 = nameMatchesLabel(away, sides[1]);
    const h0 = nameMatchesLabel(home, sides[0]);
    const h1 = nameMatchesLabel(home, sides[1]);
    return (a0 && h1 && !a1 && !h0) || (a1 && h0 && !a0 && !h1) || (a0 && h1) || (a1 && h0);
  }
  const title = kalshiGame.title || "";
  return nameMatchesLabel(away, title) && nameMatchesLabel(home, title);
}

function teamsMatchGame(promoGame, kalshiGame, sport = "mlb") {
  if (sport === "ncaaf") return ncaafTeamsMatch(promoGame, kalshiGame);
  const [away, home] = splitAt(promoGame);
  const promoIds = [identifyTeam(away, sport), identifyTeam(home, sport)].filter(Boolean);
  const kalshiIds = kalshiTeamIds(kalshiGame, sport);
  if (promoIds.length === 2 && kalshiIds.length === 2) {
    const set = new Set(kalshiIds);
    return set.has(promoIds[0]) && set.has(promoIds[1]);
  }
  return false;
}

function promoSportOf(leg) {
  if (!leg?.sport) return "mlb";
  return PROMO_TO_SPORT[leg.sport] || null;
}

function matchKalshiGame(promoLeg, games) {
  const sport = promoSportOf(promoLeg);
  if (!sport) return null;
  const pool = (games || []).filter((g) => (g.sport || "mlb") === sport);
  const candidates = pool.filter((g) => teamsMatchGame(promoLeg.game, g, sport));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const t = new Date(promoLeg.commence_time).getTime();
  if (!Number.isFinite(t)) return candidates[0];
  return candidates.slice().sort((a, b) => {
    const da = Math.abs(new Date(a.startTime).getTime() - t);
    const db = Math.abs(new Date(b.startTime).getTime() - t);
    return (Number.isFinite(da) ? da : Infinity) - (Number.isFinite(db) ? db : Infinity);
  })[0];
}

export function comboGameId(game) {
  if (!game) return "";
  return game.sport ? `${game.sport}:${game.key}` : game.key;
}

export function flattenComboGames(sportsOrList) {
  const buckets = [];
  if (Array.isArray(sportsOrList)) {
    buckets.push({ sport: sportsOrList[0]?.sport || "mlb", games: sportsOrList });
  } else {
    for (const sport of COMBO_SPORT_ORDER) {
      buckets.push({ sport, games: (sportsOrList && sportsOrList[sport]) || [] });
    }
  }
  const out = [];
  for (const { sport, games } of buckets) {
    for (const g of games || []) {
      const s = g.sport || sport;
      out.push({ ...g, sport: s, sportLabel: COMBO_SPORT_LABEL[s] || String(s).toUpperCase() });
    }
  }
  out.sort((a, b) => {
    const ta = Date.parse(a.startTime);
    const tb = Date.parse(b.startTime);
    const da = Number.isFinite(ta) ? ta : Infinity;
    const db = Number.isFinite(tb) ? tb : Infinity;
    if (da !== db) return da - db;
    const ia = COMBO_SPORT_ORDER.indexOf(a.sport);
    const ib = COMBO_SPORT_ORDER.indexOf(b.sport);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return out;
}

export function formatGameOption(g) {
  const title = g.title || g.key || "Game";
  const date = g.date ? ` · ${g.date}` : "";
  return `${g.sportLabel || "MLB"} · ${title}${date}`;
}

export function indexComboGames(sportsOrList) {
  const m = {};
  for (const g of flattenComboGames(sportsOrList)) {
    m[comboGameId(g)] = g;
    if (!m[g.key]) m[g.key] = g;
  }
  return m;
}

export function parsePromoTotal(name) {
  const m = /\b(over|under|[ou])\s*([\d.]+)\s*$/i.exec(String(name || ""))
    || /\b(over|under|[ou])\s*([\d.]+)/i.exec(String(name || ""));
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const ou = raw === "u" || raw === "under" ? "under" : "over";
  return { ou, line: m[2] };
}

export function parsePromoSpread(name) {
  const m = new RegExp(`^(.*?)\\s*(${MINUS.source})\\s*([\\d.]+)\\s*$`).exec(String(name || "").trim());
  if (!m) return null;
  return { team: m[1].trim(), sign: m[2] === "+" ? "+" : "-", line: m[3] };
}

function linesEqual(a, b) {
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-6;
}

function parseMarketLine(label) {
  const m = new RegExp(`^(.*?)\\s*(${MINUS.source})\\s*([\\d.]+)\\s*$`).exec(String(label || "").trim());
  if (!m) return null;
  return { team: m[1].trim(), sign: m[2] === "+" ? "+" : "-", line: m[3] };
}

function matchMarket(promoLeg, game, sport = "mlb") {
  const market = promoLeg.market;
  if (market === "ML") {
    const sides = game.markets?.side || [];
    if (sport === "ncaaf") {
      return sides.find((m) => nameMatchesLabel(promoLeg.name, m.label)) || null;
    }
    const teamId = identifyTeam(promoLeg.name, sport);
    if (teamId) {
      const hit = sides.find((m) => identifyTeam(m.label, sport) === teamId);
      if (hit) return hit;
    }
    return null;
  }
  if (market === "TOT") {
    const parsed = parsePromoTotal(promoLeg.name);
    if (!parsed) return null;
    const want = `${parsed.ou} ${parsed.line}`;
    return (game.markets?.total || []).find((m) => normalize(m.label) === normalize(want)) || null;
  }
  if (market === "SPR") {
    const parsed = parsePromoSpread(promoLeg.name);
    if (!parsed) return null;
    const teamId = identifyTeam(parsed.team, sport);
    for (const m of game.markets?.spread || []) {
      const sm = parseMarketLine(m.label);
      if (!sm || !linesEqual(sm.line, parsed.line) || sm.sign !== parsed.sign) continue;
      const labelId = identifyTeam(sm.team, sport);
      if (teamId && labelId && teamId === labelId) return m;
      if (sport === "ncaaf" && nameMatchesLabel(parsed.team, sm.team)) return m;
      if (teamId && normalize(sm.team).includes(normalize(parsed.team).split(" ").pop())) return m;
    }
    return null;
  }
  return null;
}

function unmatchedEntry(leg, reason) {
  return { name: leg?.name || "(unnamed leg)", reason };
}

export function mapPromoLegsToKalshi(promoLegs, games) {
  const unmatched = [];
  const rows = [];
  const flat = flattenComboGames(games);
  for (const leg of promoLegs || []) {
    const sport = promoSportOf(leg);
    if (!sport) {
      unmatched.push(unmatchedEntry(leg, "Combo Locks maps MLB, NFL, and NCAAF main lines"));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    if (leg.market === "TT") {
      unmatched.push(unmatchedEntry(leg, "team totals are not in Combo Locks"));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    const game = matchKalshiGame(leg, flat);
    if (!game) {
      unmatched.push(unmatchedEntry(leg, `no matching Kalshi ${COMBO_SPORT_LABEL[sport]} game`));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    const mkt = matchMarket(leg, game, sport);
    if (!mkt) {
      unmatched.push(unmatchedEntry(leg, `no matching ${leg.market || "market"} on ${game.title || game.key}`));
      rows.push({ gameKey: game.key, marketVal: "" });
      continue;
    }
    rows.push({ gameKey: game.key, marketVal: encVal(mkt.ticker, mkt.side) });
  }
  return { rows, unmatched };
}

export function toDatetimeLocalValue(isoOrDate) {
  if (!isoOrDate) return "";
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function earliestCommence(legs) {
  const times = (legs || []).map((l) => l?.commence_time).filter(Boolean)
    .map((t) => new Date(t).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  return times.length ? new Date(times[0]).toISOString() : "";
}

// Same American convention as App.jsx probToAmerican / ComboLocks americanFromProb:
// 0 < p < 1 required; p < 0.5 → plus money. Never invent a number.
export function fairAmericanFromProb(combinedProb) {
  if (!(combinedProb > 0 && combinedProb < 1)) return "";
  const am = combinedProb < 0.5
    ? Math.round((100 * (1 - combinedProb)) / combinedProb)
    : -Math.round((100 * combinedProb) / (1 - combinedProb));
  return Number.isFinite(am) ? am : "";
}

// Recommended fill = fair when fair is a finite American number; else "".
export function recommendedFillFromFair(fair) {
  return Number.isFinite(fair) ? fair : "";
}

export function recommendedFillFromProb(combinedProb) {
  return recommendedFillFromFair(fairAmericanFromProb(combinedProb));
}
