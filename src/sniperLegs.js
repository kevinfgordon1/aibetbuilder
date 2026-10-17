// Combo Sniper expanded legs (owner-only). Builds one compact row per leg, Combo Locks style:
// title, matchup, kickoff (ET), fair American + win % and the best opposing price, all from the
// inverse-bet leg detail the noboost logger saved at request time (noboost_paper_rfqs.pm_inverse_legs).
// Never recomputes or changes the fair: each leg's fair is exactly the logged fairAmerican
// (1 − implied chance of the best opposing price, $500 depth, fees included).
// Live relay boards (Polymarket US / Novig / Kalshi) only add the kickoff time and a "now" price + size.
import { parseLeg, parseTdLeg, probFromAmerican, americanFromProb } from "./rawParlayEdges.js";

const NFL = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers",
  CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos",
  DET: "Detroit Lions", GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants", NYJ: "New York Jets",
  PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers", SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
const ALIAS = { JAC: "JAX", WSH: "WAS", LA: "LAR", ARZ: "ARI" };
const canon = (a) => { const u = String(a || "").toUpperCase(); return ALIAS[u] || u; };
const NFL_BY_NAME = Object.fromEntries(Object.entries(NFL).map(([k, v]) => [v.toLowerCase(), k]));
const VENUE_LABEL = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };
export const venueLabel = (v) => VENUE_LABEL[String(v || "").toLowerCase()] || (v ? String(v) : "—");
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** True for Kalshi's date-only placeholder start (03:00 / 04:00 UTC). */
export const isPlaceholderStart = (t) => /T0[34]:00:00(\.000)?Z$/.test(String(t || ""));
export function etDateKey(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** "Oct 18, 1:00 PM ET" */
export function fmtKickoffEt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) + " ET";
}
/** Kalshi ticker date ("26OCT18…") → "2026-10-18". */
function tickerDateKey(raw) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(String(raw || ""));
  if (!m) return null;
  const mon = MON[m[2][0] + m[2].slice(1).toLowerCase()];
  return mon ? `20${m[1]}-${String(mon).padStart(2, "0")}-${m[3]}` : null;
}
/** Split the ticker's team pair ("ARILAR") into [away, home] given one known team. */
function pairTeams(raw, known) {
  const ev = String(raw || "").split(":")[0].split("-")[1] || "";
  const m = /^\d{2}[A-Z]{3}\d{2}([A-Z]+)$/.exec(ev);
  if (!m) return null;
  const pair = m[1], t = String(known || "");
  if (t && pair.startsWith(t)) return [t, pair.slice(t.length)];
  if (t && pair.endsWith(t)) return [pair.slice(0, pair.length - t.length), t];
  return null;
}
const nflName = (abbr) => NFL[canon(abbr)] || null;
const gameKey = (date, a, b) => (date && a && b ? `${date}|${[canon(a), canon(b)].sort().join("+")}` : null);

/** Index live relay boards: game → { start, names }, plus live opp-side quotes from Polymarket / Novig. */
export function indexBoards({ kalshi = [], polymarket = [], novig = [] } = {}) {
  const games = {}; // gameKey → { start } (Polymarket US / Novig only)
  const kalshiEvents = {}; // "KXNFLGAME-26OCT18ARILAR" → { away, home, start, sides: { LAR: "Los Angeles" } }
  const quotes = {}; // `${venue}|${gameKey}|${ABBR}` → { american, size }
  const put = (k, start) => { if (k && start && !games[k]) games[k] = { start }; };
  for (const q of [...polymarket, ...novig]) {
    if (!q || q.bet_type && q.bet_type !== "moneyline") continue;
    const a = NFL_BY_NAME[String(q.away || "").toLowerCase()], h = NFL_BY_NAME[String(q.home || "").toLowerCase()];
    if (!a || !h || !q.start) continue;
    const k = gameKey(etDateKey(q.start), a, h);
    put(k, new Date(Date.parse(q.start)).toISOString());
    const side = NFL_BY_NAME[String(q.side || "").toLowerCase()];
    const p = Number(q.odds);
    if (side && p > 0 && p < 1 && !q.is_live) {
      const key = `${q.book}|${k}|${side}`;
      if (!quotes[key]) quotes[key] = { american: americanFromProb(p), size: Number(q.size) > 0 ? Number(q.size) : null };
    }
  }
  for (const q of kalshi) {
    if (!q || !q.ticker) continue;
    const parts = String(q.ticker).toUpperCase().split("-");
    const ev = parts.slice(0, 2).join("-");
    const e = kalshiEvents[ev] || (kalshiEvents[ev] = { away: q.away || null, home: q.home || null, sides: {} });
    if (parts[2] && q.side) e.sides[parts[2]] = q.side;
    // Kalshi's board start is not a reliable kickoff (date-only placeholders, and e.g. KC @ SEA SNF listed at 03:20Z),
    // so kickoff times come only from Polymarket US / Novig; otherwise the leg shows its date only.
  }
  return { games, kalshiEvents, quotes };
}

