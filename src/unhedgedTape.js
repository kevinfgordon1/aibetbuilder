// Unhedged RFQ blotter — read-only mapping over public.unhedged_rfqs.
// Combo-worker writes this table in a parallel PR. Column names may arrive
// incrementally; pick known aliases and never invent a price.
//
// The page is filled-only: someone else matched on Kalshi/Poly. We are paper.
// Default date chip is Today (America/New_York calendar day). Today / 24h / 7d
// stay a single 1000-row page — do not walk Month or All time until that chip
// is selected. Month / All time then paginate that window (1000-row PostgREST
// pages). Tile counts use select(*, { count: "exact", head: true }) with the
// same window / venue / beat-fill filters when PostgREST can express them —
// never download-every-row-then-count. If the status filter fails, client-
// filter filled as fallback. Do not list seen / started / would_quote. Never
// list live / in-game RFQs — not even paper. Hide skip_reason game_started,
// status started, or any leg that already started when that field exists.
// Venue and would-quote-beat-fill chips filter the fetched date window on the
// client; they also re-run head counts. After combo-worker #40, filled_at is
// tape tradeTs (often earlier) or null (never Date.now()). Newest activity is
// the latest of filled_at / updated_at / created_at — a stale fill stamp must
// not bury a later write.
//
// Owner-only tab: do not scope this table by user_id. Combo-worker
// buildUnhedgedRow / fill patches do not write user_id (repo migrations have
// no such column). If production added user_id, worker rows are NULL and
// eq('user_id', owner.id) returns Today=0 / All time=0 on every venue.
// Missing-column retry only helps when the column does not exist. The tab is
// already owner-gated in the UI. Do not invent user_ids client-side.
//
// Today membership is activity (any of filled_at / updated_at / created_at
// in the ET day). If updated_at is missing from the schema, drop it from the
// OR and retry — do not keep OR-ing a nonexistent column. Combo-worker fill
// patches should set updated_at; otherwise a late UPDATE whose filled_at /
// created_at stay on the original RFQ never enters Today's OR.
//
// Worker statuses: seen, started, would_quote, filled. A row with
// our_quote_american is would_quote even if status is still seen (mapping
// only — the tape does not show those). Tape is MLB + NFL moneylines only.
// Legs: spoken name via formatUnhedgedLegName. Per-leg invert fair and
// venue opponent Americans live on a breakdown row — never crammed onto
// the name, never copied from the row parlay our_fair_american.
// Row our_fair_american is the parlay true/fair (invert product).
// Row our_quote_american is the 5% net-cost wrap (what we would have filled).
// Never label fair as the fill.
// Missing table must become an empty state (PGRST205 / 42P01), not a throw.

export const UNHEDGED_TABLE = "unhedged_rfqs";
// PostgREST page size. Light windows (today / 24h / 7d) take one page.
// Month / All time paginate until a short page — only after that chip is on.
export const UNHEDGED_LIMIT = 1000;
export const UNHEDGED_PAGE_SIZE = UNHEDGED_LIMIT;
export const UNHEDGED_MAX_PAGES = 100;
export const UNHEDGED_LIGHT_DATE_KEYS = ["today", "24h", "7d"];
export const UNHEDGED_HEAVY_DATE_KEYS = ["month", "all"];
export const UNHEDGED_COUNT_SELECT_OPTS = { count: "exact", head: true };
export const UNHEDGED_BEAT_FILL_COLS = "our_quote_american,fill_american";
export const UNHEDGED_STATUSES = ["seen", "started", "would_quote", "quoted", "filled"];
export const UNHEDGED_ML_LEAGUES = ["mlb", "nfl"];
export const UNHEDGED_TZ = "America/New_York";
export const UNHEDGED_DEFAULT_DATE_RANGE = "today";
export const UNHEDGED_DATE_FILTERS = [
  { key: "today", label: "Today" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "month", label: "Month" },
  { key: "all", label: "All time" },
];
export const UNHEDGED_DATE_KEYS = ["today", "24h", "7d", "month", "all"];

