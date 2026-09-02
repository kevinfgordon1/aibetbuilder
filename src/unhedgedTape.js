// Unhedged RFQ blotter — read-only mapping over public.unhedged_rfqs.
// Combo-worker writes this table in a parallel PR. Column names may arrive
// incrementally; pick known aliases and never invent a price.
//
// Worker statuses: seen, started, would_quote, filled. A row with
// our_quote_american / would_quote is would_quote even if status is still
// seen. The page summary and tape are MLB + NFL moneylines only.
// Legs read as Kevin scans parlays: "Rockies ML +145" from ticker team
// code + side + optional per-leg fair_american. Row our_fair_american is
// the parlay fair (Would-quote / Fair column) — never copied onto chips.
// Missing table must become an empty state (PGRST205 / 42P01), not a throw.

export const UNHEDGED_TABLE = "unhedged_rfqs";
export const UNHEDGED_LIMIT = 400;
export const UNHEDGED_STATUSES = ["seen", "started", "would_quote", "quoted", "filled"];
export const UNHEDGED_ML_LEAGUES = ["mlb", "nfl"];

const TIME_KEYS = [
  "created_at",
  "seen_at",
  "quoted_at",
  "filled_at",
  "rfq_created_ts",
  "created_ts",
  "created_time",
  "createdTime",
  "ts",
  "time",
  "at",
];

const VENUE_KEYS = ["venue", "exchange", "source", "book"];
const LABEL_KEYS = ["label", "title", "market_label", "parlay_label", "market_ticker", "ticker"];
const LEGS_KEYS = ["legs", "combo_legs", "comboLegs", "mve_selected_legs", "selected_legs"];
const CONTRACT_KEYS = ["contracts", "contracts_fp", "qty", "size", "count", "qtyDecimal"];

const THEIR_AMERICAN_KEYS = [
  "taker_american",
  "rfq_american",
  "their_american",
  "rfq_price_american",
  "their_price_american",
];
const THEIR_YES_KEYS = ["taker_yes_price", "rfq_yes", "their_yes", "yes_price", "rfq_price", "target_yes"];
const THEIR_NO_KEYS = ["taker_no_price", "rfq_no", "their_no", "no_price"];

const OUR_AMERICAN_KEYS = [
  "our_quote_american",
  "would_quote_american",
  "our_american",
  "our_fair_american",
  "fair_american",
];
const OUR_PRICE_KEYS = ["would_quote", "our_quote", "fair"];

// Per-leg fair only. Row our_fair_american is the parlay fair — never copy it onto chips.
const LEG_FAIR_AMERICAN_KEYS = ["fair_american", "our_fair_american", "true_american"];

const FILL_AMERICAN_KEYS = ["fill_american", "filled_american", "fill_price_american"];
const FILL_PRICE_KEYS = ["fill_yes_price", "fill_price", "fill", "filled_price"];

const NON_ML_MARKET = /\b(spread|run[_ -]?line|total|over_under|\bou\b|prop|props)\b|kx(mlb|nfl)(spread|total)/i;
const ML_TYPE = /^(ml|moneyline|h2h|game)$/i;
const GAME_ML_ID = /kx(mlb|nfl)game-|aec-(mlb|nfl)-/i;
const TICKER_BLOB = /^(kx[a-z0-9]*-|aec-(mlb|nfl|ncaaf)-)/i;
const TEAM_CODE = /^[A-Za-z]{2,4}$/;

