// "Active game" gate for the What to root for live needle cron (Kevin, Oct 19 2026):
// a user's needle only updates live (live price pulls + day snapshot writes) while one of their open locks has a
// leg between kickoff and final, or a leg kicking off within the next 20 minutes (so each lock's kickoff baseline
// is still frozen on time). Everyone else only gets the cheap settle pass (finished legs → actual P/L).
// Pure: no network. Kickoffs come from data we already have, never from live boards:
//   leg.starts_at → the lock's starts_at (single-game lock) → a saved kickoff for that game (root_for_pregame_probs)
//   → a clock time in the ticker (e.g. 26OCT181905…) → the ticker's game date (only on that ET date, 9 AM–5 AM ET,
//   once the lock's first game has started).
const H = 3600000;
export const PRE_MS = 20 * 60000; // same window combo-leg-fairs uses for the pregame price
export const LIVE_MS = 5 * H; // a game counts as "in progress" for 5h after kickoff (settle takes over after)
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const etDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const ms = (x) => { const t = Date.parse(x || ""); return Number.isFinite(t) ? t : null; };

/** Game id of a Kalshi ticker ("KXNFLGAME-26OCT18HOUJAC-HOU" → "26OCT18HOUJAC"). */
export function gameId(ticker) { return String(ticker || "").toUpperCase().split("-")[1] || ""; }

/** Ticker game date (ET "YYYY-MM-DD") and, when the ticker carries one, its ET clock time as epoch ms. */
export function tickerWhen(ticker) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})(\d{4})?/.exec(gameId(ticker)); if (!m || !(m[2] in MON)) return null;
  const y = 2000 + Number(m[1]); const mo = MON[m[2]]; const d = Number(m[3]);
  const date = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let at = null;
  if (m[4] && !/FOOTBALL|NFL|NCAAF/.test(String(ticker).toUpperCase())) {
    const hh = Number(m[4].slice(0, 2)), mm = Number(m[4].slice(2));
    if (hh < 24 && mm < 60) { // ET wall clock → UTC: try EDT (-4) then EST (-5), keep the one that reads back right
      for (const off of [4, 5]) { const t = Date.UTC(y, mo, d, hh + off, mm); const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t)); if (p === `${m[4].slice(0, 2)}:${m[4].slice(2)}`) { at = t; break; } }
    }
  }
  return { date, at };
}

/** Kickoff (ms) of one leg, or null if unknown. kickoffs = { gameId: iso } from saved kickoff rows. */
export function legKickoff(leg, lock, kickoffs = {}) {
  const own = ms(leg && leg.starts_at); if (own != null) return own;
  const games = new Set(((lock && lock.legs) || []).map((l) => gameId(l && l.ticker)).filter(Boolean));
  const t0 = ms(lock && lock.starts_at);
  if (games.size === 1 && t0 != null) return t0;
  const saved = ms(kickoffs[gameId(leg && leg.ticker)]); if (saved != null) return saved;
  const w = tickerWhen(leg && leg.ticker); return w && w.at != null ? w.at : null;
}

/** Why a user's needle should update live right now (or null). locks = their open combo_parlays rows. */
export function activeReason(locks = [], kickoffs = {}, now = Date.now()) {
  const today = etDate(now); const lateNight = etDate(now - 5 * H);
  const hourET = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  for (const p of locks || []) {
    const t0 = ms(p && p.starts_at);
    if (t0 != null && t0 > now && t0 - now <= PRE_MS) return "kickoff-soon";
    for (const l of (p && p.legs) || []) {
      if (!l || !l.ticker) continue;
      const k = legKickoff(l, p, kickoffs);
      if (k != null) { if (k > now && k - now <= PRE_MS) return "kickoff-soon"; if (k <= now && now - k < LIVE_MS) return "in-progress"; continue; }
      // unknown kickoff: the leg's game date, once the lock has started (9 AM ET through the 5 AM ET late night)
      const w = tickerWhen(l.ticker);
      if (w && t0 != null && t0 <= now && ((w.date === today && hourET >= 9) || (w.date === lateNight && w.date !== today))) return "game-day";
    }
  }
  return null;
}

/** Group open lock rows by user and split into live (active game) vs settle-only users. */
export function planUsers(rows = [], kickoffs = {}, now = Date.now()) {
  const by = new Map(); for (const r of rows || []) { if (!r || !r.user_id) continue; if (!by.has(r.user_id)) by.set(r.user_id, []); by.get(r.user_id).push(r); }
  const live = []; const idle = [];
  for (const [uid, locks] of by) { const why = activeReason(locks, kickoffs, now); (why ? live : idle).push({ uid, locks, why }); }
  return { live, idle };
}
