// Map Promo Builder profit-boost legs onto Combo Locks Kalshi create-form rows.
// Identity only — never inserts into Supabase.
// Recommended fill equals fair (true parlay American) when fair is finite;
// otherwise fill stays empty. Fill is the odds you sell at AFTER the maker fee
// (already baked in) — do not apply KFEE again when recommending fill.

export const encVal = (t, s) => `${t}|${s}`;

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
  { id: "ATH", aliases: ["athletics", "oakland athletics", "oakland", "ath", "oak", "sacramento athletics", "sacramento"] },
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

const TWO_LETTER = new Set(["AZ", "KC", "SD", "SF", "TB"]);
const CODE_TO_ID = {};
for (const t of MLB_TEAMS) {
  CODE_TO_ID[t.id] = t.id;
  for (const a of t.aliases) {
    if (/^[a-z]{2,3}$/.test(a)) CODE_TO_ID[a.toUpperCase()] = t.id;
  }
}

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasList() {
  const out = [];
  for (const t of MLB_TEAMS) {
    for (const a of t.aliases) out.push({ id: t.id, alias: normalize(a), len: normalize(a).length });
  }
  out.sort((a, b) => b.len - a.len);
  return out;
}
const ALIASES = aliasList();

export function identifyTeam(raw) {
  const n = normalize(String(raw || "").replace(/\b(ml|moneyline)\b/gi, ""));
  if (!n) return null;
  for (const a of ALIASES) {
    if (n === a.alias) return a.id;
  }
  // Prefer the longest alias that is a whole-token substring ("angels" in "la angels").
  let best = null;
  for (const a of ALIASES) {
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

function parseGameKeyIds(key) {
  const m = /^(\d{2}[A-Z]{3}\d{2}\d{2}\d{2})([A-Z]+)$/.exec(key || "");
  if (!m) return [];
  const rest = m[2];
  let codes = [];
  if (rest.length === 6) codes = [rest.slice(0, 3), rest.slice(3)];
  else if (rest.length === 5) {
    if (TWO_LETTER.has(rest.slice(0, 2))) codes = [rest.slice(0, 2), rest.slice(2)];
    else if (TWO_LETTER.has(rest.slice(-2))) codes = [rest.slice(0, 3), rest.slice(3)];
  } else if (rest.length === 4) codes = [rest.slice(0, 2), rest.slice(2)];
  return codes.map((c) => CODE_TO_ID[c]).filter(Boolean);
}

function kalshiTeamIds(game) {
  const fromKey = parseGameKeyIds(game.key);
  if (fromKey.length === 2) return fromKey;
  const fromDate = splitAt(game.date).map(identifyTeam).filter(Boolean);
  if (fromDate.length === 2) return fromDate;
  const fromTitle = splitAt(game.title).map(identifyTeam).filter(Boolean);
  if (fromTitle.length === 2) return fromTitle;
  const fromSides = (game.markets?.side || []).map((m) => identifyTeam(m.label)).filter(Boolean);
  return fromSides;
}

function teamsMatchGame(promoGame, kalshiGame) {
  const [away, home] = splitAt(promoGame);
  const promoIds = [identifyTeam(away), identifyTeam(home)].filter(Boolean);
  const kalshiIds = kalshiTeamIds(kalshiGame);
  if (promoIds.length === 2 && kalshiIds.length === 2) {
    const set = new Set(kalshiIds);
    return set.has(promoIds[0]) && set.has(promoIds[1]);
  }
  return false;
}

function matchKalshiGame(promoLeg, mlbGames) {
  const candidates = (mlbGames || []).filter((g) => teamsMatchGame(promoLeg.game, g));
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

function matchMarket(promoLeg, game) {
  const market = promoLeg.market;
  if (market === "ML") {
    const teamId = identifyTeam(promoLeg.name);
    const sides = game.markets?.side || [];
    if (teamId) {
      const hit = sides.find((m) => identifyTeam(m.label) === teamId);
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
    const teamId = identifyTeam(parsed.team);
    for (const m of game.markets?.spread || []) {
      const sm = parseMarketLine(m.label);
      if (!sm || !linesEqual(sm.line, parsed.line) || sm.sign !== parsed.sign) continue;
      const labelId = identifyTeam(sm.team);
      if (teamId && labelId && teamId === labelId) return m;
      if (teamId && normalize(sm.team).includes(normalize(parsed.team).split(" ").pop())) return m;
    }
    return null;
  }
  return null;
}

function isMlbLeg(leg) {
  if (!leg?.sport) return true;
  return leg.sport === "baseball_mlb";
}

function unmatchedEntry(leg, reason) {
  return { name: leg?.name || "(unnamed leg)", reason };
}

export function mapPromoLegsToKalshi(promoLegs, mlbGames) {
  const unmatched = [];
  const rows = [];
  for (const leg of promoLegs || []) {
    if (!isMlbLeg(leg)) {
      unmatched.push(unmatchedEntry(leg, "Combo Locks only maps MLB today"));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    if (leg.market === "TT") {
      unmatched.push(unmatchedEntry(leg, "team totals are not in Combo Locks"));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    const game = matchKalshiGame(leg, mlbGames);
    if (!game) {
      unmatched.push(unmatchedEntry(leg, "no matching Kalshi MLB game"));
      rows.push({ gameKey: "", marketVal: "" });
      continue;
    }
    const mkt = matchMarket(leg, game);
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