// Short names Kevin says when he reads a parlay. Sox keep the color/city so
// Red Sox and White Sox do not collapse. WAS/WSH is Nats in MLB, Commanders in NFL.
const MLB_TEAM_NAMES = {
  ARI: "D-backs", AZ: "D-backs",
  ATL: "Braves",
  BAL: "Orioles",
  BOS: "Red Sox",
  CHC: "Cubs",
  CWS: "White Sox", CHW: "White Sox",
  CIN: "Reds",
  CLE: "Guardians",
  COL: "Rockies",
  DET: "Tigers",
  HOU: "Astros",
  KC: "Royals", KCR: "Royals",
  LAA: "Angels",
  LAD: "Dodgers",
  MIA: "Marlins",
  MIL: "Brewers",
  MIN: "Twins",
  NYM: "Mets",
  NYY: "Yanks",
  ATH: "A's", OAK: "A's",
  PHI: "Phillies",
  PIT: "Pirates",
  SD: "Padres", SDP: "Padres",
  SF: "Giants", SFG: "Giants",
  SEA: "Mariners",
  STL: "Cards",
  TB: "Rays", TBR: "Rays",
  TEX: "Rangers",
  TOR: "Jays",
  WSH: "Nats", WAS: "Nats",
};

const NFL_TEAM_NAMES = {
  ARI: "Cardinals",
  ATL: "Falcons",
  BAL: "Ravens",
  BUF: "Bills",
  CAR: "Panthers",
  CHI: "Bears",
  CIN: "Bengals",
  CLE: "Browns",
  DAL: "Cowboys",
  DEN: "Broncos",
  DET: "Lions",
  GB: "Packers", GNB: "Packers",
  HOU: "Texans",
  IND: "Colts",
  JAC: "Jags", JAX: "Jags",
  KC: "Chiefs", KCC: "Chiefs",
  LAC: "Chargers",
  LAR: "Rams",
  LV: "Raiders", LVR: "Raiders",
  MIA: "Dolphins",
  MIN: "Vikings",
  NE: "Patriots", NWE: "Patriots",
  NO: "Saints", NOR: "Saints",
  NYG: "Giants",
  NYJ: "Jets",
  PHI: "Eagles",
  PIT: "Steelers",
  SEA: "Seahawks",
  SF: "Niners", SFO: "Niners",
  TB: "Bucs", TAM: "Bucs",
  TEN: "Titans",
  WAS: "Commanders", WSH: "Commanders",
};

const MLB_CODE_ALIAS = { WAS: "WSH", CHW: "CWS", AZ: "ARI", OAK: "ATH", KCR: "KC", SDP: "SD", SFG: "SF", TBR: "TB" };
const NFL_CODE_ALIAS = { WSH: "WAS", JAX: "JAC", GNB: "GB", NWE: "NE", NOR: "NO", LVR: "LV", SFO: "SF", TAM: "TB", KCC: "KC" };

export function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pickFirst(row, keys) {
  if (!row || !keys) return null;
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

export function americanFromProb(p) {
  const n = toNum(p);
  if (!(n > 0 && n < 1)) return null;
  return n < 0.5
    ? Math.round((100 * (1 - n)) / n)
    : -Math.round((100 * n) / (1 - n));
}

export function formatAmerican(a) {
  const n = toNum(a);
  if (n == null || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole > 0 ? "+" + whole : String(whole);
}

// How Kevin scans a board: unicode minus, never invented from a ticker.
export function formatScanAmerican(a) {
  const text = formatAmerican(a);
  return text ? text.replace(/-/g, "\u2212") : null;
}

// Explicit American fields (or integer-like odds). 0 < n < 1 is a probability,
// not American — do not treat 0.23 as +0.
export function coerceAmerican(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "—") return null;
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n)) return null;
      if (n > 0 && n < 1) return americanFromProb(n);
      return Math.round(n);
    }
    return null;
  }
  const n = toNum(value);
  if (n == null) return null;
  if (n > 0 && n < 1) return americanFromProb(n);
  return Math.round(n);
}

export function rowTime(row) {
  return pickFirst(row, TIME_KEYS);
}