const TIME_KEYS = [
  "created_at",
  "seen_at",
  "quoted_at",
  "filled_at",
  "updated_at",
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
const CASH_SIZE_KEYS = ["cash_size", "cashSize"];

const THEIR_AMERICAN_KEYS = [
  "taker_american",
  "rfq_american",
  "their_american",
  "rfq_price_american",
  "their_price_american",
];
const THEIR_YES_KEYS = ["taker_yes_price", "rfq_yes", "their_yes", "yes_price", "rfq_price", "target_yes"];
const THEIR_NO_KEYS = ["taker_no_price", "rfq_no", "their_no", "no_price"];

// Would-quote is the 5% wrap only. Do not fall back to fair / true.
const QUOTE_AMERICAN_KEYS = [
  "our_quote_american",
  "would_quote_american",
];

// Row true/fair is the parlay invert product. Never treat this as the fill.
const FAIR_AMERICAN_KEYS = [
  "our_fair_american",
  "true_american",
];

// Per-leg fair only. Row our_fair_american is the parlay fair — never copy it onto a leg.
const LEG_FAIR_AMERICAN_KEYS = ["fair_american", "our_fair_american", "true_american"];
const LEG_KALSHI_AMERICAN_KEYS = ["kalshi_opponent_american", "kalshi_american"];
const LEG_POLY_AMERICAN_KEYS = [
  "poly_opponent_american",
  "polymarket_opponent_american",
  "poly_american",
];
const LEG_BEST_OPP_AMERICAN_KEYS = ["best_opponent_american"];
const NESTED_KALSHI_AMERICAN_KEYS = [
  "kalshi_opponent_american",
  "opponent_american",
  "kalshi_american",
  "american",
];
const NESTED_POLY_AMERICAN_KEYS = [
  "poly_opponent_american",
  "polymarket_opponent_american",
  "opponent_american",
  "poly_american",
  "polymarket_american",
  "american",
];

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

// Spoken Poly slugs (rockies, red-sox, 49ers) plus city/nickname aliases.
// Built onto the same short-name tables as Kalshi 2–4 letter codes.
const MLB_SLUG_EXTRA = {
  arizona: "ARI", diamondbacks: "ARI", dbacks: "ARI",
  atlanta: "ATL",
  baltimore: "BAL", orioles: "BAL",
  boston: "BOS", "red-sox": "BOS", redsox: "BOS",
  "chicago-cubs": "CHC",
  "chicago-white-sox": "CWS", "white-sox": "CWS", whitesox: "CWS",
  cincinnati: "CIN",
  cleveland: "CLE",
  colorado: "COL", rockies: "COL",
  detroit: "DET",
  houston: "HOU",
  "kansas-city": "KC",
  "los-angeles-angels": "LAA", anaheim: "LAA",
  "los-angeles-dodgers": "LAD",
  miami: "MIA",
  milwaukee: "MIL",
  minnesota: "MIN",
  "new-york-mets": "NYM",
  "new-york-yankees": "NYY", yankees: "NYY",
  oakland: "ATH", athletics: "ATH", sacramento: "ATH",
  philadelphia: "PHI",
  pittsburgh: "PIT",
  "san-diego": "SD",
  "san-francisco": "SF",
  seattle: "SEA",
  "st-louis": "STL", "saint-louis": "STL", cardinals: "STL",
  tampa: "TB", "tampa-bay": "TB",
  texas: "TEX",
  toronto: "TOR", "blue-jays": "TOR", bluejays: "TOR",
  washington: "WSH", nationals: "WSH", nats: "WSH",
};

const NFL_SLUG_EXTRA = {
  arizona: "ARI", cardinals: "ARI",
  atlanta: "ATL",
  baltimore: "BAL",
  buffalo: "BUF",
  carolina: "CAR",
  chicago: "CHI",
  cincinnati: "CIN",
  cleveland: "CLE",
  dallas: "DAL",
  denver: "DEN",
  detroit: "DET",
  "green-bay": "GB",
  houston: "HOU",
  indianapolis: "IND",
  jacksonville: "JAC", jaguars: "JAC",
  "kansas-city": "KC", chiefs: "KC",
  "los-angeles-chargers": "LAC", chargers: "LAC",
  "los-angeles-rams": "LAR", rams: "LAR",
  "las-vegas": "LV", oakland: "LV",
  miami: "MIA",
  minnesota: "MIN",
  "new-england": "NE", patriots: "NE",
  "new-orleans": "NO",
  "new-york-giants": "NYG",
  "new-york-jets": "NYJ",
  philadelphia: "PHI", eagles: "PHI",
  pittsburgh: "PIT",
  seattle: "SEA",
  "san-francisco": "SF", "49ers": "SF", "forty-niners": "SF", niners: "SF",
  tampa: "TB", "tampa-bay": "TB", buccaneers: "TB",
  tennessee: "TEN",
  washington: "WAS", commanders: "WAS",
};

function normalizeSlug(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addSlug(map, slug, code) {
  const n = normalizeSlug(slug);
  if (!n || map[n]) return;
  map[n] = code;
  const compact = n.replace(/-/g, "");
  if (compact && !map[compact]) map[compact] = code;
}

function buildSlugMap(names, extras, league) {
  const map = {};
  for (const [code, name] of Object.entries(names)) {
    const canon = league === "nfl"
      ? (NFL_CODE_ALIAS[code] || code)
      : (MLB_CODE_ALIAS[code] || code);
    addSlug(map, code, canon);
    addSlug(map, name, canon);
  }
  for (const [slug, code] of Object.entries(extras)) {
    const canon = league === "nfl"
      ? (NFL_CODE_ALIAS[code] || code)
      : (MLB_CODE_ALIAS[code] || code);
    addSlug(map, slug, canon);
  }
  return map;
}

const MLB_SLUG_TO_CODE = buildSlugMap(MLB_TEAM_NAMES, MLB_SLUG_EXTRA, "mlb");
const NFL_SLUG_TO_CODE = buildSlugMap(NFL_TEAM_NAMES, NFL_SLUG_EXTRA, "nfl");

function slugTables(league) {
  if (league === "nfl") return [NFL_SLUG_TO_CODE];
  if (league === "mlb") return [MLB_SLUG_TO_CODE];
  return [MLB_SLUG_TO_CODE, NFL_SLUG_TO_CODE];
}

function lookupSlug(table, slug) {
  if (!slug || !table) return "";
  if (table[slug]) return table[slug];
  const compact = slug.replace(/-/g, "");
  return table[compact] || "";
}

// Codes (COL, KC) and spoken slugs (rockies, red-sox, 49ers) → canonical team code.
export function resolveTeamToken(raw, league = "") {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return "";
  const slug = normalizeSlug(text);
  if (!slug) return "";
  const tables = slugTables(league);
  for (const table of tables) {
    const hit = lookupSlug(table, slug);
    if (hit) return hit;
  }
  const parts = slug.split("-").filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const two = parts.length >= 2 ? `${parts[parts.length - 2]}-${last}` : "";
    for (const table of tables) {
      if (two) {
        const hitTwo = lookupSlug(table, two);
        if (hitTwo) return hitTwo;
      }
      const hitLast = lookupSlug(table, last);
      if (hitLast) return hitLast;
    }
  }
  if (TEAM_CODE.test(text)) return normalizeTeamCode(text, league);
  return "";
}

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

export function timeMs(ts) {
  if (ts == null || ts === "") return 0;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

// Display / sort / TIME clock: latest of filled_at / updated_at / created_at
// (ms max). Nulls ignored. A stale filled_at (early tape tradeTs / RFQ created)
// must not bury a later updated_at. Do not invent a fill; do not invent Date.now().
// Mapped rows also carry `at` (already this clock) so a later sort still works.
const ACTIVITY_TS_KEYS = [
  "filled_at",
  "filledAt",
  "updated_at",
  "updatedAt",
  "created_at",
  "createdAt",
  "at",
];

export function unhedgedActivityTs(row) {
  if (!row) return null;
  let best = null;
  let bestMs = -1;
  for (const key of ACTIVITY_TS_KEYS) {
    const value = row[key];
    if (value == null || value === "") continue;
    const ms = timeMs(value);
    if (!ms) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

export function rowTime(row) {
  return unhedgedActivityTs(row) || pickFirst(row, TIME_KEYS);
}

export function formatEtTime(ts) {
  const ms = timeMs(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: UNHEDGED_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function etDateParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: UNHEDGED_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
  };
}

export function etYmd(date) {
  const p = etDateParts(date);
  if (!p) return "";
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// Instant whose America/New_York wall clock is ymd + hour:minute.
export function etLocalToUtc(ymd, hour = 0, minute = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const wantHour = Number(hour) || 0;
  const wantMin = Number(minute) || 0;
  for (let utcHour = -12; utcHour <= 36; utcHour++) {
    const ms = Date.UTC(y, m - 1, d, utcHour, wantMin, 0, 0);
    const p = etDateParts(new Date(ms));
    if (!p) continue;
    if (p.year === y && p.month === m && p.day === d && p.hour === wantHour && p.minute === wantMin) {
      return new Date(ms);
    }
  }
  return new Date(`${ymd}T${pad2(wantHour)}:${pad2(wantMin)}:00-04:00`);
}

export function etDayBounds(now = new Date()) {
  const ymd = etYmd(now);
  const start = etLocalToUtc(ymd, 0, 0);
  const nextProbe = new Date((start ? start.getTime() : Date.now()) + 36 * 60 * 60 * 1000);
  const nextYmd = etYmd(nextProbe);
  const end = etLocalToUtc(nextYmd, 0, 0);
  return { start, end, ymd };
}

export function normalizeUnhedgedDateRange(value) {
  const key = String(value == null ? "" : value).trim().toLowerCase();
  if (key === "today" || key === "24h" || key === "7d" || key === "month" || key === "all") return key;
  if (key === "alltime" || key === "all-time" || key === "any") return "all";
  if (key === "30d" || key === "30day" || key === "30days") return "month";
  return UNHEDGED_DEFAULT_DATE_RANGE;
}

// Month / All time are the only windows that walk past the first page.
// Today / 24h / 7d stay a single pull so initial load and Refresh stay light.
export function unhedgedDateRangePages(range) {
  const key = normalizeUnhedgedDateRange(range);
  return key === "month" || key === "all";
}

export function unhedgedDateRangeLabel(value) {
  const key = normalizeUnhedgedDateRange(value);
  const hit = UNHEDGED_DATE_FILTERS.find((f) => f.key === key);
  return hit ? hit.label : "Today";
}

// Date chips are "when the fill landed on our tape": same activity clock as
// TIME ET (latest of filled_at / updated_at / created_at).
// PostgREST cannot max() those columns, so the query ORs them (a row matches
// if any stamp intersects the window) and we then keep rows whose latest
// stamp is actually in range. Preferring filled_at alone would hide late
// writes whose tape tradeTs is an older fill stamp.
// If updated_at is missing from the schema, drop it from the OR — do not keep
// OR-ing a nonexistent column. Combo-worker fill patches should set
// updated_at; a late UPDATE that leaves filled_at / created_at on the original
// RFQ (e.g. Sep 2 11:11pm ET) will not enter Today's window without it.
// today = America/New_York calendar day [start, next midnight).
// 24h / 7d / month = rolling lookback (month = 30d). all = no bound.
export function unhedgedDateWindow(range, now = new Date()) {
  const preset = normalizeUnhedgedDateRange(range);
  const at = now instanceof Date ? now : new Date(now);
  if (preset === "all") return { preset, from: null, to: null };
  if (preset === "today") {
    const { start, end } = etDayBounds(at);
    return {
      preset,
      from: start ? start.toISOString() : null,
      to: end ? end.toISOString() : null,
    };
  }
  const days = preset === "24h" ? 1 : preset === "7d" ? 7 : 30;
  const from = new Date(at.getTime() - days * 24 * 60 * 60 * 1000);
  return { preset, from: from.toISOString(), to: null };
}

export function unhedgedDateOrFilter(window, cols = ["filled_at", "updated_at", "created_at"]) {
  if (!window || window.preset === "all" || (!window.from && !window.to)) return null;
  const use = (cols || []).filter(Boolean);
  if (!use.length) return null;
  if (window.from && window.to) {
    return use.map((c) => `and(${c}.gte.${window.from},${c}.lt.${window.to})`).join(",");
  }
  if (window.from) return use.map((c) => `${c}.gte.${window.from}`).join(",");
  return use.map((c) => `${c}.lt.${window.to}`).join(",");
}

// Server-side venue chip. ilike is case-insensitive; aliases match venueKey().
export function unhedgedVenueOrFilter(venue) {
  const key = normalizeVenueFilter(venue);
  if (key === "kalshi") return "venue.ilike.kalshi*,venue.eq.kxi";
  if (key === "polymarket") return "venue.ilike.polymarket*,venue.eq.poly,venue.eq.pm,venue.ilike.poly*";
  return null;
}

export function rowInUnhedgedDateWindow(row, window) {
  if (!window || window.preset === "all" || (!window.from && !window.to)) return true;
  const ts = unhedgedActivityTs(row);
  if (ts == null || ts === "") return true;
  const ms = timeMs(ts);
  if (!ms) return true;
  if (window.from) {
    const from = Date.parse(window.from);
    if (Number.isFinite(from) && ms < from) return false;
  }
  if (window.to) {
    const to = Date.parse(window.to);
    if (Number.isFinite(to) && ms >= to) return false;
  }
  return true;
}

export function filterUnhedgedRowsByDateWindow(rows, window) {
  return (rows || []).filter((row) => rowInUnhedgedDateWindow(row, window));
}

const KALSHI_MONTH = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const LEG_EVENT_DATE_KEYS = [
  "event_date",
  "eventDate",
  "game_date",
  "gameDate",
  "start_time",
  "startTime",
  "commence_time",
  "commenceTime",
  "game_start",
  "gameStart",
  "event_start",
  "eventStart",
  "starts_at",
  "startsAt",
  "kickoff",
  "scheduled_start",
  "date",
];

export function formatUnhedgedSport(league) {
  const key = String(league == null ? "" : league).trim().toLowerCase();
  if (key === "mlb" || key === "baseball_mlb") return "MLB";
  if (key === "nfl" || key === "americanfootball_nfl") return "NFL";
  if (key === "ncaaf" || key === "americanfootball_ncaaf") return "NCAAF";
  return key ? key.toUpperCase() : "";
}

export function formatEtDateOnly(ymdOrTs) {
  const parsed = parseUnhedgedEventStamp(ymdOrTs);
  if (!parsed || !parsed.ymd) return "—";
  const noon = etLocalToUtc(parsed.ymd, 12, 0);
  if (!noon) return "—";
  return noon.toLocaleString("en-US", {
    timeZone: UNHEDGED_TZ,
    month: "short",
    day: "numeric",
  });
}

export function formatEtEventDate(value) {
  const parsed = parseUnhedgedEventStamp(value);
  if (!parsed) return "—";
  if (parsed.hasTime && parsed.iso) return formatEtTime(parsed.iso);
  return formatEtDateOnly(parsed.ymd || parsed.iso);
}

export function parseTickerEventStamp(raw) {
  const text = String(raw == null ? "" : raw);
  const kalshi = /KX(?:MLB|NFL)GAME-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{4})?/i.exec(text);
  if (kalshi) {
    const year = 2000 + Number(kalshi[1]);
    const month = KALSHI_MONTH[kalshi[2].toUpperCase()];
    const day = Number(kalshi[3]);
    const ymd = `${year}-${pad2(month)}-${pad2(day)}`;
    if (kalshi[4] && kalshi[4].length === 4) {
      const hour = Number(kalshi[4].slice(0, 2));
      const minute = Number(kalshi[4].slice(2, 4));
      const utc = etLocalToUtc(ymd, hour, minute);
      return { ymd, iso: utc ? utc.toISOString() : null, hasTime: true };
    }
    return { ymd, iso: null, hasTime: false };
  }
  const aec = /aec-(?:mlb|nfl)-[a-z0-9]+-[a-z0-9]+-(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (aec) return { ymd: aec[1], iso: null, hasTime: false };
  const isoDay = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (isoDay && /aec-/.test(text)) return { ymd: isoDay[1], iso: null, hasTime: false };
  return null;
}

export function parseUnhedgedEventStamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value.ymd) return value;
  if (typeof value === "number") {
    const ms = timeMs(value);
    if (!ms) return null;
    return { ymd: etYmd(new Date(ms)), iso: new Date(ms).toISOString(), hasTime: true };
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ymd: text, iso: null, hasTime: false };
  const fromTicker = parseTickerEventStamp(text);
  if (fromTicker) return fromTicker;
  const ms = timeMs(text);
  if (!ms) return null;
  return { ymd: etYmd(new Date(ms)), iso: new Date(ms).toISOString(), hasTime: /T|\d:\d/.test(text) };
}

export function legEventStamp(leg) {
  if (leg == null) return parseTickerEventStamp(leg);
  if (typeof leg === "string") return parseTickerEventStamp(leg);
  if (typeof leg !== "object") return null;
  const stated = pickFirst(leg, LEG_EVENT_DATE_KEYS);
  if (stated != null && stated !== "") {
    const parsed = parseUnhedgedEventStamp(stated);
    if (parsed) return parsed;
  }
  const ticker = pickFirst(leg, ["ticker", "market_ticker", "symbol", "slug"]);
  return parseTickerEventStamp(ticker);
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
  const code = resolveTeamToken(raw, league) || normalizeTeamCode(raw, league);
  if (!code) return "";
  const table = league === "nfl" ? NFL_TEAM_NAMES : MLB_TEAM_NAMES;
  if (table[code]) return table[code];
  if (league !== "nfl" && league !== "mlb") {
    return MLB_TEAM_NAMES[code] || NFL_TEAM_NAMES[code] || "";
  }
  return "";
}

function teamEntryToken(t) {
  if (t == null) return "";
  if (typeof t === "string" || typeof t === "number") return String(t);
  if (typeof t === "object") {
    return pickFirst(t, ["code", "selection", "slug", "symbol", "name", "team", "id"]) || "";
  }
  return "";
}

function teamCodesFromList(teams, league) {
  if (!Array.isArray(teams)) return [];
  const out = [];
  for (const t of teams) {
    const code = resolveTeamToken(teamEntryToken(t), league);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

function resolveTeamCode(leg, league) {
  if (!leg || typeof leg !== "object") return "";
  const fromId = resolveTeamToken(
    pickFirst(leg, ["ticker", "market_ticker", "symbol", "slug"]),
    league,
  );
  if (fromId) return fromId;
  const fromSelection = resolveTeamToken(leg.selection, league);
  if (fromSelection) return fromSelection;
  const fromLabel = resolveTeamToken(leg.label, league);
  if (fromLabel) return fromLabel;
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
    const named = teamDisplayName(text, leagueHint);
    if (named) return `${named} ML`;
    if (TEAM_CODE.test(text)) {
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
  const named = teamDisplayName(human, league);
  if (named) return formatNamedSide(named, side);
  if (TEAM_CODE.test(human)) {
    return formatNamedSide(human.toUpperCase(), side);
  }
  if (side === "yes" || side === "no" || ML_TYPE.test(String(leg.type || ""))) {
    return formatNamedSide(human, side);
  }
  return human;
}

export function formatUnhedgedLeg(leg, leagueHint = "") {
  return withLegFair(formatUnhedgedLegName(leg, leagueHint), leg);
}

export function statedAmerican(value) {
  if (value == null || value === "") return null;
  const n = coerceAmerican(value);
  return n == null || n === 0 ? null : n;
}

export function formatBreakdownAmerican(a) {
  return formatScanAmerican(a) || "—";
}

export function legFairAmerican(leg) {
  if (!leg || typeof leg !== "object") return null;
  const stated = pickFirst(leg, LEG_FAIR_AMERICAN_KEYS);
  return stated == null ? null : statedAmerican(stated);
}

function pickStatedAmerican(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  const stated = pickFirst(obj, keys);
  return stated == null ? null : statedAmerican(stated);
}

function quoteBagVenue(obj) {
  if (!obj || typeof obj !== "object") return "";
  return venueKey(obj.venue || obj.exchange || obj.source || obj.book);
}

function collectQuoteBags(leg, venue) {
  const bags = [];
  if (!leg || typeof leg !== "object") return bags;
  const quotes = leg.quotes;
  if (Array.isArray(quotes)) {
    for (const q of quotes) {
      if (!q || typeof q !== "object") continue;
      const key = quoteBagVenue(q);
      if (key === venue) bags.push(q);
    }
  } else if (quotes && typeof quotes === "object") {
    const nested = venue === "kalshi"
      ? (quotes.kalshi || quotes.Kalshi)
      : (quotes.poly || quotes.polymarket || quotes.Polymarket);
    if (nested && typeof nested === "object") bags.push(nested);
  }
  if (venue === "kalshi" && leg.kalshi && typeof leg.kalshi === "object") bags.push(leg.kalshi);
  if (venue === "polymarket") {
    if (leg.poly && typeof leg.poly === "object") bags.push(leg.poly);
    if (leg.polymarket && typeof leg.polymarket === "object") bags.push(leg.polymarket);
  }
  return bags;
}

export function legKalshiAmerican(leg) {
  const flat = pickStatedAmerican(leg, LEG_KALSHI_AMERICAN_KEYS);
  if (flat != null) return flat;
  for (const bag of collectQuoteBags(leg, "kalshi")) {
    const n = pickStatedAmerican(bag, NESTED_KALSHI_AMERICAN_KEYS);
    if (n != null) return n;
  }
  return null;
}

export function legPolyAmerican(leg) {
  const flat = pickStatedAmerican(leg, LEG_POLY_AMERICAN_KEYS);
  if (flat != null) return flat;
  for (const bag of collectQuoteBags(leg, "polymarket")) {
    const n = pickStatedAmerican(bag, NESTED_POLY_AMERICAN_KEYS);
    if (n != null) return n;
  }
  return null;
}

export function legBestOpponentAmerican(leg) {
  return pickStatedAmerican(leg, LEG_BEST_OPP_AMERICAN_KEYS);
}

function withLegFair(name, leg) {
  if (!name) return "";
  const fairText = formatScanAmerican(legFairAmerican(leg));
  return fairText ? `${name} ${fairText}` : name;
}

export function mapUnhedgedLeg(leg, leagueHint = "") {
  if (leg == null) return null;
  const name = formatUnhedgedLegName(leg, leagueHint);
  if (!name || isTickerBlob(name)) return null;
  const obj = typeof leg === "object" ? leg : null;
  const fair = obj ? legFairAmerican(obj) : null;
  const kalshi = obj ? legKalshiAmerican(obj) : null;
  const poly = obj ? legPolyAmerican(obj) : null;
  const best = obj ? legBestOpponentAmerican(obj) : null;
  const league = (obj && (legLeague(obj) || leagueHint)) || leagueHint || (typeof leg === "string" ? legLeague(leg) : "");
  const event = obj ? legEventStamp(obj) : parseTickerEventStamp(leg);
  return {
    type: "",
    name,
    text: name,
    sport: formatUnhedgedSport(league),
    sportKey: league || "",
    eventAt: event && event.iso ? event.iso : (event && event.ymd) || null,
    eventYmd: event && event.ymd ? event.ymd : null,
    eventText: formatEtEventDate(event),
    fairAmerican: fair,
    fairText: formatBreakdownAmerican(fair),
    kalshiAmerican: kalshi,
    kalshiText: formatBreakdownAmerican(kalshi),
    polyAmerican: poly,
    polyText: formatBreakdownAmerican(poly),
    bestOpponentAmerican: best,
    bestText: formatBreakdownAmerican(best),
  };
}

export function formatLegBreakdownLine(leg) {
  const b = leg && Object.prototype.hasOwnProperty.call(leg, "fairText")
    ? leg
    : mapUnhedgedLeg(leg);
  if (!b) return "";
  const parts = [b.name, b.sport || "—", b.eventText || "—", b.fairText, b.kalshiText, b.polyText];
  if (b.bestOpponentAmerican != null) parts.push(b.bestText);
  return parts.join(" | ");
}

export function legBreakdownLines(row) {
  if (!row) return [];
  const mapped = Array.isArray(row.legs)
    && row.legs.some((l) => l && Object.prototype.hasOwnProperty.call(l, "fairText"));
  const legs = mapped ? row.legs : rowLegs(row);
  return (legs || []).map(formatLegBreakdownLine).filter(Boolean);
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

export function isFilledUnhedgedRow(row) {
  return rowStatus(row) === "filled";
}

export function filterFilledUnhedgedRows(rows) {
  return (rows || []).filter(isFilledUnhedgedRow);
}

const SKIP_REASON_KEYS = ["skip_reason", "skipReason"];
const LEG_STARTED_KEYS = [
  "already_started",
  "alreadyStarted",
  "game_started",
  "gameStarted",
  "started",
  "is_started",
  "isStarted",
];

// Worker skip_reason for an in-game RFQ. "started" is the status alias.
export function normalizeSkipReason(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "game_started" || raw === "gamestarted") return "game_started";
  if (raw === "started" || raw === "start" || raw === "in_progress") return "started";
  return raw;
}

export function isLiveSkipReason(value) {
  const n = normalizeSkipReason(value);
  return n === "game_started" || n === "started";
}

function truthyStartedFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === "") return false;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  return isLiveSkipReason(s) || normalizeStatus(s) === "started";
}

// Only when the worker (or a later column) put an explicit started flag on
// the leg. Missing field is not live — do not infer from ticker kickoff.
export function legAlreadyStarted(leg) {
  if (!leg || typeof leg !== "object") return false;
  for (const k of LEG_STARTED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(leg, k)) continue;
    if (truthyStartedFlag(leg[k])) return true;
  }
  return false;
}

export function anyLegAlreadyStarted(row) {
  return rawLegList(row).some(legAlreadyStarted);
}

// Live / in-game: skip_reason game_started, status started, or a leg that
// already started. Filled-after-kickoff rows keep skip_reason=game_started.
export function isLiveUnhedgedRow(row) {
  if (!row) return false;
  if (isLiveSkipReason(pickFirst(row, SKIP_REASON_KEYS))) return true;
  if (rowStatus(row) === "started") return true;
  return anyLegAlreadyStarted(row);
}

export function isPregameUnhedgedRow(row) {
  return !isLiveUnhedgedRow(row);
}

export function filterPregameUnhedgedRows(rows) {
  return (rows || []).filter(isPregameUnhedgedRow);
}

export function rowLegs(row) {
  const raw = pickFirst(row, LEGS_KEYS);
  const league = row ? legLeague(row) : "";
  if (typeof raw === "string") {
    const mapped = mapUnhedgedLeg(raw, league);
    return mapped ? [mapped] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((leg) => mapUnhedgedLeg(leg, league)).filter(Boolean);
}

export function rowLabel(row) {
  const chips = rowLegs(row);
  const texts = chips.map((c) => c.name || c.text).filter((t) => t && !isTickerBlob(t));
  if (texts.length) return texts.join(" · ");
  const label = pickFirst(row, LABEL_KEYS);
  if (label != null && String(label).trim() && !isTickerBlob(label)) {
    return formatUnhedgedLegName(String(label).trim()) || String(label).trim();
  }
  return "—";
}

export function rowContracts(row) {
  return toNum(pickFirst(row, CONTRACT_KEYS));
}

export function rowCashSize(row) {
  return toNum(pickFirst(row, CASH_SIZE_KEYS));
}

export function formatCashSize(n) {
  const v = toNum(n);
  if (v == null) return null;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (Number.isInteger(abs)) return `${sign}$${abs}`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatAmount(contracts, cashSize) {
  const c = formatContracts(contracts);
  const cash = formatCashSize(cashSize);
  if (c === "—" && !cash) return "—";
  if (c === "—") return cash;
  if (!cash) return c;
  return `${c} · ${cash}`;
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
  const stated = pickFirst(row, QUOTE_AMERICAN_KEYS);
  return stated != null ? coerceAmerican(stated) : null;
}

export function fairAmerican(row) {
  const stated = pickFirst(row, FAIR_AMERICAN_KEYS);
  return stated != null ? coerceAmerican(stated) : null;
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
// withQuote = rows that have our_quote_american (filled tape still wants this).
export function summarizeUnhedgedRows(rows, { fetched = null } = {}) {
  const list = rows || [];
  const summary = {
    fetched: fetched == null ? list.length : fetched,
    total: list.length,
    seen: 0,
    started: 0,
    wouldQuote: 0,
    withQuote: 0,
    quoted: 0,
    filled: 0,
    beatFill: 0,
  };
  for (const r of list) {
    const status = r && r.status;
    if (status === "filled") summary.filled += 1;
    else if (status === "quoted") summary.quoted += 1;
    else if (status === "would_quote") summary.wouldQuote += 1;
    else if (status === "started") summary.started += 1;
    else if (status === "seen") summary.seen += 1;
    if (r && r.ourAmerican != null) summary.withQuote += 1;
    if (wouldQuoteBeatsFill(r)) summary.beatFill += 1;
  }
  return summary;
}

export function formatContracts(n) {
  const v = toNum(n);
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(v);
}

export function mapUnhedgedRow(row, index = 0) {
  const at = rowTime(row); // latest of filled/updated/created — TIME ET + sort clock
  const venueRaw = pickFirst(row, VENUE_KEYS);
  const status = rowStatus(row);
  const filledAt = row && (row.filled_at || row.filledAt);
  const updatedAt = row && (row.updated_at || row.updatedAt);
  const contracts = rowContracts(row);
  const cashSize = rowCashSize(row);
  const quote = ourQuoteAmerican(row);
  const fair = fairAmerican(row);
  const fill = fillAmerican(row);
  return {
    id: (row && (row.id || row.rfq_id)) || `row-${index}`,
    at,
    filledAt: filledAt || null,
    updatedAt: updatedAt || null,
    timeEt: formatEtTime(at),
    venue: formatVenue(venueRaw),
    venueKey: venueKey(venueRaw),
    label: rowLabel(row),
    legs: rowLegs(row),
    contracts,
    cashSize,
    contractsText: formatContracts(contracts),
    amountText: formatAmount(contracts, cashSize),
    theirAmerican: theirRfqAmerican(row),
    theirText: formatAmerican(theirRfqAmerican(row)) || "—",
    ourAmerican: quote,
    ourText: formatAmerican(quote) || "—",
    fairAmerican: fair,
    fairText: formatAmerican(fair) || "—",
    status,
    statusTone: statusTone(status),
    fillAmerican: fill,
    fillText: formatAmerican(fill) || "—",
  };
}

// Filled pregame MLB/NFL moneylines only. Seen / started / would_quote /
// NCAAF / in-game (skip_reason game_started or a started leg) stay out.
export function visibleUnhedgedRows(rows) {
  return mapUnhedgedRows(
    filterMlbNflMoneylineRows(filterPregameUnhedgedRows(filterFilledUnhedgedRows(rows))),
  );
}

export const UNHEDGED_VENUE_FILTERS = ["all", "kalshi", "polymarket"];

export function normalizeVenueFilter(value) {
  const key = venueKey(value);
  if (key === "kalshi" || key === "polymarket") return key;
  return "all";
}

export function rowVenueKey(row) {
  if (!row) return "";
  if (row.venueKey) return row.venueKey;
  return venueKey(pickFirst(row, VENUE_KEYS) || row.venue);
}

export function rowMatchesVenueFilter(row, venue) {
  const wanted = normalizeVenueFilter(venue);
  if (wanted === "all") return true;
  return rowVenueKey(row) === wanted;
}

export function filterUnhedgedRowsByVenue(rows, venue) {
  return (rows || []).filter((row) => rowMatchesVenueFilter(row, venue));
}

// Quote and fill must both already exist. Never invent a price; never use fair.
// Mapped rows already resolved these — a null there is a missing price, not a
// hint to go looking for another column.
export function rowQuoteAmerican(row) {
  if (!row) return null;
  if (Object.prototype.hasOwnProperty.call(row, "ourAmerican")) {
    return row.ourAmerican == null ? null : toNum(row.ourAmerican);
  }
  return ourQuoteAmerican(row);
}

export function rowFillAmerican(row) {
  if (!row) return null;
  if (Object.prototype.hasOwnProperty.call(row, "fillAmerican")) {
    return row.fillAmerican == null ? null : toNum(row.fillAmerican);
  }
  return fillAmerican(row);
}

// Better buy-side YES than the print: higher American (our +614 vs fill +452,
// or our −110 vs fill −150). Missing quote or fill never passes.
export function wouldQuoteBeatsFill(row) {
  const quote = rowQuoteAmerican(row);
  const fill = rowFillAmerican(row);
  if (quote == null || fill == null) return false;
  return quote > fill;
}

export function filterUnhedgedRowsByQuoteBeat(rows, beatOnly = false) {
  if (!beatOnly) return rows || [];
  return (rows || []).filter(wouldQuoteBeatsFill);
}

// Client analytics over already-visible (filled MLB/NFL) rows. The row fetch
// stays date-window only. Venue / beat-fill chips re-run head counts.

export function resolveUnhedgedLimit(limit) {
  if (limit == null || limit === "") return UNHEDGED_LIMIT;
  const n = toNum(limit);
  if (n == null || n <= 0) return UNHEDGED_LIMIT;
  return Math.min(Math.floor(n), UNHEDGED_LIMIT);
}

export function unhedgedRefreshLabel(refreshing) {
  return refreshing ? "Refreshing…" : "Refresh";
}

export function filterUnhedgedAnalytics(rows, { venue = "all", quoteBeatFill = false } = {}) {
  return filterUnhedgedRowsByQuoteBeat(filterUnhedgedRowsByVenue(rows, venue), quoteBeatFill);
}

function activityTimeMs(row) {
  return timeMs(unhedgedActivityTs(row));
}

// Filled first, then newest activity (latest of filled/updated/created).
// A stale or null filled_at must not sink a later updated_at/created_at.
// Do not invent a fill.
export function sortUnhedgedRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const aFilled = a && a.status === "filled" ? 1 : 0;
    const bFilled = b && b.status === "filled" ? 1 : 0;
    if (bFilled !== aFilled) return bFilled - aFilled;
    const byActivity = activityTimeMs(b) - activityTimeMs(a);
    if (byActivity) return byActivity;
    return String(b.id).localeCompare(String(a.id));
  });
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

export function isMissingFilledAtColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!msg.includes("filled_at")) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

export function isMissingUpdatedAtColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!msg.includes("updated_at")) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

export function isMissingStatusColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!/\bstatus\b/.test(msg)) return false;
  if (msg.includes("user_id") || msg.includes("filled_at") || msg.includes("updated_at")) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

function isMissingNamedColumn(error, column) {
  if (!error || !column) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!msg.includes(String(column).toLowerCase())) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

export function isMissingVenueColumn(error) {
  return isMissingNamedColumn(error, "venue");
}

export function isMissingQuoteAmericanColumn(error) {
  return isMissingNamedColumn(error, "our_quote_american")
    || isMissingNamedColumn(error, "would_quote_american");
}

export function isMissingFillAmericanColumn(error) {
  return isMissingNamedColumn(error, "fill_american");
}

function applyUnhedgedFilters(q, {
  userId: _userId,
  filterStatus = true,
  dateWindow = null,
  dateCols = ["filled_at", "updated_at", "created_at"],
  venue = "all",
  quoteNotNull = false,
}) {
  // Never eq user_id. Worker rows are unscoped (often NULL if the column
  // exists). Owner gate lives in UnhedgedTape, not this query.
  if (filterStatus) q = q.eq("status", "filled");
  const orFilter = unhedgedDateOrFilter(dateWindow, dateCols);
  if (orFilter && typeof q.or === "function") q = q.or(orFilter);
  const venueFilter = unhedgedVenueOrFilter(venue);
  if (venueFilter && typeof q.or === "function") q = q.or(venueFilter);
  if (quoteNotNull && typeof q.not === "function") q = q.not("our_quote_american", "is", null);
  return q;
}

async function runSelect(client, {
  userId,
  limit,
  offset = 0,
  orderByUpdatedAt = true,
  filterStatus = true,
  dateWindow = null,
  dateCols = ["filled_at", "updated_at", "created_at"],
}) {
  let q = client.from(UNHEDGED_TABLE).select("*");
  q = applyUnhedgedFilters(q, { userId, filterStatus, dateWindow, dateCols });
  if (typeof q.order === "function") {
    // Newest activity first. Prefer updated_at; if that column is missing,
    // created_at only — do not fall back to filled_at desc (nulls last would
    // bury late writes whose tape tradeTs is earlier).
    if (orderByUpdatedAt) q = q.order("updated_at", { ascending: false, nullsFirst: false });
    q = q.order("created_at", { ascending: false });
  }
  if (typeof q.range === "function") q = q.range(offset, offset + limit - 1);
  if (typeof q.limit === "function") q = q.limit(limit);
  return q;
}

async function runCount(client, {
  userId,
  filterStatus = true,
  dateWindow = null,
  dateCols = ["filled_at", "updated_at", "created_at"],
  venue = "all",
  quoteNotNull = false,
}) {
  let q = client.from(UNHEDGED_TABLE).select("*", UNHEDGED_COUNT_SELECT_OPTS);
  return applyUnhedgedFilters(q, {
    userId,
    filterStatus,
    dateWindow,
    dateCols,
    venue,
    quoteNotNull,
  });
}

async function runBeatFillSelect(client, {
  userId,
  filterStatus = true,
  dateWindow = null,
  dateCols = ["filled_at", "updated_at", "created_at"],
  venue = "all",
  limit = UNHEDGED_PAGE_SIZE,
  offset = 0,
}) {
  let q = client.from(UNHEDGED_TABLE).select(UNHEDGED_BEAT_FILL_COLS);
  q = applyUnhedgedFilters(q, {
    userId,
    filterStatus,
    dateWindow,
    dateCols,
    venue,
    quoteNotNull: true,
  });
  if (typeof q.not === "function") q = q.not("fill_american", "is", null);
  if (typeof q.range === "function") q = q.range(offset, offset + limit - 1);
  if (typeof q.limit === "function") q = q.limit(limit);
  return q;
}

function readHeadCount(result) {
  const n = result && result.count;
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : parseInt(n, 10);
  return Number.isFinite(v) ? v : null;
}

function emptyUnhedgedCountResult(extra = {}) {
  return {
    filled: null,
    withQuote: null,
    beatFill: null,
    missingTable: false,
    error: null,
    source: "head",
    ...extra,
  };
}

export function mergeUnhedgedSummary(summary, counts) {
  const s = summary || summarizeUnhedgedRows([]);
  if (!counts) return s;
  return {
    ...s,
    filled: counts.filled != null ? counts.filled : s.filled,
    withQuote: counts.withQuote != null ? counts.withQuote : s.withQuote,
    beatFill: counts.beatFill != null ? counts.beatFill : s.beatFill,
  };
}

function classifySelectError(error, {
  userId: _userId,
  orderByUpdatedAt,
  filterStatus,
  dateCols,
  venue = "all",
  quoteNotNull = false,
  beatFillCols = false,
}) {
  if (!error) return null;
  // Column-missing first: "column unhedged_rfqs.user_id does not exist" also
  // matches the table-missing message fallback. We do not filter by user_id,
  // but still classify this so a leftover schema error retries unscoped
  // instead of looking like a missing table.
  if (isMissingUserIdColumn(error)) return "missing_user_id";
  if (filterStatus && isMissingStatusColumn(error)) return "missing_status";
  const cols = dateCols || [];
  if (cols.includes("filled_at") && isMissingFilledAtColumn(error)) return "missing_filled_at";
  if ((orderByUpdatedAt || cols.includes("updated_at")) && isMissingUpdatedAtColumn(error)) {
    return "missing_updated_at";
  }
  if (venue && venue !== "all" && isMissingVenueColumn(error)) return "missing_venue";
  if ((quoteNotNull || beatFillCols) && isMissingQuoteAmericanColumn(error)) return "missing_quote";
  if (beatFillCols && isMissingFillAmericanColumn(error)) return "missing_fill";
  if (isMissingTableError(error)) return "missing_table";
  return "other";
}

function finalizeFetchedRows(data, dateWindow = null) {
  // Query filter is a superset (OR of stamps); client filter is the rule.
  // Drop live / in-game even when status=filled (skip_reason game_started).
  return filterUnhedgedRowsByDateWindow(
    filterPregameUnhedgedRows(filterFilledUnhedgedRows(Array.isArray(data) ? data : [])),
    dateWindow,
  );
}

function applySelectKind(kind, flags) {
  if (kind === "missing_user_id") flags.scopedUserId = null;
  else if (kind === "missing_status") flags.filterStatus = false;
  else if (kind === "missing_updated_at") {
    flags.orderByUpdatedAt = false;
    flags.dateCols = (flags.dateCols || []).filter((c) => c !== "updated_at");
  } else if (kind === "missing_filled_at") {
    flags.dateCols = (flags.dateCols || []).filter((c) => c !== "filled_at");
  } else if (kind === "missing_venue") {
    flags.venue = "all";
    flags.venueDropped = true;
  } else if (kind === "missing_quote") {
    flags.quoteNotNull = false;
    flags.quoteDropped = true;
  } else if (kind === "missing_fill") {
    flags.beatFillCols = false;
    flags.fillDropped = true;
  }
  return flags;
}

const RETRYABLE_SELECT_KINDS = [
  "missing_user_id",
  "missing_status",
  "missing_updated_at",
  "missing_filled_at",
  "missing_venue",
  "missing_quote",
  "missing_fill",
];

async function resolveSelectAttempt(runFn, selectArgs, flags) {
  let result;
  try {
    result = await runFn(selectArgs);
  } catch (err) {
    const kind = classifySelectError(err, selectArgs);
    if (kind === "missing_table") return { missingTable: true, error: err };
    if (RETRYABLE_SELECT_KINDS.includes(kind)) {
      applySelectKind(kind, flags);
      return { retry: true };
    }
    return { error: err };
  }
  const error = result && result.error;
  const kind = classifySelectError(error, selectArgs);
  if (kind === "missing_table") return { missingTable: true, error };
  if (RETRYABLE_SELECT_KINDS.includes(kind)) {
    applySelectKind(kind, flags);
    return { retry: true };
  }
  if (error) return { error };
  return { result };
}

function newUnhedgedFlags(_userId) {
  return {
    // userId is accepted on fetch/count for call-site compat and ignored.
    // Combo-worker does not write Kevin's id onto unhedged_rfqs.
    scopedUserId: null,
    orderByUpdatedAt: true,
    filterStatus: true,
    dateCols: ["filled_at", "updated_at", "created_at"],
    venue: "all",
    venueDropped: false,
    quoteNotNull: true,
    quoteDropped: false,
    beatFillCols: true,
    fillDropped: false,
  };
}

function selectArgsFromFlags(flags, extra = {}) {
  return {
    userId: flags.scopedUserId,
    orderByUpdatedAt: flags.orderByUpdatedAt,
    filterStatus: flags.filterStatus,
    dateCols: flags.dateCols,
    venue: flags.venue,
    quoteNotNull: flags.quoteNotNull,
    beatFillCols: flags.beatFillCols,
    ...extra,
  };
}

async function resolveOnce(runFn, flags, extra = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const selectArgs = selectArgsFromFlags(flags, extra);
    const step = await resolveSelectAttempt(runFn, selectArgs, flags);
    if (step.retry) continue;
    return step;
  }
  return { error: { message: "retries exhausted" } };
}

