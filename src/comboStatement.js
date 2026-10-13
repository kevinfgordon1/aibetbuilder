// Running P/L from Combo Locks history.
// Locked fills use soFar payoffs (actual filled contracts). Settled unfilled
// locks use the current unhedged risk profile. Official Kalshi combo result
// wins over underlying (Kalshi legs / ESPN). Never invents a score.
// Profile statement filters/sort/CSV are client-side over loaded lines.

import { lockProfile } from "./comboLockProfile.js";
import { isAbsorbedParlay } from "./comboMerge.js";
import { historyOutcome, settlementFromStored, settlementCopy } from "./comboSettlement.js";
import { sportFromTicker, underlyingCopy } from "./comboLegResult.js";

export const STATEMENT_TZ = "America/New_York";
// History spans many days; Today is often empty. Default All.
export const STATEMENT_DEFAULT_DATE_RANGE = "all";
export const STATEMENT_DATE_FILTERS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];
export const STATEMENT_KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "locked_fill", label: "Locked fills" },
  { key: "unfilled", label: "Unfilled" },
  { key: "open", label: "Open" },
];
export const STATEMENT_RESULT_FILTERS = [
  { key: "all", label: "All" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "pending", label: "Pending" },
  { key: "would_have", label: "Risk" },
];

const SPORT_LABEL = {
  mlb: "MLB",
  nfl: "NFL",
  ncaaf: "NCAAF",
  nba: "NBA",
  nhl: "NHL",
  ncaab: "NCAAB",
  wnba: "WNBA",
};
const SPORT_ORDER = ["mlb", "nfl", "ncaaf", "nba", "nhl", "ncaab", "wnba"];
const SPORT_ALIASES = {
  baseball_mlb: "mlb",
  baseball: "mlb",
  americanfootball_nfl: "nfl",
  americanfootball_ncaaf: "ncaaf",
  cfb: "ncaaf",
  basketball_nba: "nba",
  icehockey_nhl: "nhl",
  basketball_ncaab: "ncaab",
  cbb: "ncaab",
  basketball_wnba: "wnba",
};

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeSportKey(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return "";
  if (SPORT_ALIASES[s]) return SPORT_ALIASES[s];
  if (SPORT_LABEL[s]) return s;
  return s.replace(/^(americanfootball|basketball|icehockey|baseball)_/, "");
}

export function sportLabel(sport) {
  const key = normalizeSportKey(sport);
  if (!key) return "";
  return SPORT_LABEL[key] || key.toUpperCase();
}

function sportFromLeg(leg) {
  if (!leg) return "";
  const fromTicker = sportFromTicker(leg.ticker, leg.gameKey);
  if (fromTicker) return fromTicker;
  const t = String(leg.ticker || "");
  if (/KXWNBA/i.test(t)) return "wnba";
  if (/KXNCAAB/i.test(t) || /KXNCAAM/i.test(t)) return "ncaab";
  if (/KXNBA/i.test(t)) return "nba";
  if (/KXNHL/i.test(t)) return "nhl";
  return normalizeSportKey(leg.sport);
}