const sourcePrices = (leg) => {
  // one price per venue: the best (highest) $500-depth fee-included opposing price that venue showed
  const by = {};
  for (const s of (leg && leg.sources) || []) {
    if (!s || s.used === false || s.reason && s.reason !== "ok") continue;
    const c = Number(s.costAmerican);
    if (!Number.isFinite(c)) continue;
    const v = String(s.venue || "").toLowerCase();
    if (!by[v] || probFromAmerican(c) < probFromAmerican(by[v].cost)) by[v] = { venue: v, cost: c, top: Number.isFinite(Number(s.topAmerican)) ? Number(s.topAmerican) : null };
  }
  return Object.values(by);
};

/**
 * One display row per leg.
 * @param {string[]} legsRaw canonical Kalshi-style legs (Polymarket rows → mapped Kalshi tickers)
 * @param {object[]} pmLegs  noboost_paper_rfqs.pm_inverse_legs (same order as the legs)
 * @param {object}   boards  indexBoards() result (optional)
 */
export function buildLegRows(legsRaw, pmLegs, boards) {
  const B = boards || { games: {}, kalshiEvents: {}, quotes: {} };
  const pm = Array.isArray(pmLegs) ? pmLegs : [];
  return (Array.isArray(legsRaw) ? legsRaw : []).map((raw, i) => {
    const leg = pm[i] || null;
    const date = tickerDateKey(raw);
    const td = parseTdLeg(raw);
    const row = { raw, kind: td ? "td" : "ml", title: null, subtitle: null, when: null, kickoff: null, fairAmerican: null, winPct: null, bestOpp: null, depth: null, others: [], now: null };
    let own = null, opp = null, away = null, home = null;
    if (td) {
      const teams = pairTeams(raw, td.team);
      [away, home] = teams || [null, null];
      row.title = td.side === "no" ? `${td.player} NO anytime TD` : `${td.player} anytime TD`;
      row.oppSide = td.side === "no" ? `${td.player} anytime TD` : `${td.player} NO anytime TD`;
    } else {
      const l = parseLeg(raw);
      const teams = pairTeams(raw, l.team);
      [away, home] = teams || [null, null];
      const ev = String(raw).split(":")[0].split("-").slice(0, 2).join("-");
      const ke = B.kalshiEvents[ev] || null;
      const nm = (a) => nflName(a) || (ke && ke.sides[a]) || a;
      own = l.team; opp = teams ? (teams[0] === l.team ? teams[1] : teams[0]) : null;
      row.title = l.side === "no" ? `${nm(own)} not to win` : `${nm(own)} ML`;
      row.oppSide = l.side === "no" ? `${nm(own)} ML` : opp ? `${nm(opp)} ML` : null;
      if (l.league !== "NFL" && ke && ke.away && ke.home) row.subtitle = `${ke.away} @ ${ke.home}`;
      row.oppAbbr = l.side === "no" ? own : opp;
    }
    if (!row.subtitle && away && home) row.subtitle = `${nflName(away) || away} @ ${nflName(home) || home}`;
    const g = B.games[gameKey(date, away, home)];
    if (g && g.start) row.kickoff = g.start;
    row.when = row.kickoff ? fmtKickoffEt(row.kickoff) : (td ? td.date : parseLeg(raw).date);
    if (leg) {
      const fa = Number(leg.fairAmerican);
      const p = Number.isFinite(Number(leg.p)) ? Number(leg.p) : probFromAmerican(fa);
      row.fairAmerican = Number.isFinite(fa) ? fa : americanFromProb(p);
      row.winPct = p > 0 && p < 1 ? p * 100 : null;
      const prices = sourcePrices(leg);
      const bestVenue = String(leg.best || "").toLowerCase();
      const best = prices.find((x) => x.venue === bestVenue) || prices.sort((a, b) => probFromAmerican(a.cost) - probFromAmerican(b.cost))[0] || null;
      if (best) {
        row.bestOpp = { american: best.cost, venue: best.venue, side: row.oppSide, afterKalshiFee: best.venue === "kalshi" };
        if (best.top != null && best.top !== best.cost) row.depth = { top: best.top, at500: best.cost };
        row.others = prices.filter((x) => x !== best).map((x) => ({ venue: x.venue, american: x.cost }));
        if (row.kind === "ml" && row.oppAbbr) {
          const qk = `${best.venue}|${gameKey(date, away, home)}|${canon(row.oppAbbr)}`;
          const q = B.quotes[qk];
          if (q && q.american != null) row.now = { venue: best.venue, american: q.american, size: q.size };
        }
      }
    }
    delete row.oppAbbr; delete row.oppSide;
    return row;
  });
}

/** Kevin (Oct 17): the detailed leg table (and its price lookups) only for rows at 1% EV or better (EV/$100 risked ≥ $1.00). */
export const DETAIL_MIN_EV_PER_100 = 1;
export const wantsLegDetail = (e) => Number(e && e.evPer100) >= DETAIL_MIN_EV_PER_100;