// Select * of filled rows RLS already allows. Do not scope by user_id — the
// Unhedged tab is owner-gated and combo-worker does not write user_id.
// A missing table is an empty blotter, not a crash. status=eq.filled.
// Date chips add an OR of filled_at / updated_at / created_at intersecting
// the window (see unhedgedDateWindow). If updated_at is missing, drop it
// from the OR (and from order) and retry. Today / 24h / 7d take one page.
// Month / All time page until a short page — only after that chip is on.
// Prefer updated_at desc. userId on the options object is ignored.
export async function fetchUnhedgedRfqs(client, {
  userId = null,
  limit = UNHEDGED_PAGE_SIZE,
  dateRange = UNHEDGED_DEFAULT_DATE_RANGE,
  now,
  paginate,
} = {}) {
  if (!client || typeof client.from !== "function") {
    return { rows: [], missingTable: false, error: { message: "no client" }, truncated: false, paged: false };
  }
  const pageSize = resolveUnhedgedLimit(limit);
  const dateWindow = unhedgedDateWindow(dateRange, now || new Date());
  const pageAll = paginate != null ? !!paginate : unhedgedDateRangePages(dateRange);
  const maxPages = pageAll ? UNHEDGED_MAX_PAGES : 1;
  const flags = newUnhedgedFlags(userId);
  const all = [];
  let offset = 0;
  let lastPageLen = 0;
  for (let page = 0; page < maxPages; page++) {
    const step = await resolveOnce(
      (args) => runSelect(client, args),
      flags,
      { limit: pageSize, offset, dateWindow },
    );
    if (step.missingTable) return { rows: [], missingTable: true, error: step.error, truncated: false, paged: pageAll };
    if (step.error) {
      return { rows: finalizeFetchedRows(all, dateWindow), missingTable: false, error: step.error, truncated: false, paged: pageAll };
    }
    const pageRows = Array.isArray(step.result && step.result.data) ? step.result.data : [];
    lastPageLen = pageRows.length;
    all.push(...pageRows);
    if (pageRows.length < pageSize) {
      return {
        rows: finalizeFetchedRows(all, dateWindow),
        missingTable: false,
        error: null,
        truncated: false,
        paged: pageAll,
      };
    }
    offset += pageSize;
  }
  return {
    rows: finalizeFetchedRows(all, dateWindow),
    missingTable: false,
    error: null,
    truncated: !pageAll && lastPageLen >= pageSize,
    paged: pageAll,
  };
}

