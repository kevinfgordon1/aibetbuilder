// Map Promo Builder profit-boost / free-bet legs onto Combo Locks Kalshi create-form rows.
// Identity only — never inserts into Supabase.
// Recommended fill equals fair (true parlay American) when fair is finite;
// otherwise fill stays empty. Fill is the odds you sell at AFTER the maker fee
// (already baked in) — do not apply KFEE again when recommending fill.

export const encVal = (t, s) => `${t}|${s}`;

export const COMBO_SPORT_ORDER = ["mlb", "nfl", "ncaaf", "nhl"];
export const COMBO_SPORT_LABEL = { mlb: "MLB", nfl: "NFL", ncaaf: "NCAAF", nhl: "NHL" };
const PROMO_TO_SPORT = {
  baseball_mlb: "mlb",
  americanfootball_nfl: "nfl",
  americanfootball_ncaaf: "ncaaf",
  icehockey_nhl: "nhl",
};

const MINUS = /[+\-\u2212]/;

// Canonical MLB ids match the 2–3 letter codes Kalshi bakes into game keys.
// Aliases cover Odds API full names, nicknames, and Kalshi abbreviations
// ("Chicago C", "Chicago WS", "Los Angeles D", "New York Y", "Philadelphia").
const MLB_TEAMS = [
  { id: "ARI", aliases: ["arizona diamondbacks", "arizona", "diamondbacks", "dbacks", "d backs", "ari", "az"] },
  { id: "ATL", aliases: ["atlanta braves", "atlanta", "braves", "atl"] },
  { id: "BAL", aliases: ["baltimore orioles", "baltimore", "orioles", "bal"] },
  { id: "BOS", aliases: ["boston red sox", "boston", "red sox", "redsox", "bos"] },
  { id: "CHC", aliases: ["chicago cubs", "cubs", "chc", "chi cubs", "chicago c"] },
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

// Canonical ids are the codes Kalshi bakes into KXNHL game keys (26SEP30PITPHI,
// 26SEP30LACOL, 26OCT01FLASJ). Kalshi labels are city-only except the two New
// York clubs ("New York I" / "New York R"); Odds API uses full names.
const NHL_TEAMS = [
  { id: "ANA", aliases: ["anaheim ducks", "anaheim", "ducks", "ana"] },
  { id: "BOS", aliases: ["boston bruins", "boston", "bruins", "bos"] },
  { id: "BUF", aliases: ["buffalo sabres", "buffalo", "sabres", "buf"] },
  { id: "CGY", aliases: ["calgary flames", "calgary", "flames", "cgy", "cal"] },
  { id: "CAR", aliases: ["carolina hurricanes", "carolina", "hurricanes", "canes", "car"] },
  { id: "CHI", aliases: ["chicago blackhawks", "chicago", "blackhawks", "hawks", "chi"] },
  { id: "COL", aliases: ["colorado avalanche", "colorado", "avalanche", "avs", "col"] },
  { id: "CBJ", aliases: ["columbus blue jackets", "columbus", "blue jackets", "bluejackets", "jackets", "cbj"] },
  { id: "DAL", aliases: ["dallas stars", "dallas", "stars", "dal"] },
  { id: "DET", aliases: ["detroit red wings", "detroit", "red wings", "redwings", "det"] },
  { id: "EDM", aliases: ["edmonton oilers", "edmonton", "oilers", "edm"] },
  { id: "FLA", aliases: ["florida panthers", "florida", "panthers", "fla"] },
  { id: "LA", aliases: ["los angeles kings", "la kings", "kings", "los angeles", "la", "lak"] },
  { id: "MIN", aliases: ["minnesota wild", "minnesota", "wild", "min"] },
  { id: "MTL", aliases: ["montreal canadiens", "montreal", "canadiens", "habs", "mtl", "mon"] },
  { id: "NSH", aliases: ["nashville predators", "nashville", "predators", "preds", "nsh", "nas"] },
  { id: "NJ", aliases: ["new jersey devils", "new jersey", "devils", "nj", "njd"] },
  { id: "NYI", aliases: ["new york islanders", "ny islanders", "islanders", "isles", "nyi", "new york i"] },
  { id: "NYR", aliases: ["new york rangers", "ny rangers", "rangers", "nyr", "new york r"] },
  { id: "OTT", aliases: ["ottawa senators", "ottawa", "senators", "sens", "ott"] },
  { id: "PHI", aliases: ["philadelphia flyers", "philadelphia", "flyers", "phi"] },
  { id: "PIT", aliases: ["pittsburgh penguins", "pittsburgh", "penguins", "pens", "pit"] },
  { id: "SJ", aliases: ["san jose sharks", "san jose", "sharks", "sj", "sjs"] },
  { id: "SEA", aliases: ["seattle kraken", "seattle", "kraken", "sea"] },
  { id: "STL", aliases: ["st louis blues", "saint louis blues", "st louis", "saint louis", "blues", "stl"] },
  { id: "TB", aliases: ["tampa bay lightning", "tampa bay", "lightning", "bolts", "tb", "tbl", "tampa"] },
  { id: "TOR", aliases: ["toronto maple leafs", "toronto", "maple leafs", "leafs", "tor"] },
  { id: "UTA", aliases: ["utah mammoth", "utah hockey club", "utah", "mammoth", "uta", "utah hc"] },
  { id: "VAN", aliases: ["vancouver canucks", "vancouver", "canucks", "van"] },
  { id: "VGK", aliases: ["vegas golden knights", "vegas", "golden knights", "knights", "vgk", "veg", "las vegas golden knights"] },
  { id: "WSH", aliases: ["washington capitals", "washington", "capitals", "caps", "wsh", "was"] },
  { id: "WPG", aliases: ["winnipeg jets", "winnipeg", "jets", "wpg"] },
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
  nhl: buildSportIndex(NHL_TEAMS, ["LA", "NJ", "SJ", "TB"]),
};

export function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Montréal → Montreal
    .toLowerCase()
    .replace(/[.\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Full display name for an NFL/MLB side. Aliases are stored lowercase;
// aliases[0] is the city + nickname ("atlanta falcons").
export function canonicalTeamName(raw, sport = "mlb") {
  const id = identifyTeam(raw, sport);
  if (!id) return null;
  const teams = sport === "nfl" ? NFL_TEAMS : sport === "mlb" ? MLB_TEAMS : sport === "nhl" ? NHL_TEAMS : null;
  const team = teams && teams.find((t) => t.id === id);
  const full = team && team.aliases && team.aliases[0];
  if (!full) return null;
  return full.replace(/\b[a-z0-9]/g, (c) => c.toUpperCase());
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

// Same two teams are often on the slate on consecutive days (series games) or
// twice in one day (doubleheader). A promo leg's commence_time must sit near the
// Kalshi game's start; a game more than SAME_GAME_MAX_GAP_MS away is a DIFFERENT
// game (e.g. today's PHI@ATL leg must never map onto tomorrow's "Game 2").
// Doubleheader halves are ~3-5h apart, so they still compete on nearest start.
export const SAME_GAME_MAX_GAP_MS = 6 * 3600 * 1000;

function sameTeamsCandidates(promoLeg, games) {
  const sport = promoSportOf(promoLeg);
  if (!sport) return [];
  const pool = (games || []).filter((g) => (g.sport || "mlb") === sport);
  return pool.filter((g) => teamsMatchGame(promoLeg.game, g, sport));
}

// Only MLB-style keys carry a real first-pitch time (26SEP291400PHIATL). NFL /
// NCAAF keys are date-only, so their startTime is midnight ET and says nothing
// about kickoff — never gate those on the time gap. NHL keys are date-only too,
// but /api/kalshi-games derives the exact puck drop from the markets'
// occurrence time and flags it startExact, so NHL games are time-gated.
const TIMED_KEY = /^\d{2}[A-Z]{3}\d{2}\d{4}[A-Z]/;
function startGapMs(g, t) {
  if (!TIMED_KEY.test(g.key || "") && g.startExact !== true) return NaN;
  const gt = new Date(g.startTime).getTime();
  return Number.isFinite(gt) && Number.isFinite(t) ? Math.abs(gt - t) : NaN;
}

function matchKalshiGame(promoLeg, games) {
  const all = sameTeamsCandidates(promoLeg, games);
  if (all.length === 0) return null;
  const t = new Date(promoLeg.commence_time).getTime();
  if (!Number.isFinite(t)) return all[0];
  // Drop games whose start is known and far from the promo's commence time.
  const candidates = all.filter((g) => {
    const gap = startGapMs(g, t);
    return !Number.isFinite(gap) || gap <= SAME_GAME_MAX_GAP_MS;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.slice().sort((a, b) => {
    const da = startGapMs(a, t);
    const db = startGapMs(b, t);
    return (Number.isFinite(da) ? da : Infinity) - (Number.isFinite(db) ? db : Infinity);
  })[0];
}

// Same teams are on the Kalshi slate, but only on another day/time (the leg's
// own game is gone — typically already underway). Returns those games.
function otherStartGames(promoLeg, games) {
  const t = new Date(promoLeg.commence_time).getTime();
  if (!Number.isFinite(t)) return [];
  return sameTeamsCandidates(promoLeg, games).filter((g) => startGapMs(g, t) > SAME_GAME_MAX_GAP_MS); // NaN (date-only) never counts
}

function etDay(ms, opts = {}) {
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...opts });
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
  const noCombo = g.comboEligible === false ? " · no Kalshi combos" : "";
  return `${g.sportLabel || "MLB"} · ${title}${date}${noCombo}`;
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

function lineDistance(a, b) {
  const na = Number(a), nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return Infinity;
  return Math.abs(na - nb);
}

// Kalshi football strike grids skip some sportsbook mains (e.g. −55.5 vs 54.5/57.5).
// Snap SPR/TOT to a real Kalshi contract within this window; never invent a ticker.
export const STRIKE_SNAP_MAX = 3;
// Hockey lines are in whole goals on a complete 1.5–9.5 grid: o6.5 → o5.5 is a
// different bet, not a "nearby strike". NHL maps the exact line or nothing.
const STRIKE_SNAP_MAX_BY_SPORT = { nhl: 0 };
const snapMaxFor = (sport) => (Object.prototype.hasOwnProperty.call(STRIKE_SNAP_MAX_BY_SPORT, sport) ? STRIKE_SNAP_MAX_BY_SPORT[sport] : STRIKE_SNAP_MAX);

function parseMarketLine(label) {
  const m = new RegExp(`^(.*?)\\s*(${MINUS.source})\\s*([\\d.]+)\\s*$`).exec(String(label || "").trim());
  if (!m) return null;
  return { team: m[1].trim(), sign: m[2] === "+" ? "+" : "-", line: m[3] };
}

function spreadSideMatches(parsed, sm, sport) {
  if (!sm || sm.sign !== parsed.sign) return false;
  const teamId = identifyTeam(parsed.team, sport);
  const labelId = identifyTeam(sm.team, sport);
  if (teamId && labelId && teamId === labelId) return true;
  if (sport === "ncaaf" && nameMatchesLabel(parsed.team, sm.team)) return true;
  if (teamId && normalize(sm.team).includes(normalize(parsed.team).split(" ").pop())) return true;
  return false;
}

// Pick an existing Kalshi strike: exact line wins, else nearest within STRIKE_SNAP_MAX.
function pickNearestStrike(pool, wantLine, maxSnap = STRIKE_SNAP_MAX) {
  let exact = null;
  let best = null;
  let bestDist = Infinity;
  for (const c of pool) {
    if (linesEqual(c.line, wantLine)) {
      exact = c;
      break;
    }
    const d = lineDistance(c.line, wantLine);
    if (d > maxSnap) continue;
    if (!best || d < bestDist || (d === bestDist && Number(c.line) < Number(best.line))) {
      best = c;
      bestDist = d;
    }
  }
  return exact || best || null;
}

function formatWantTotal(parsed) {
  return `${parsed.ou === "under" ? "u" : "o"}${parsed.line}`;
}

function matchupLabel(game) {
  const date = String(game?.date || "").trim();
  const paren = /^(.*?)\s+\([^)]*\)\s*$/.exec(date);
  const head = (paren ? paren[1] : date).trim();
  if (/\bvs\b/i.test(head)) return head;
  return game?.title || game?.key || "this game";
}

function nearestStrikeTexts(pool, wantLine, limit = 2) {
  const want = Number(wantLine);
  const byNum = new Map();
  for (const c of pool || []) {
    const num = Number(c.line);
    if (!Number.isFinite(num)) continue;
    if (!byNum.has(num)) byNum.set(num, String(c.line));
  }
  const ranked = [...byNum.entries()].map(([num, text]) => ({
    num,
    text,
    dist: Number.isFinite(want) ? Math.abs(num - want) : Infinity,
  }));
  ranked.sort((a, b) => a.dist - b.dist || a.num - b.num);
  return ranked.slice(0, limit).sort((a, b) => a.num - b.num).map((x) => x.text);
}

// Exact strike missing and nothing close enough to snap. Name the board's
// neighbors ("Kalshi has no 8.5 line for ARI vs SF; nearest: 7.5 / 9.5").
function missingKalshiLineReason(wantLine, game, pool) {
  const nearest = nearestStrikeTexts(pool, wantLine, 2);
  if (!nearest.length) return null;
  return `Kalshi has no ${wantLine} line for ${matchupLabel(game)}; nearest: ${nearest.join(" / ")}`;
}

// YES on "opponent wins by over X" is opponent −X. NO on that same contract
// is this team's +X — even when the NO label was built from the wrong city.
function opponentMinusCovers(parsed, yesSpread, sport) {
  if (!yesSpread || yesSpread.sign !== "-") return false;
  if (sport === "ncaaf") return !nameMatchesLabel(parsed.team, yesSpread.team);
  const promoId = identifyTeam(parsed.team, sport);
  const yesId = identifyTeam(yesSpread.team, sport);
  if (promoId && yesId) return promoId !== yesId;
  return !nameMatchesLabel(parsed.team, yesSpread.team);
}

function allParsedSpreadLines(game) {
  const pool = [];
  for (const m of game.markets?.spread || []) {
    const sm = parseMarketLine(m.label);
    if (sm) pool.push({ market: m, line: sm.line });
  }
  return pool;
}

function spreadCandidates(parsed, game, sport) {
  const spreads = game.markets?.spread || [];
  const yesByTicker = new Map();
  for (const m of spreads) {
    if (m && m.side === "yes") yesByTicker.set(m.ticker, m);
  }
  const pool = [];
  const seen = new Set();
  const add = (market, line) => {
    if (!market || line == null || line === "") return;
    const key = `${market.ticker}|${market.side}`;
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ market, line: String(line) });
  };
  for (const m of spreads) {
    const sm = parseMarketLine(m.label);
    if (!spreadSideMatches(parsed, sm, sport)) continue;
    add(m, sm.line);
  }
  if (parsed.sign === "+") {
    for (const m of spreads) {
      if (!m || m.side !== "no") continue;
      const yes = yesByTicker.get(m.ticker);
      const ys = yes && parseMarketLine(yes.label);
      if (!opponentMinusCovers(parsed, ys, sport)) continue;
      add(m, ys.line);
    }
  }
  return pool;
}

function noStrikeInRangeReason(kind, want, title) {
  return `no Kalshi ${kind} within ${STRIKE_SNAP_MAX} pts of ${want} on ${title}`;
}

// ── Player props (MLB 1+ HR, NFL anytime TD) ───────────────────────────────────
// Promo legs are named "<Player> 1+ HR" / "<Player> 1+ TD" (lib/player-td legName)
// and Kalshi lists the same rung as "<Player>: 1+" under KXMLBHR / KXNFLTD, on the
// SAME game key as the game's moneyline pair. A prop maps only when ALL hold:
//   - HR on an MLB game, TD on an NFL game (kind comes from the leg, not the name);
//   - the leg's rung is exactly 1+ (2+ / first TD / anything else is skipped);
//   - the game is the one matchKalshiGame picked (teams + first-pitch gap), AND the
//     leg's commence_time falls on that game key's ET calendar date;
//   - the FULL player name equals Kalshi's after case/accent/punctuation folding
//     (a Jr./II suffix is NOT dropped), and exactly one Kalshi market qualifies.
// Anything else is skipped with a reason — never a nearest-name guess.
const PROP_KIND_BY_MARKET = { HR: { kind: "hr", sport: "mlb", label: "HR" }, TD: { kind: "td", sport: "nfl", label: "TD" } };

export function parsePromoProp(leg) {
  const spec = PROP_KIND_BY_MARKET[leg?.market];
  if (!spec) return null;
  const m = /^(.*\S)\s+(\d+)\+\s+(HR|TD)$/i.exec(String(leg.name || "").trim());
  if (!m) return { spec, player: null, rung: null };
  if (m[3].toUpperCase() !== spec.label) return { spec, player: null, rung: null };
  return { spec, player: m[1].trim(), rung: Number(m[2]) };
}

function etDateOfMs(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function keyEtDate(key) {
  const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const m = /^(\d{2})([A-Z]{3})(\d{2})/.exec(String(key || ""));
  return m && MON[m[2]] ? `20${m[1]}-${MON[m[2]]}-${m[3]}` : null;
}

function propPlayerName(label) {
  const m = /^(.+?):\s*1\+\s*$/.exec(String(label || "").trim());
  return m ? m[1].trim() : "";
}

function matchPropMarket(promoLeg, game, sport) {
  const parsed = parsePromoProp(promoLeg);
  const spec = parsed.spec;
  const what = spec.kind === "hr" ? "1+ HR" : "anytime TD";
  const matchup = matchupLabel(game);
  if (sport !== spec.sport) {
    return { market: null, reason: `${spec.label} props map only on ${spec.sport.toUpperCase()} games` };
  }
  if (!parsed.player) {
    return { market: null, reason: `"${promoLeg.name}" is not a "<Player> 1+ ${spec.label}" leg, so it was not mapped` };
  }
  if (parsed.rung !== 1) {
    return { market: null, reason: `only the 1+ ${spec.label} rung is mapped (not "${promoLeg.name}")` };
  }
  const legDate = etDateOfMs(Date.parse(promoLeg.commence_time));
  const keyDate = keyEtDate(game.key);
  if (!legDate || !keyDate || legDate !== keyDate) {
    return { market: null, reason: `${what} date could not be verified against Kalshi's ${matchup} game (${keyDate || "no date"}), so it was not mapped` };
  }
  const props = (game.markets?.prop || []).filter((m) => m && m.side === "yes" && m.kind === spec.kind);
  if (!props.length) {
    return { market: null, reason: `Kalshi has no ${what} markets listed yet for ${matchup}` };
  }
  const want = normalize(parsed.player);
  const hits = props.filter((m) => normalize(propPlayerName(m.label)) === want);
  if (hits.length === 1) return { market: hits[0] };
  if (hits.length > 1) {
    return { market: null, reason: `${hits.length} Kalshi ${what} markets match "${parsed.player}" on ${matchup}; not guessing` };
  }
  const last = want.split(" ").pop();
  const near = props.filter((m) => last && normalize(propPlayerName(m.label)).split(" ").includes(last)).map((m) => propPlayerName(m.label));
  const hint = near.length ? ` (Kalshi has ${near.join(" / ")} — not an exact full-name match, so not mapped)` : "";
  return { market: null, reason: `Kalshi has no ${what} market for ${parsed.player} on ${matchup}${hint}` };
}

function matchMarket(promoLeg, game, sport = "mlb") {
  const market = promoLeg.market;
  const title = game.title || game.key;
  if (market === "HR" || market === "TD") return matchPropMarket(promoLeg, game, sport);
  if (market === "ML") {
    const sides = game.markets?.side || [];
    if (sport === "ncaaf") {
      const hit = sides.find((m) => nameMatchesLabel(promoLeg.name, m.label)) || null;
      return { market: hit };
    }
    const teamId = identifyTeam(promoLeg.name, sport);
    if (teamId) {
      const hit = sides.find((m) => identifyTeam(m.label, sport) === teamId);
      if (hit) return { market: hit };
    }
    return { market: null };
  }
  if (market === "TOT") {
    const parsed = parsePromoTotal(promoLeg.name);
    if (!parsed) return { market: null };
    const pool = [];
    for (const m of game.markets?.total || []) {
      const tm = parsePromoTotal(m.label);
      if (!tm || tm.ou !== parsed.ou) continue;
      pool.push({ market: m, line: tm.line });
    }
    const picked = pickNearestStrike(pool, parsed.line, snapMaxFor(sport));
    if (picked) return { market: picked.market };
    if (pool.length) {
      if (snapMaxFor(sport) === 0) {
        const r = missingKalshiLineReason(parsed.line, game, pool);
        if (r) return { market: null, reason: r };
      }
      return { market: null, reason: noStrikeInRangeReason("TOT", formatWantTotal(parsed), title) };
    }
    return { market: null };
  }
  if (market === "SPR") {
    const parsed = parsePromoSpread(promoLeg.name);
    if (!parsed) return { market: null };
    const pool = spreadCandidates(parsed, game, sport);
    const picked = pickNearestStrike(pool, parsed.line, snapMaxFor(sport));
    if (picked) return { market: picked.market };
    const hint = pool.length ? pool : allParsedSpreadLines(game);
    const reason = missingKalshiLineReason(parsed.line, game, hint);
    if (reason) return { market: null, reason };
    return { market: null };
  }
  return { market: null };
}

function unmatchedEntry(leg, reason) {
  return { name: leg?.name || "(unnamed leg)", reason };
}

function promoMatchupLabel(leg) {
  const [away, home] = splitAt(leg?.game);
  if (away && home) return `${away} vs ${home}`;
  return null;
}

// Combo Locks /api/kalshi-games drops MLB once first pitch has passed, so a
// promo leg can fail here even when Kalshi still lists the event as open.
// Prefer "already started" when Odds API commence_time is in the past; never
// invent a map onto a different game.
export function noMatchingGameReason(leg, sport, nowMs = Date.now(), otherGames = []) {
  const label = COMBO_SPORT_LABEL[sport] || String(sport || "").toUpperCase();
  const matchup = promoMatchupLabel(leg);
  const startMs = Date.parse(leg?.commence_time);
  const started = Number.isFinite(startMs) && startMs <= nowMs;
  if (started) {
    return matchup
      ? `${matchup} already started — Combo Locks only quotes pre-game Kalshi ${label} markets`
      : `game already started — Combo Locks only quotes pre-game Kalshi ${label} markets`;
  }
  if (otherGames.length) {
    const when = otherGames.map((g) => {
      const ms = Date.parse(g.startTime);
      return `${g.title || g.key} on ${Number.isFinite(ms) ? etDay(ms) : g.date || g.key}`;
    }).join(" / ");
    return `${matchup || "this game"} (${etDay(startMs, { hour: "numeric", minute: "2-digit" })} ET) is not on Combo Locks' pre-game slate (Kalshi may have taken it down at its own first pitch); the only ${label} game listed for these teams is ${when} — a different game, so not mapped`;
  }
  if (matchup) {
    return `no matching Kalshi ${label} game on the current pre-game slate (${matchup})`;
  }
  return `no matching Kalshi ${label} game`;
}

export function mapPromoLegsToKalshi(promoLegs, games, nowMs = Date.now()) {
  const unmatched = [];
  const rows = [];
  const flat = flattenComboGames(games);
  for (const leg of promoLegs || []) {
    const sport = promoSportOf(leg);
    if (!sport) {
      unmatched.push(unmatchedEntry(leg, "Combo Locks maps MLB, NFL, NCAAF, and NHL main lines (plus MLB 1+ HR and NFL anytime TD props)"));
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
      unmatched.push(unmatchedEntry(leg, noMatchingGameReason(leg, sport, nowMs, otherStartGames(leg, flat))));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    const hit = matchMarket(leg, game, sport);
    const mkt = hit?.market;
    if (!mkt) {
      unmatched.push(unmatchedEntry(leg, hit?.reason || `no matching ${leg.market || "market"} on ${game.title || game.key}`));
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

// Promo Builder promo type → Combo Locks "Bet type" <select> value.
// Combo Locks options are exactly: "cash" (Cash), "boost" (Profit boost),
// "freebet" (Free bet). No Sweat has no option, so it stays Cash.
// "boost" is label/metadata only — lockKind() treats it as cash, so hedge
// contracts / profit match a manual Cash entry at the same boosted odds.
export const PROMO_TYPE_TO_COMBO_KIND = { boost: "boost", freebet: "freebet", nosweat: "cash" };

export function comboKindForPromo(promoType, kind) {
  if (promoType && Object.prototype.hasOwnProperty.call(PROMO_TYPE_TO_COMBO_KIND, promoType)) {
    return PROMO_TYPE_TO_COMBO_KIND[promoType];
  }
  if (kind === "freebet" || kind === "boost") return kind;
  return "cash";
}

// Promo Builder → Combo Locks create-form payload. Identity only — never inserts.
// kind "freebet" tags stake as free-bet face value and book American (not boosted).
// sportsbook → free-text "Sportsbook — optional"; boostPct only for profit boosts.
export function buildPromoComboPrefill({
  stake,
  american,
  combinedProb,
  legs,
  kind = "cash",
  promoType,
  sportsbook,
  boostPct,
  nonce,
} = {}) {
  const fair = fairAmericanFromProb(combinedProb);
  // Every leg — including 4+ grown legs — must reach Combo Locks.
  const mapped = (legs || []).map((l) => ({
    name: l.name, market: l.market, game: l.game, commence_time: l.commence_time, sport: l.sport,
  }));
  const comboKind = comboKindForPromo(promoType, kind);
  const pct = Number(boostPct);
  return {
    nonce: nonce ?? Date.now(),
    stake,
    boost: american,
    fair,
    fill: recommendedFillFromFair(fair),
    mode: "1x",
    kind: comboKind,
    sportsbook: sportsbook ? String(sportsbook).trim() : "",
    boostPct: comboKind === "boost" && boostPct !== "" && boostPct != null && Number.isFinite(pct) ? pct : "",
    starts: earliestCommence(mapped),
    label: mapped.map((l) => l.name).join(" + "),
    labelEdited: true,
    legs: mapped,
  };
}