function sortSports(sports) {
  return (sports || []).slice().sort((a, b) => {
    const ia = SPORT_ORDER.indexOf(a);
    const ib = SPORT_ORDER.indexOf(b);
    if (ia < 0 && ib < 0) return String(a).localeCompare(String(b));
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
}

export function sportsFromParlay(parlay) {
  const seen = new Set();
  for (const leg of (parlay && parlay.legs) || []) {
    const sport = sportFromLeg(leg);
    if (sport) seen.add(sport);
  }
  return sortSports([...seen]);
}

function searchHaystack(parlay, label) {
  const parts = [label];
  for (const leg of (parlay && parlay.legs) || []) {
    if (!leg) continue;
    if (leg.label) parts.push(leg.label);
    if (leg.game) parts.push(leg.game);
    if (leg.team) parts.push(leg.team);
    if (leg.name) parts.push(leg.name);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function kindLabel(kind) {
  if (kind === "locked_fill") return "locked fill";
  if (kind === "unfilled") return "unfilled";
  return "open";
}

function resultFilterOf({ resultKind, official, side }) {
  if (resultKind === "official") {
    if (official && official.weWon) return "won";
    if (official && official.weWon === false) return "lost";
    if (side === "miss") return "won";
    if (side === "hit") return "lost";
  }
  if (resultKind === "underlying") return "would_have";
  return "pending";
}

export function normalizeStatementDateRange(value) {
  const key = String(value == null ? "" : value).trim().toLowerCase();
  if (key === "today" || key === "7d" || key === "30d" || key === "all") return key;
  if (key === "week") return "7d";
  if (key === "month" || key === "30day" || key === "30days") return "30d";
  if (key === "alltime" || key === "all-time" || key === "any") return "all";
  return STATEMENT_DEFAULT_DATE_RANGE;
}

export function normalizeStatementKind(value) {
  const key = String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, "_");
  if (key === "locked_fill" || key === "locked" || key === "fills" || key === "fill") return "locked_fill";
  if (key === "unfilled") return "unfilled";
  if (key === "open" || key === "pending") return "open";
  return "all";
}

export function normalizeStatementResult(value) {
  const key = String(value == null ? "" : value).trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (key === "won" || key === "lost" || key === "pending" || key === "would_have") return key;
  if (key === "wouldhave" || key === "would" || key === "risk") return "would_have";
  return "all";
}

export function etYmd(value) {
  const ms = tsMs(value);
  if (ms == null) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STATEMENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function statementDateWindow(range, now = new Date()) {
  const preset = normalizeStatementDateRange(range);
  const at = now instanceof Date ? now : new Date(now);
  if (preset === "all") return { preset, from: null, to: null };
  if (preset === "today") {
    return { preset, from: null, to: null, ymd: etYmd(at) };
  }
  const days = preset === "7d" ? 7 : 30;
  return { preset, from: new Date(at.getTime() - days * 24 * 60 * 60 * 1000).toISOString(), to: null };
}

export function lineInDateWindow(line, window) {
  if (!window || window.preset === "all" || (!window.from && !window.to && !window.ymd)) return true;
  const ts = line && (line.sortAt || line.createdAt || line.at);
  if (!ts) return true;
  const ms = tsMs(ts);
  if (ms == null) return true;
  if (window.ymd) return etYmd(ms) === window.ymd;
  if (window.from && ms < Date.parse(window.from)) return false;
  if (window.to && ms >= Date.parse(window.to)) return false;
  return true;
}

export function formatStatementDate(ts) {
  const ms = tsMs(ts);
  if (ms == null) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: STATEMENT_TZ,
    month: "short",
    day: "numeric",
  });
}

export function statementDateCopy(line) {
  if (!line) return "still open";
  const created = formatStatementDate(line.createdAt);
  if (line.settled) {
    const settled = formatStatementDate(line.settledAt);
    if (created && settled && created !== settled) return `${created} · settled ${settled}`;
    if (settled) return created ? `${created} · settled` : `settled ${settled}`;
    return created ? `${created} · settled` : "settled";
  }
  if (line.resultKind === "awaiting") return created ? `${created} · awaiting` : "awaiting";
  return created ? `${created} · still open` : "still open";
}

// Newest first, stable: settled/created time, then created time, then id.
export function sortStatementLines(lines) {
  return (lines || []).slice().sort((a, b) => {
    const ta = tsMs(a && a.sortAt) || 0;
    const tb = tsMs(b && b.sortAt) || 0;
    if (tb !== ta) return tb - ta;
    const ca = tsMs(a && a.createdAt) || 0;
    const cb = tsMs(b && b.createdAt) || 0;
    if (cb !== ca) return cb - ca;
    const ia = String((a && a.id) || "");
    const ib = String((b && b.id) || "");
    return ia < ib ? 1 : ia > ib ? -1 : 0;
  });
}

export function summarizeStatementLines(lines) {
  let realized = 0;
  let lockedFillPnl = 0;
  let unfilledPnl = 0;
  let pending = 0;
  let lockedFills = 0;
  let unfilledSettled = 0;
  for (const line of lines || []) {
    if (line.settled && line.pnl != null) {
      realized = r2(realized + line.pnl);
      if (line.kind === "locked_fill" || line.bucket === "locked_fill") {
        lockedFillPnl = r2(lockedFillPnl + line.pnl);
        lockedFills += 1;
      } else if (line.kind === "unfilled" || line.bucket === "unfilled") {
        unfilledPnl = r2(unfilledPnl + line.pnl);
        unfilledSettled += 1;
      }
    } else {
      pending += 1;
    }
  }
  return {
    realized,
    lockedFillPnl,
    unfilledPnl,
    pending,
    lockedFills,
    unfilledSettled,
    count: (lines || []).length,
  };
}

export function filterStatementLines(lines, {
  dateRange = STATEMENT_DEFAULT_DATE_RANGE,
  kind = "all",
  result = "all",
  sport = "all",
  query = "",
  now,
} = {}) {
  const window = statementDateWindow(dateRange, now);
  const kindKey = normalizeStatementKind(kind);
  const resultKey = normalizeStatementResult(result);
  const sportKey = normalizeSportKey(sport);
  const q = String(query || "").trim().toLowerCase();
  return (lines || []).filter((line) => {
    if (!lineInDateWindow(line, window)) return false;
    if (kindKey !== "all" && line.kind !== kindKey) return false;
    if (resultKey !== "all" && line.resultFilter !== resultKey) return false;
    if (sportKey && sportKey !== "all" && !(line.sports || []).includes(sportKey)) return false;
    if (q && !(line.searchText || "").includes(q)) return false;
    return true;
  });
}

export function applyStatementFilters(statement, filters) {
  const lines = filterStatementLines(statement && statement.lines, filters);
  return { ...(statement || {}), lines, ...summarizeStatementLines(lines) };
}

export function statementSportsPresent(lines) {
  const seen = new Set();
  for (const line of lines || []) {
    for (const s of line.sports || []) {
      if (s) seen.add(s);
    }
  }
  return sortSports([...seen]);
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function statementCsv(lines) {
  const header = ["title", "kind", "result", "P/L", "created", "settled", "sport"];
  const rows = (lines || []).map((line) => [
    csvCell(line.label || ""),
    csvCell(line.kindLabel || kindLabel(line.kind)),
    csvCell(line.resultLabel || ""),
    csvCell(line.pnl == null ? "" : String(line.pnl)),
    csvCell(line.createdAt || ""),
    csvCell(line.settledAt || ""),
    csvCell((line.sportLabels || (line.sports || []).map(sportLabel)).join("+")),
  ].join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function statementCsvFilename(now = new Date()) {
  const ymd = etYmd(now) || "export";
  return `combo-pl-statement-${ymd}.csv`;
}

function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function filledContracts(parlay, fillsById = {}) {
  if (!parlay) return 0;
  const fromMap = toNum(fillsById[parlay.id]);
  if (fromMap != null && fromMap > 0) return fromMap;
  return 0;
}

function payoffsForLine(profile, filled) {
  if (!profile) return null;
  if (filled > 0 && profile.soFar) return profile.soFar;
  return profile.current;
}

function aDec(a) {
  const n = toNum(a);
  if (n == null || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function aProb(a) {
  const d = aDec(a);
  return d ? 1 / d : null;
}

// Real fill prices for one lock. Maker combo fills with a stored YES price
// (what the buyer paid us per contract) are used as-is; contracts without a
// price (Polymarket rows today) fall back to the lock's fill_american.
export function lockFillReceipt(parlay, fills = [], filled = 0) {
  const n = Math.max(0, toNum(filled) || 0);
  const s = aProb(parlay && parlay.fill_american);
  let pricedN = 0;
  let received = 0;
  let fees = 0;
  for (const f of fills || []) {
    if (!f || !parlay || f.parlay_id !== parlay.id) continue;
    if (f.is_taker === true || f.is_combo === false) continue;
    const c = toNum(f.count);
    let y = toNum(f.yes_price);
    if (y == null && toNum(f.no_price) != null) y = 1 - toNum(f.no_price);
    if (y != null && y > 1) y = y / 100;
    if (!(c > 0) || y == null || !(y > 0 && y < 1)) continue;
    const take = Math.min(c, Math.max(0, n - pricedN));
    if (!(take > 0)) break;
    pricedN += take;
    received += take * y;
    const fee = toNum(f.fee);
    if (fee != null && fee > 0) fees += fee * (take / c);
  }
  const rest = Math.max(0, n - pricedN);
  const estimated = rest > 0 && s != null ? rest * s : 0;
  return {
    contracts: n,
    pricedContracts: r2(pricedN),
    received: received + estimated - fees,
    fees: r2(fees),
    estimatedContracts: s != null ? r2(rest) : 0,
    ok: pricedN > 0 || (rest > 0 && s != null) || n === 0,
  };
}

// Combo YES value per contract after a tie: each tied leg settles at $0.50
// on Kalshi / Polymarket, so a 3-leg parlay with one tie and two wins pays $0.50.
export function pushHedgeValue(pushLegs) {
  const k = Math.max(0, Math.round(toNum(pushLegs) || 0));
  return Math.pow(0.5, k);
}

function legCount(parlay) {
  const legs = (parlay && parlay.legs) || [];
  return Array.isArray(legs) ? legs.length : 0;
}

function pushLegCount(parlay) {
  const rs = (parlay && parlay.leg_results) || [];
  if (!Array.isArray(rs)) return 0;
  return rs.filter((r) => r && /push|tie|void/i.test(String(r.status || r.result || ""))).length;
}

// Sportsbook tie rule: a tied leg is dropped and the parlay pays at the
// reduced-leg price. Per-leg book odds are not stored, so each leg's share of
// the price is split evenly: dropping k of n legs scales decimal odds by
// D^((n-k)/n). All legs tied -> stake back.
export function reducedParlayDecimal(parlay, pushLegs) {
  const D = aDec(parlay && parlay.parlay_american);
  const n = legCount(parlay);
  const k = Math.max(0, Math.round(toNum(pushLegs) || 0));
  if (!D) return null;
  if (!(n > 0) || !(k > 0)) return D;
  if (k >= n) return 1;
  return Math.pow(D, (n - k) / n);
}

// P/L when the parlay pushes (tied leg, the rest won).
export function pushLockPnl(parlay, { filled = 0, fills = [] } = {}) {
  if (!parlay) return null;
  const stake = toNum(parlay.parlay_stake);
  if (!(stake > 0)) return null;
  const k = Math.max(1, pushLegCount(parlay));
  const dRed = reducedParlayDecimal(parlay, k);
  if (!dRed) return null;
  // Free bet keeps profit only; cash gets profit on top of stake back.
  const book = stake * (dRed - 1);
  const rec = lockFillReceipt(parlay, fills, filled);
  if (!rec.ok) return null;
  const hedge = rec.received - rec.contracts * pushHedgeValue(k);
  return r2(book + hedge);
}

// Real-price hedge payoffs: same shape as profile.soFar.
function realPayoffs(parlay, pay, filled, fills) {
  if (!pay || !(filled > 0)) return pay;
  const rec = lockFillReceipt(parlay, fills, filled);
  const s = aProb(parlay.fill_american);
  if (s == null || !rec.ok || !(rec.pricedContracts > 0)) return pay;
  // pay already includes n*s at fill_american; swap that for the real receipt.
  const assumed = filled * s;
  const diff = rec.received - assumed;
  return { ...pay, hit: r2(pay.hit + diff), miss: r2(pay.miss + diff) };
}

function pnlFromPayoffs(pay, side) {
  if (!pay) return null;
  if (side === "hit") return r2(pay.hit);
  if (side === "miss") return r2(pay.miss);
  if (side === "push") return 0;
  return null;
}

// Official combo: we sold NO, so weWon (parlay lost) = miss; parlay won = hit.
function sideFromOfficial(settlement) {
  if (!settlement) return null;
  return settlement.weWon ? "miss" : "hit";
}

function sideFromUnderlying(outcome) {
  if (outcome === "won") return "hit";
  if (outcome === "lost") return "miss";
  if (outcome === "push") return "push";
  return null;
}

export function lockStatementLine({
  parlay,
  filled = 0,
  fills = [],
  outcomes = [],
  matches = [],
  submissions = [],
  liveResult,
} = {}) {
  if (!parlay) return null;
  const filledN = Math.max(0, toNum(filled) || 0);
  const profile = lockProfile(parlay, filledN);
  const outcome = historyOutcome({
    parlay,
    liveResult,
    fills,
    outcomes,
    matches,
    submissions,
    filled: filledN,
  });
  const pay = payoffsForLine(profile, filledN);
  const official = (outcome && outcome.kind === "result" && outcome.settlement)
    || settlementFromStored(parlay)
    || settlementCopy(liveResult);
  let side = null;
  let resultKind = "pending";
  let resultLabel = "pending";
  let source = null;

  if (official) {
    side = sideFromOfficial(official);
    resultKind = "official";
    resultLabel = official.weWon ? "parlay lost (we won)" : "parlay won (we lost)";
    source = "kalshi_combo";
  } else if (outcome && outcome.kind === "underlying") {
    side = sideFromUnderlying(outcome.outcome);
    resultKind = "underlying";
    const copy = underlyingCopy(outcome.outcome, { filled: filledN > 0 });
    resultLabel = copy ? copy.text : outcome.outcome;
    source = outcome.source || null;
  } else if (outcome && outcome.kind === "awaiting") {
    resultKind = "awaiting";
    resultLabel = "awaiting settlement";
  } else if (outcome && outcome.kind === "pending") {
    resultKind = "pending";
    resultLabel = "pending";
  } else {
    resultKind = "open";
    resultLabel = filledN > 0 ? "open lock" : "open";
  }

  const realPay = filledN > 0 ? realPayoffs(parlay, pay, filledN, fills) : pay;
  const pnl = !side ? null
    : side === "push" ? pushLockPnl(parlay, { filled: filledN, fills })
      : pnlFromPayoffs(realPay, side);
  const settled = pnl != null && (resultKind === "official" || resultKind === "underlying");
  const kind = !settled ? "open" : filledN > 0 ? "locked_fill" : "unfilled";
  const bucket = kind === "open" ? "pending" : kind;
  const createdAt = parlay.created_at || null;
  const settledAt = settled
    ? (parlay.settled_at || parlay.archived_at || parlay.underlying_settled_at || null)
    : null;
  const sortAt = (settled && settledAt) ? settledAt : createdAt;
  const sports = sportsFromParlay(parlay);
  const label = parlay.label || "Lock";
  const resultFilter = resultFilterOf({ resultKind, official, side });

  const line = {
    id: parlay.id,
    label,
    filled: filledN,
    kind,
    kindLabel: kindLabel(kind),
    bucket,
    settled,
    pnl,
    // Which way the parlay went: hit | miss | push | null (still open).
    side: settled ? side : null,
    resultKind,
    resultLabel,
    resultFilter,
    source,
    profile,
    createdAt,
    settledAt,
    sortAt,
    sports,
    sportLabels: sports.map(sportLabel),
    searchText: searchHaystack(parlay, label),
    at: sortAt || parlay.archived_at || parlay.settled_at || parlay.underlying_settled_at || parlay.created_at || null,
  };
  line.dateCopy = statementDateCopy(line);
  return line;
}

export function buildComboStatement({
  parlays = [],
  fillsById = {},
  fills = [],
  outcomes = [],
  matchesByParlay = {},
  submissions = [],
  liveSettlement = {},
} = {}) {
  const lines = (parlays || []).filter((parlay) => !isAbsorbedParlay(parlay)).map((parlay) => lockStatementLine({
    parlay,
    filled: filledContracts(parlay, fillsById),
    fills,
    outcomes,
    matches: (matchesByParlay && parlay && matchesByParlay[parlay.id]) || [],
    submissions,
    liveResult: liveSettlement && parlay ? liveSettlement[parlay.id] && liveSettlement[parlay.id].result : undefined,
  })).filter(Boolean);

  const sorted = sortStatementLines(lines);
  return {
    lines: sorted,
    ...summarizeStatementLines(sorted),
  };
}

export function formatStatementPnl(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return (n < 0 ? "-$" : "+$") + abs;
}