async function countHeadOnce(client, flags, { dateWindow, quoteNotNull = false, venue = "all" }) {
  flags.quoteNotNull = quoteNotNull;
  flags.venue = flags.venueDropped ? "all" : venue;
  return resolveOnce(
    (args) => runCount(client, args),
    flags,
    { dateWindow, quoteNotNull: flags.quoteNotNull, venue: flags.venue },
  );
}

async function countBeatFillSlim(client, flags, { dateWindow, venue = "all", paginate = false }) {
  if (flags.quoteDropped || flags.fillDropped) return { count: null };
  flags.venue = flags.venueDropped ? "all" : venue;
  flags.quoteNotNull = true;
  flags.beatFillCols = true;
  const pageSize = UNHEDGED_PAGE_SIZE;
  const maxPages = paginate ? UNHEDGED_MAX_PAGES : 1;
  let offset = 0;
  let beat = 0;
  for (let page = 0; page < maxPages; page++) {
    const step = await resolveOnce(
      (args) => runBeatFillSelect(client, args),
      flags,
      {
        dateWindow,
        venue: flags.venue,
        quoteNotNull: true,
        beatFillCols: true,
        limit: pageSize,
        offset,
      },
    );
    if (step.missingTable) return step;
    if (step.error) return step;
    if (flags.quoteDropped || flags.fillDropped) return { count: null };
    const rows = Array.isArray(step.result && step.result.data) ? step.result.data : [];
    for (const row of rows) {
      if (wouldQuoteBeatsFill(row)) beat += 1;
    }
    if (rows.length < pageSize) return { count: beat };
    offset += pageSize;
  }
  return { count: beat };
}

