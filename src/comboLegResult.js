// Underlying Combo Lock / parlay result from official sources only.
// Primary: Kalshi single-game market result (same /api/kalshi-games?tickers= path
// as combo-market settlement). Fallback: ESPN public scoreboard scores — never
// invented. Push when a scored game ties the line or a Kalshi market is void.

import { identifyTeam, normalize } from "./comboPrefill.js";
import { isOfficialSettlement } from "./comboSettlement.js";

const YES_NO = new Set(["yes", "no"]);
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

const ESPN_ABBR = {
  nfl: { JAC: "JAX", WSH: "WSH", WAS: "WSH", JACX: "JAX" },
  mlb: { CWS: "CHW", ATH: "ATH", AZ: "ARI", WSH: "WSH" },
};

export function normSide(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

export function sportFromTicker(ticker, gameKey) {
  const t = String(ticker || "");
  if (/KXMLB/i.test(t)) return "mlb";
  if (/KXNFL/i.test(t)) return "nfl";
  if (/KXNCAAF/i.test(t)) return "ncaaf";
  const gk = String(gameKey || "");
  if (gk.startsWith("mlb:")) return "mlb";
  if (gk.startsWith("nfl:")) return "nfl";
  if (gk.startsWith("ncaaf:")) return "ncaaf";
  return null;
}

export function rawGameKey(gameKey, ticker) {
  if (gameKey) {
    const s = String(gameKey);
    const i = s.indexOf(":");
    return i >= 0 ? s.slice(i + 1) : s;
  }
  const t = String(ticker || "");
  const i = t.indexOf("-");
  if (i < 0) return "";
  const rest = t.slice(i + 1);
  const j = rest.lastIndexOf("-");
  return j >= 0 ? rest.slice(0, j) : rest;
}

export function dateKeyFromGameKey(gameKey) {
  const k = rawGameKey(gameKey, null);
  const m = /^(\d{2})([A-Z]{3})(\d{2})/.exec(k || "");
  if (!m || !MONTHS[m[2]]) return null;
  return `20${m[1]}${MONTHS[m[2]]}${m[3]}`;
}

export function tickerTeamCode(ticker) {
  const t = String(ticker || "");
  const i = t.lastIndexOf("-");
  if (i < 0) return "";
  return t.slice(i + 1).replace(/\d+$/, "");
}

export function parseSpreadLabel(label) {
  const m = /^(.*?)\s*([+\u2212-])\s*([\d.]+)\s*$/.exec(String(label || "").trim());
  if (!m) return null;
  return { team: m[1].trim(), sign: m[2] === "+" ? "+" : "-", line: m[3] };
}

export function parseTotalLabel(label) {
  const m = /\b(over|under)\s+([\d.]+)/i.exec(String(label || ""));
  if (!m) return null;
  return { ou: m[1].toLowerCase(), line: m[2] };
}

export function espnQueryForLeg(leg) {
  if (!leg) return null;
  const sport = sportFromTicker(leg.ticker, leg.gameKey);
  const date = dateKeyFromGameKey(leg.gameKey || rawGameKey(leg.gameKey, leg.ticker));
  if (!sport || !date) return null;
  return { sport, date };
}

export function uniqueEspnQueries(parlays = []) {
  const seen = new Set();
  const out = [];
  for (const p of parlays || []) {
    for (const leg of (p && p.legs) || []) {
      const q = espnQueryForLeg(leg);
      if (!q) continue;
      const k = q.sport + ":" + q.date;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
  }
  return out;
}

function officialKalshiResult(market) {
  if (!market) return null;
  if (isOfficialSettlement(market)) return normSide(market.result);
  const status = normSide(market.status);
  const result = normSide(market.result);
  if ((status === "voided" || status === "void" || result === "void" || result === "voided") && !YES_NO.has(result)) {
    return "void";
  }
  return null;
}

export function legFromKalshiMarket(leg, market) {
  const official = officialKalshiResult(market);
  if (!official) return { status: "pending", source: "kalshi_legs" };
  if (official === "void") return { status: "push", source: "kalshi_legs", result: official };
  const side = normSide(leg && leg.side) || "yes";
  if (!YES_NO.has(official) || !YES_NO.has(side)) return { status: "pending", source: "kalshi_legs" };
  return { status: official === side ? "won" : "lost", source: "kalshi_legs", result: official };
}

export function combineLegResults(legRows = []) {
  const rows = (legRows || []).filter(Boolean);
  if (!rows.length) return { outcome: "pending", source: null };
  if (rows.some((r) => r.status === "lost")) {
    const src = rows.find((r) => r.status === "lost" && r.source)?.source || rows[0].source || null;
    return { outcome: "lost", source: src };
  }
  if (rows.some((r) => r.status === "pending")) return { outcome: "pending", source: null };
  if (rows.some((r) => r.status === "push")) {
    const src = rows.find((r) => r.source)?.source || null;
    return { outcome: "push", source: src };
  }
  if (rows.every((r) => r.status === "won")) {
    const sources = new Set(rows.map((r) => r.source).filter(Boolean));
    const source = sources.has("espn") && sources.size === 1 ? "espn"
      : sources.has("kalshi_legs") && !sources.has("espn") ? "kalshi_legs"
        : (sources.has("espn") ? "espn" : (sources.values().next().value || "kalshi_legs"));
    return { outcome: "won", source };
  }
  return { outcome: "pending", source: null };
}

export function underlyingCopy(outcome, { filled = false } = {}) {
  if (outcome === "won") {
    return filled
      ? { outcome, text: "parlay won", tone: "lose" }
      : { outcome, text: "would-have-won", tone: "win" };
  }
  if (outcome === "lost") {
    return filled
      ? { outcome, text: "parlay lost", tone: "win" }
      : { outcome, text: "would-have-lost", tone: "lose" };
  }
  if (outcome === "push") return { outcome, text: "push", tone: "wait" };
  if (outcome === "pending") return { outcome, text: "pending", tone: "wait" };
  return null;
}

function espnAbbr(code, sport) {
  const c = String(code || "").toUpperCase();
  const map = ESPN_ABBR[sport] || {};
  return map[c] || c;
}

function teamCodes(raw, sport) {
  const codes = new Set();
  const id = identifyTeam(raw, sport === "ncaaf" ? "nfl" : sport);
  if (id) {
    codes.add(id);
    codes.add(espnAbbr(id, sport));
  }
  const upper = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length >= 2 && upper.length <= 4) {
    codes.add(upper);
    codes.add(espnAbbr(upper, sport));
  }
  return codes;
}

export function namesMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

export function matchEspnSide(pick, game, sport) {
  if (!pick || !game) return null;
  const want = String(pick);
  const homeHits = teamCodes(game.homeAbbr, sport).has(want.toUpperCase())
    || namesMatch(want, game.home)
    || namesMatch(want, game.homeAbbr);
  const awayHits = teamCodes(game.awayAbbr, sport).has(want.toUpperCase())
    || namesMatch(want, game.away)
    || namesMatch(want, game.awayAbbr);
  if (homeHits && !awayHits) return "home";
  if (awayHits && !homeHits) return "away";
  return null;
}

function pickToken(leg) {
  const labelTeam = parseSpreadLabel(leg && leg.label);
  if (labelTeam && labelTeam.team) return labelTeam.team;
  if (leg && leg.label && !parseTotalLabel(leg.label)) return leg.label;
  return tickerTeamCode(leg && leg.ticker);
}

function abbrVariants(abbr, sport) {
  const a = String(abbr || "").toUpperCase();
  const out = new Set([a]);
  if (a === "JAX") out.add("JAC");
  if (a === "CHW") out.add("CWS");
  if (a === "ARI") out.add("AZ");
  if (a === "WSH") out.add("WAS");
  if (a === "TAMU") out.add("TXAM");
  out.add(espnAbbr(a, sport));
  return [...out].filter((v) => v && v.length >= 2);
}

export function gameKeyTeamBlob(gameKey, ticker) {
  const k = rawGameKey(gameKey, ticker).toUpperCase();
  return k.replace(/^\d{2}[A-Z]{3}\d{2}(\d{4})?/, "");
}

export function gameKeyMatchesEspn(gameKey, game, sport, ticker) {
  const rest = gameKeyTeamBlob(gameKey, ticker);
  if (!rest || !game) return false;
  const homeHit = abbrVariants(game.homeAbbr, sport).some((v) => rest.includes(v));
  const awayHit = abbrVariants(game.awayAbbr, sport).some((v) => rest.includes(v));
  return homeHit && awayHit;
}

export function findEspnGame(leg, games = []) {
  const sport = sportFromTicker(leg && leg.ticker, leg && leg.gameKey);
  const date = dateKeyFromGameKey((leg && leg.gameKey) || rawGameKey(leg && leg.gameKey, leg && leg.ticker));
  const pool = (games || []).filter((g) => (!sport || g.sport === sport) && (!date || g.date === date));
  const token = pickToken(leg);
  const tokenHits = pool.filter((g) => matchEspnSide(token, g, sport) || matchEspnSide(tickerTeamCode(leg && leg.ticker), g, sport));
  if (tokenHits.length === 1) return tokenHits[0];
  const keyHits = pool.filter((g) => gameKeyMatchesEspn(leg && leg.gameKey, g, sport, leg && leg.ticker));
  if (keyHits.length === 1) return keyHits[0];
  return null;
}

export function legFromEspnGame(leg, game) {
  if (!leg || !game || !game.completed) return { status: "pending", source: "espn" };
  const hs = Number(game.homeScore);
  const as = Number(game.awayScore);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return { status: "pending", source: "espn" };
  const type = String(leg.type || "").toLowerCase();
  const sport = sportFromTicker(leg.ticker, leg.gameKey);

  if (type === "total") {
    const parsed = parseTotalLabel(leg.label);
    if (!parsed) return { status: "pending", source: "espn" };
    const total = hs + as;
    const line = Number(parsed.line);
    if (!Number.isFinite(line)) return { status: "pending", source: "espn" };
    if (total === line) return { status: "push", source: "espn" };
    const over = total > line;
    const wantOver = parsed.ou === "over";
    return { status: over === wantOver ? "won" : "lost", source: "espn" };
  }

  if (type === "spread") {
    const parsed = parseSpreadLabel(leg.label);
    if (!parsed) return { status: "pending", source: "espn" };
    const side = matchEspnSide(parsed.team, game, sport);
    if (!side) return { status: "pending", source: "espn" };
    const our = side === "home" ? hs : as;
    const opp = side === "home" ? as : hs;
    const line = parsed.sign === "+" ? Number(parsed.line) : -Number(parsed.line);
    if (!Number.isFinite(line)) return { status: "pending", source: "espn" };
    const adj = our + line - opp;
    if (Math.abs(adj) < 1e-9) return { status: "push", source: "espn" };
    return { status: adj > 0 ? "won" : "lost", source: "espn" };
  }

  const token = pickToken(leg);
  const pickSide = matchEspnSide(token, game, sport) || matchEspnSide(tickerTeamCode(leg.ticker), game, sport);
  if (!pickSide) return { status: "pending", source: "espn" };
  if (hs === as) return { status: "push", source: "espn" };
  const winner = hs > as ? "home" : "away";
  const tickerWon = pickSide === winner;
  const pickedYes = normSide(leg.side) !== "no";
  return { status: tickerWon === pickedYes ? "won" : "lost", source: "espn" };
}

export function settleLegs({ legs = [], kalshiMarkets = {}, espnGames = [] } = {}) {
  const rows = (legs || []).map((leg) => {
    const ticker = leg && leg.ticker;
    const fromKalshi = ticker && kalshiMarkets[ticker] ? legFromKalshiMarket(leg, kalshiMarkets[ticker]) : null;
    if (fromKalshi && fromKalshi.status !== "pending") {
      return { ...fromKalshi, ticker, label: leg.label, type: leg.type };
    }
    const game = findEspnGame(leg, espnGames);
    const fromEspn = game ? legFromEspnGame(leg, game) : { status: "pending", source: null };
    return { ...fromEspn, ticker, label: leg.label, type: leg.type };
  });
  const combined = combineLegResults(rows);
  return { legs: rows, ...combined };
}

export function sourceLabel(source) {
  if (source === "kalshi_legs") return "Kalshi legs";
  if (source === "espn") return "ESPN scoreboard";
  if (source === "kalshi_combo") return "Kalshi combo";
  return null;
}