export function timeMs(ts) {
  if (ts == null || ts === "") return 0;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

export function formatEtTime(ts) {
  const ms = timeMs(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

export function venueKey(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  if (s === "kalshi" || s === "kxi" || s.startsWith("kalshi")) return "kalshi";
  if (s === "polymarket" || s === "poly" || s === "pm" || s.startsWith("polymarket")) return "polymarket";
  return s;
}

export function formatVenue(value) {
  const key = venueKey(value);
  if (key === "kalshi") return "Kalshi";
  if (key === "polymarket") return "Polymarket";
  if (!key) return "—";
  return String(value).trim();
}

export function isTickerBlob(value) {
  const t = String(value == null ? "" : value).trim();
  if (!t) return false;
  if (TICKER_BLOB.test(t)) return true;
  if (!t.includes("-")) return false;
  return /KXMLB|KXNFL|KXNCAAF|KXMVE|GAME|SPREAD|TOTAL/i.test(t) && !/\s/.test(t);
}

export function normalizeTeamCode(raw, league = "") {
  const code = String(raw == null ? "" : raw).trim().toUpperCase();
  if (!code) return "";
  const alias = league === "nfl" ? NFL_CODE_ALIAS[code] : MLB_CODE_ALIAS[code];
  return alias || code;
}

export function teamDisplayName(raw, league = "") {
  const code = normalizeTeamCode(raw, league);
  if (!code) return "";
  const table = league === "nfl" ? NFL_TEAM_NAMES : MLB_TEAM_NAMES;
  if (table[code]) return table[code];
  if (league !== "nfl" && league !== "mlb") {
    return MLB_TEAM_NAMES[code] || NFL_TEAM_NAMES[code] || "";
  }
  return "";
}

function lastTickerTeamCode(ticker) {
  const s = String(ticker == null ? "" : ticker).trim();
  if (!s) return "";
  const parts = s.split("-").filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  return TEAM_CODE.test(last) ? last.toUpperCase() : "";
}

function codeFromToken(raw) {
  const t = String(raw == null ? "" : raw).trim();
  return TEAM_CODE.test(t) ? t.toUpperCase() : "";
}

function teamCodesFromList(teams, league) {
  if (!Array.isArray(teams)) return [];
  const out = [];
  for (const t of teams) {
    const code = codeFromToken(t);
    if (!code) continue;
    const norm = normalizeTeamCode(code, league);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

function resolveTeamCode(leg, league) {
  if (!leg || typeof leg !== "object") return "";
  const fromTicker = lastTickerTeamCode(leg.ticker || leg.market_ticker || "");
  if (fromTicker) return normalizeTeamCode(fromTicker, league);
  const fromSelection = codeFromToken(leg.selection);
  if (fromSelection) return normalizeTeamCode(fromSelection, league);
  const fromLabel = codeFromToken(leg.label);
  if (fromLabel) return normalizeTeamCode(fromLabel, league);
  return "";
}

function resolveOpponentCode(leg, league, teamCode) {
  const codes = teamCodesFromList(leg && leg.teams, league);
  if (codes.length < 2 || !teamCode) return "";
  return codes.find((c) => c !== teamCode) || "";
}

function formatNamedSide(name, side) {
  if (!name) return "";
  return String(side || "").trim().toLowerCase() === "no" ? `${name} lose` : `${name} ML`;
}

function formatCodePhrase(raw, league, suffix) {
  const token = String(raw == null ? "" : raw).trim();
  if (!token) return "";
  const name = teamDisplayName(token, league);
  if (name) return `${name} ${suffix}`;
  return `${token} ${suffix}`;
}

export function formatUnhedgedLegName(leg, leagueHint = "") {
  if (leg == null) return "";
  if (typeof leg === "string") {
    const text = leg.trim();
    if (!text || isTickerBlob(text)) return "";
    const phrase = /^(.*?)\s+(ML|lose)$/i.exec(text);
    if (phrase) {
      const suffix = /lose/i.test(phrase[2]) ? "lose" : "ML";
      return formatCodePhrase(phrase[1], leagueHint, suffix);
    }
    if (TEAM_CODE.test(text)) {
      const name = teamDisplayName(text, leagueHint);
      if (name) return `${name} ML`;
      if (text === text.toUpperCase()) return `${text} ML`;
      return text;
    }
    return text;
  }
  if (typeof leg !== "object") return "";

  const league = leagueHint || legLeague(leg);
  const side = String(leg.side || "").trim().toLowerCase();
  const teamCode = resolveTeamCode(leg, league);
  if (teamCode) {
    if (side === "no") {
      const opp = resolveOpponentCode(leg, league, teamCode);
      if (opp) {
        const oppName = teamDisplayName(opp, league) || opp;
        return `${oppName} ML`;
      }
      const teamName = teamDisplayName(teamCode, league) || teamCode;
      return `${teamName} lose`;
    }
    const teamName = teamDisplayName(teamCode, league) || teamCode;
    return `${teamName} ML`;
  }

  const human = [leg.label, leg.title, leg.selection]
    .map((v) => String(v == null ? "" : v).trim())
    .find((v) => v && !isTickerBlob(v));
  if (!human) return "";
  const phrase = /^(.*?)\s+(ML|lose)$/i.exec(human);
  if (phrase) {
    const suffix = /lose/i.test(phrase[2]) ? "lose" : "ML";
    return formatCodePhrase(phrase[1], league, suffix);
  }
  if (TEAM_CODE.test(human)) {
    return formatNamedSide(teamDisplayName(human, league) || human.toUpperCase(), side);
  }
  if (side === "yes" || side === "no" || ML_TYPE.test(String(leg.type || ""))) {
    return formatNamedSide(human, side);
  }
  return human;
}

export function formatUnhedgedLeg(leg, leagueHint = "") {
  return withLegFair(formatUnhedgedLegName(leg, leagueHint), leg);
}

export function legFairAmerican(leg) {
  if (!leg || typeof leg !== "object") return null;
  const stated = pickFirst(leg, LEG_FAIR_AMERICAN_KEYS);
  if (stated == null) return null;
  const n = coerceAmerican(stated);
  return n == null || n === 0 ? null : n;
}

function withLegFair(name, leg) {
  if (!name) return "";
  const fairText = formatScanAmerican(legFairAmerican(leg));
  return fairText ? `${name} ${fairText}` : name;
}

function legChip(leg) {
  if (leg == null) return null;
  const text = formatUnhedgedLeg(leg);
  if (!text || isTickerBlob(text)) return null;
  return { type: "", text, fairAmerican: legFairAmerican(leg) };
}

function rawLegList(row) {
  const raw = pickFirst(row, LEGS_KEYS);
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? [text] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((leg) => leg != null && leg !== "");
}

function legBlob(leg) {
  if (leg == null) return "";
  if (typeof leg === "string") return leg;
  if (typeof leg !== "object") return "";
  return [leg.league, leg.sport, leg.type, leg.market, leg.market_type, leg.ticker, leg.symbol, leg.market_ticker, leg.slug, leg.label, leg.title]
    .filter(Boolean)
    .join(" ");
}

export function legLeague(leg) {
  if (leg == null) return "";
  const blob = String(legBlob(leg)).toLowerCase();
  if (typeof leg === "object") {
    const stated = String(leg.league || leg.sport || "").trim().toLowerCase();
    if (stated === "mlb" || stated === "baseball_mlb") return "mlb";
    if (stated === "nfl" || stated === "americanfootball_nfl") return "nfl";
    if (stated === "ncaaf" || stated === "americanfootball_ncaaf") return "ncaaf";
  }
  if (/\bncaaf\b|kxncaaf|aec-ncaaf/.test(blob)) return "ncaaf";
  if (/kxnflgame|aec-nfl-/.test(blob)) return "nfl";
  if (/kxmlbgame|aec-mlb-/.test(blob)) return "mlb";
  if (/\bnfl\b/.test(blob) && !/ncaaf/.test(blob)) return "nfl";
  if (/\bmlb\b/.test(blob)) return "mlb";
  return "";
}

export function isMoneylineLeg(leg) {
  if (leg == null) return false;
  const blob = legBlob(leg);
  if (NON_ML_MARKET.test(blob)) return false;
  if (typeof leg === "object") {
    const type = String(leg.type || leg.market || leg.market_type || "").trim();
    if (type && ML_TYPE.test(type)) return true;
  }
  if (GAME_ML_ID.test(blob)) return true;
  const league = legLeague(leg);
  return league === "mlb" || league === "nfl";
}

// True when every leg is an MLB or NFL moneyline. Mixed or NCAAF rows are out.
export function isMlbNflMoneylineRow(row) {
  const legs = rawLegList(row);
  if (!legs.length) return false;
  return legs.every((leg) => {
    const league = legLeague(leg);
    return (league === "mlb" || league === "nfl") && isMoneylineLeg(leg);
  });
}

export function filterMlbNflMoneylineRows(rows) {
  return (rows || []).filter(isMlbNflMoneylineRow);
}

export function rowLegs(row) {
  const raw = pickFirst(row, LEGS_KEYS);
  const league = row ? legLeague(row) : "";
  if (typeof raw === "string") {
    const text = formatUnhedgedLeg(raw, league);
    return text ? [{ type: "", text }] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(legChip).filter(Boolean);
}

export function rowLabel(row) {
  const chips = rowLegs(row);
  const texts = chips.map((c) => c.text).filter((t) => t && !isTickerBlob(t));
  if (texts.length) return texts.join(" · ");
  const label = pickFirst(row, LABEL_KEYS);
  if (label != null && String(label).trim() && !isTickerBlob(label)) {
    return formatUnhedgedLeg(String(label).trim()) || String(label).trim();
  }
  return "—";
}

export function rowContracts(row) {
  return toNum(pickFirst(row, CONTRACT_KEYS));
}

export function theirRfqAmerican(row) {
  const stated = pickFirst(row, THEIR_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const yes = pickFirst(row, THEIR_YES_KEYS);
  const fromYes = yes != null ? coerceAmerican(yes) : null;
  if (fromYes != null) return fromYes;
  const no = toNum(pickFirst(row, THEIR_NO_KEYS));
  if (no != null && no > 0 && no < 1) return americanFromProb(1 - no);
  return null;
}

export function ourQuoteAmerican(row) {
  const stated = pickFirst(row, OUR_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const price = pickFirst(row, OUR_PRICE_KEYS);
  return price != null ? coerceAmerican(price) : null;
}

export function fillAmerican(row) {
  const stated = pickFirst(row, FILL_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const price = pickFirst(row, FILL_PRICE_KEYS);
  return price != null ? coerceAmerican(price) : null;
}

export function normalizeStatus(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "seen" || raw === "received" || raw === "new") return "seen";
  if (raw === "started" || raw === "start" || raw === "in_progress") return "started";
  if (raw === "would_quote" || raw === "wouldquote" || raw === "would") return "would_quote";
  if (raw === "quoted" || raw === "quote" || raw === "posted") return "quoted";
  if (raw === "filled" || raw === "fill" || raw === "executed") return "filled";
  return null;
}

export function rowStatus(row) {
  const fromCol = normalizeStatus(pickFirst(row, ["status", "state"]));
  if (fromCol === "filled" || fillAmerican(row) != null) return "filled";
  if (fromCol === "quoted") return "quoted";
  if (fromCol === "would_quote" || ourQuoteAmerican(row) != null) return "would_quote";
  if (fromCol === "started") return "started";
  return fromCol || "seen";
}

export function statusTone(status) {
  if (status === "filled") return "ok";
  if (status === "quoted") return "fill";
  if (status === "started") return "fill";
  if (status === "would_quote") return "warn";
  return "";
}

// Counts over already-mapped (and already-filtered) rows. Do not invent.
export function summarizeUnhedgedRows(rows, { fetched = null } = {}) {
  const list = rows || [];
  const summary = {
    fetched: fetched == null ? list.length : fetched,
    total: list.length,
    seen: 0,
    started: 0,
    wouldQuote: 0,
    quoted: 0,
    filled: 0,
  };
  for (const r of list) {
    const status = r && r.status;
    if (status === "filled") summary.filled += 1;
    else if (status === "quoted") summary.quoted += 1;
    else if (status === "would_quote") summary.wouldQuote += 1;
    else if (status === "started") summary.started += 1;
    else if (status === "seen") summary.seen += 1;
  }
  return summary;
}

export function formatContracts(n) {
  const v = toNum(n);
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(v);
}

export function mapUnhedgedRow(row, index = 0) {
  const at = rowTime(row);
  const venueRaw = pickFirst(row, VENUE_KEYS);
  const status = rowStatus(row);
  return {
    id: (row && (row.id || row.rfq_id)) || `row-${index}`,
    at,
    timeEt: formatEtTime(at),
    venue: formatVenue(venueRaw),
    venueKey: venueKey(venueRaw),
    label: rowLabel(row),
    legs: rowLegs(row),
    contracts: rowContracts(row),
    contractsText: formatContracts(rowContracts(row)),
    theirAmerican: theirRfqAmerican(row),
    theirText: formatAmerican(theirRfqAmerican(row)) || "—",
    ourAmerican: ourQuoteAmerican(row),
    ourText: formatAmerican(ourQuoteAmerican(row)) || "—",
    status,
    statusTone: statusTone(status),
    fillAmerican: fillAmerican(row),
    fillText: formatAmerican(fillAmerican(row)) || "—",
  };
}

export function sortUnhedgedRows(rows) {
  return [...(rows || [])].sort((a, b) => timeMs(b.at) - timeMs(a.at) || String(b.id).localeCompare(String(a.id)));
}

export function mapUnhedgedRows(rows) {
  return sortUnhedgedRows((rows || []).map((row, i) => mapUnhedgedRow(row, i)));
}

function errorText(error) {
  if (!error) return "";
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = errorText(error);
  return (
    msg.includes("could not find the table")
    || (msg.includes("unhedged_rfqs") && (
      msg.includes("does not exist")
      || msg.includes("not find")
      || msg.includes("schema cache")
    ))
  );
}

export function isMissingUserIdColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!msg.includes("user_id")) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

async function runSelect(client, { userId, limit }) {
  let q = client.from(UNHEDGED_TABLE).select("*");
  if (userId) q = q.eq("user_id", userId);
  if (typeof q.order === "function") q = q.order("created_at", { ascending: false });
  if (typeof q.limit === "function") q = q.limit(limit);
  return q;
}

// Select * for the signed-in user when user_id exists on the table; otherwise
// every row RLS already allows. A missing table is an empty blotter, not a crash.
export async function fetchUnhedgedRfqs(client, { userId = null, limit = UNHEDGED_LIMIT } = {}) {
  if (!client || typeof client.from !== "function") {
    return { rows: [], missingTable: false, error: { message: "no client" } };
  }
  let result;
  try {
    result = await runSelect(client, { userId, limit });
  } catch (err) {
    if (isMissingTableError(err)) return { rows: [], missingTable: true, error: err };
    return { rows: [], missingTable: false, error: err };
  }
  let error = result && result.error;
  let data = result && result.data;
  if (error && userId && isMissingUserIdColumn(error)) {
    try {
      result = await runSelect(client, { userId: null, limit });
    } catch (err) {
      if (isMissingTableError(err)) return { rows: [], missingTable: true, error: err };
      return { rows: [], missingTable: false, error: err };
    }
    error = result && result.error;
    data = result && result.data;
  }
  if (error && isMissingTableError(error)) {
    return { rows: [], missingTable: true, error };
  }
  if (error) return { rows: [], missingTable: false, error };
  return { rows: Array.isArray(data) ? data : [], missingTable: false, error: null };
}