// Head counts for the tiles. Same date / status / venue filters as the
// row pull (no user_id). FILLED and Would-quote are exact head counts. Beat-fill compares
// two columns so PostgREST cannot head it — we select only those two numbers
// (not *) and count locally. When the beat-fill chip is on, FILLED and
// Would-quote reuse that beat-fill count (the subset).
export async function countUnhedgedRfqs(client, {
  userId = null,
  dateRange = UNHEDGED_DEFAULT_DATE_RANGE,
  now,
  venue = "all",
  quoteBeatFill = false,
} = {}) {
  if (!client || typeof client.from !== "function") {
    return emptyUnhedgedCountResult({ error: { message: "no client" } });
  }
  const dateWindow = unhedgedDateWindow(dateRange, now || new Date());
  const venueKeyNorm = normalizeVenueFilter(venue);
  const flags = newUnhedgedFlags(userId);
  flags.venue = venueKeyNorm;
  const pageBeat = unhedgedDateRangePages(dateRange);

  if (quoteBeatFill) {
    const beat = await countBeatFillSlim(client, flags, {
      dateWindow,
      venue: flags.venueDropped ? "all" : venueKeyNorm,
      paginate: pageBeat,
    });
    if (beat.missingTable) return emptyUnhedgedCountResult({ missingTable: true, error: beat.error });
    if (beat.error && beat.count == null) {
      return emptyUnhedgedCountResult({ error: beat.error });
    }
    return {
      filled: beat.count,
      withQuote: beat.count,
      beatFill: beat.count,
      missingTable: false,
      error: beat.error || null,
      source: "head",
      venueDropped: flags.venueDropped,
    };
  }

  const filledStep = await countHeadOnce(client, flags, {
    dateWindow,
    quoteNotNull: false,
    venue: flags.venueDropped ? "all" : venueKeyNorm,
  });
  if (filledStep.missingTable) return emptyUnhedgedCountResult({ missingTable: true, error: filledStep.error });
  if (filledStep.error) return emptyUnhedgedCountResult({ error: filledStep.error });
  const filled = readHeadCount(filledStep.result);

  const quoteVenue = flags.venueDropped ? "all" : venueKeyNorm;
  const quoteStep = flags.quoteDropped
    ? { result: { count: null } }
    : await countHeadOnce(client, flags, {
      dateWindow,
      quoteNotNull: true,
      venue: quoteVenue,
    });
  if (quoteStep.missingTable) return emptyUnhedgedCountResult({ missingTable: true, error: quoteStep.error, filled });
  const withQuote = flags.quoteDropped || quoteStep.error ? null : readHeadCount(quoteStep.result);

  const beat = await countBeatFillSlim(client, flags, {
    dateWindow,
    venue: quoteVenue,
    paginate: pageBeat,
  });
  if (beat.missingTable) {
    return {
      filled,
      withQuote,
      beatFill: null,
      missingTable: true,
      error: beat.error,
      source: "head",
      venueDropped: flags.venueDropped,
    };
  }
  return {
    filled,
    withQuote,
    beatFill: beat.count,
    missingTable: false,
    error: beat.error || quoteStep.error || null,
    source: "head",
    venueDropped: flags.venueDropped,
  };
}
