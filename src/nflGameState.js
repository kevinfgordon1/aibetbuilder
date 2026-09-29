// Live NFL game state for the odds boards (clock, period, score, possession,
// down & distance, red zone, stoppages). Feeds the frozen / suspended rule in
// oddsFreshness.js and the small state line on LIVE rows.
//
// Primary: ESPN site scoreboard (public, no key, one call covers every NFL
// game; CDN max-age 6-8s), via our /api/espn-scores?live=nfl proxy. Fallback: Polymarket US gateway event state
// (public, CORS *, per-game slug, max-age 30s) when ESPN fails. Kalshi
// live_data (Stats Perform) is as fast but blocks browser origins, and
// Betstamp fixtures carry clock / score only; see PR #250 for the comparison.
//
// Everything below the fetchers is pure so it can be tested without network.

import { ODDS_FRESHNESS } from "./oddsFreshness.js";

// Same-origin proxy of the ESPN NFL scoreboard (api/espn-scores.js ?live=nfl):
// ESPN's CDN 403s browser user agents from some networks.
export const ESPN_NFL_LIVE_URL = "/api/espn-scores?live=nfl";
export const PM_US_EVENT_URL = "https://gateway.polymarket.us/v1/events/slug/";

// Clock stopped but the game is not over: books legitimately sit still.
export const STOPPED_PHASES = Object.freeze(["halftime", "end_period", "timeout", "review", "two_minute", "injury", "delayed"]);

const PHASE_LABEL = {
  halftime: "Halftime",
  end_period: "End of quarter",
  timeout: "Timeout",
  review: "Review",
  two_minute: "Two-minute warning",
  injury: "Injury stoppage",
  delayed: "Delayed",
  final: "Final",
};

function num(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
}

function clockSeconds(display) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(display || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Stoppage from the last play when the scoreboard status is plain "in progress".
export function phaseFromPlay(typeText, text) {
  const s = `${typeText || ""} ${text || ""}`.toLowerCase();
  if (!s.trim()) return null;
  if (/two[- ]minute warning/.test(s)) return "two_minute";
  if (/end of half|end quarter 2\b|halftime/.test(s)) return "halftime";
  if (/end (of )?(period|quarter)|end quarter/.test(s)) return "end_period";
  if (/review|challenge|replay/.test(s)) return "review";
  if (/injur/.test(s)) return "injury";
  if (/timeout/.test(s)) return "timeout";
  return null;
}

function isTurnoverText(s) {
  return /intercept|fumble.*(recovered by|recovers)|turnover on downs|muffed/i.test(String(s || ""));
}

function normTeam(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// One ESPN event → normalized state (null when not NFL-shaped).
export function stateFromEspnEvent(ev) {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const list = comp.competitors || [];
  const home = list.find((c) => c.homeAway === "home");
  const away = list.find((c) => c.homeAway === "away");
  if (!home?.team || !away?.team) return null;
  const st = ev.status || comp.status || {};
  const type = st.type || {};
  const name = String(type.name || "");
  const sit = comp.situation || {};
  const lp = sit.lastPlay || {};
  let phase = "live";
  if (type.state === "pre" || name === "STATUS_SCHEDULED") phase = "pre";
  else if (type.completed || type.state === "post") phase = "final";
  else if (name === "STATUS_HALFTIME") phase = "halftime";
  else if (name === "STATUS_END_PERIOD") phase = "end_period";
  else if (/DELAY|SUSPEND|RAIN/.test(name)) phase = "delayed";
  else phase = phaseFromPlay(lp.type?.text, lp.text) || "live";
  const teamAbbr = { [String(home.team.id)]: home.team.abbreviation, [String(away.team.id)]: away.team.abbreviation };
  const possession = sit.possession != null ? teamAbbr[String(sit.possession)] || null : null;
  return {
    source: "espn",
    id: String(ev.id),
    home: home.team.displayName || "",
    away: away.team.displayName || "",
    homeAbbr: home.team.abbreviation || "",
    awayAbbr: away.team.abbreviation || "",
    homeScore: num(home.score),
    awayScore: num(away.score),
    period: num(st.period),
    clock: st.displayClock || null,
    clockSec: num(st.clock) ?? clockSeconds(st.displayClock),
    phase,
    possession,
    downDistance: phase === "live" || phase === "timeout" || phase === "review" || phase === "two_minute" || phase === "injury"
      ? (sit.shortDownDistanceText && sit.possessionText ? `${sit.shortDownDistanceText} at ${sit.possessionText}` : sit.downDistanceText || null)
      : null,
    redZone: sit.isRedZone === true,
    lastPlay: lp.text || null,
    lastPlayTurnover: isTurnoverText(lp.text) || /intercept|fumble/i.test(lp.type?.text || ""),
  };
}

export function statesFromEspnScoreboard(body) {
  return (body?.events || []).map(stateFromEspnEvent).filter(Boolean);
}

// Polymarket US gateway event → normalized state (fallback feed).
export function stateFromPmUsEvent(event, { home, away, homeAbbr, awayAbbr } = {}) {
  const es = event?.eventState;
  if (!es) return null;
  const [a, h] = String(es.score || "").split("-").map(num);
  const p = String(es.period || "").toUpperCase();
  let phase = "live";
  let period = null;
  if (es.ended) phase = "final";
  else if (!es.live) phase = "pre";
  else if (p === "HT") { phase = "halftime"; period = 2; }
  else if (/^Q(\d)$/.test(p)) period = Number(p.slice(1));
  else if (p === "OT") period = 5;
  else if (/^E/.test(p)) phase = "end_period";
  return {
    source: "polymarket_us",
    id: String(event.id),
    home: home || "",
    away: away || "",
    homeAbbr: homeAbbr || "",
    awayAbbr: awayAbbr || "",
    homeScore: h ?? null,
    awayScore: a ?? null,
    period,
    clock: es.elapsed || null,
    clockSec: clockSeconds(es.elapsed),
    phase,
    possession: null,
    downDistance: null,
    redZone: false,
    lastPlay: null,
    lastPlayTurnover: false,
  };
}

// ── Change tracking (score / turnover / clock running) ─────────────────────
const defaultTrack = new Map();

/**
 * Fold a fresh poll into the tracker. Returns the state with derived fields:
 *   lastScoreMs / lastTurnoverMs: when a score or turnover was first seen
 *   clockMovedMs: when the game clock was last seen moving
 */
export function trackGameState(state, nowMs, track = defaultTrack) {
  if (!state) return state;
  const prev = track.get(state.id);
  const next = { ...state, lastScoreMs: prev?.lastScoreMs ?? null, lastTurnoverMs: prev?.lastTurnoverMs ?? null, clockMovedMs: prev?.clockMovedMs ?? null, seenMs: nowMs };
  if (prev) {
    const scored = (state.homeScore ?? 0) + (state.awayScore ?? 0) > (prev.homeScore ?? 0) + (prev.awayScore ?? 0);
    if (scored) next.lastScoreMs = nowMs;
    const turnover = (state.lastPlayTurnover && state.lastPlay !== prev.lastPlay)
      || (prev.possession && state.possession && prev.possession !== state.possession && !scored && !/punt|kick/i.test(state.lastPlay || ""));
    if (turnover) next.lastTurnoverMs = nowMs;
    if (state.clockSec != null && prev.clockSec != null && (state.clockSec !== prev.clockSec || state.period !== prev.period)) next.clockMovedMs = nowMs;
  }
  track.set(state.id, next);
  return next;
}

export function resetGameStateTrack(track = defaultTrack) {
  track.clear();
}

/**
 * How strict the frozen rule should be for this game right now.
 *   "running": clock running, normal live gates.
 *   "stopped": halftime / quarter break / timeout / review / two-minute
 *              warning / injury: lines legitimately sit still.
 *   "pulled":  just after a score or turnover; books pull, off-the-board or
 *              missing lines are expected until play resumes.
 */
export function freshnessMode(state, nowMs, c = ODDS_FRESHNESS) {
  if (!state || state.phase === "pre" || state.phase === "final") return { mode: "running", reason: null };
  // A stale feed must not keep the gates loose.
  if (state.seenMs != null && nowMs - state.seenMs > c.GAME_STATE_MAX_AGE_MS) return { mode: "running", reason: null };
  const ev = Math.max(state.lastScoreMs ?? -Infinity, state.lastTurnoverMs ?? -Infinity);
  if (Number.isFinite(ev)) {
    const since = nowMs - ev;
    const resumed = state.clockMovedMs != null && state.clockMovedMs > ev;
    if (since < c.GAME_STATE_PULL_GRACE_MS || (!resumed && since < c.GAME_STATE_PULL_MAX_MS)) {
      return { mode: "pulled", reason: state.lastScoreMs === ev ? "after score" : "after turnover" };
    }
  }
  if (STOPPED_PHASES.includes(state.phase)) return { mode: "stopped", reason: PHASE_LABEL[state.phase] };
  return { mode: "running", reason: null };
}

function ordinalQ(period) {
  if (period == null) return "";
  return period >= 5 ? (period === 5 ? "OT" : `${period - 4}OT`) : `Q${period}`;
}

// "Q2 8:30 · PHI ball · 3rd & 4 at CHI 35", "Halftime", "Q4 2:00 · Two-minute warning".
export function gameStateLine(state) {
  if (!state || state.phase === "pre") return "";
  if (state.phase === "final") return "Final";
  if (state.phase === "halftime") return "Halftime";
  const parts = [];
  const q = ordinalQ(state.period);
  if (state.phase === "end_period") parts.push(`End ${q}`.trim());
  else parts.push([q, state.clock].filter(Boolean).join(" "));
  if (state.possession) parts.push(`${state.possession} ball`);
  if (state.downDistance) parts.push(state.downDistance + (state.redZone ? " (RZ)" : ""));
  if (state.phase !== "live" && state.phase !== "end_period" && PHASE_LABEL[state.phase]) parts.push(PHASE_LABEL[state.phase]);
  return parts.filter(Boolean).join(" · ");
}

// Board game ↔ feed state by team names (full name, or nickname / abbr fallbacks).
export function findGameState(states, game) {
  if (!states?.length || !game) return null;
  const h = normTeam(game.home || game.home_team);
  const a = normTeam(game.away || game.away_team);
  if (!h || !a) return null;
  const hit = (s, name, abbr) => {
    const full = normTeam(name);
    return full === s || (full && (full.endsWith(s) || s.endsWith(full))) || normTeam(abbr) === s;
  };
  return states.find((s) => hit(h, s.home, s.homeAbbr) && hit(a, s.away, s.awayAbbr)) || null;
}

// ── Browser poller (shared by both boards) ─────────────────────────────────
const store = { states: [], updatedAt: 0, source: null, listeners: new Set(), timer: null, users: 0, espnFails: 0, pmSlugs: new Map() };

export function nflGameStates() {
  return store.states;
}

export function nflGameStateFor(game) {
  return findGameState(store.states, game);
}

/** freshnessMode() for a board game (only for live rows; null otherwise). */
export function nflGameModeFor(game, nowMs = Date.now()) {
  if (!game?.is_live) return null;
  const st = nflGameStateFor(game);
  return st ? freshnessMode(st, nowMs) : null;
}

export function subscribeNflGameState(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

function emit() {
  for (const fn of store.listeners) {
    try { fn(); } catch (_) {}
  }
}

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function etDate(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function pollOnce() {
  const now = Date.now();
  const body = await getJson(ESPN_NFL_LIVE_URL);
  let states = body ? statesFromEspnScoreboard(body) : null;
  if (states && states.length) {
    store.espnFails = 0;
    store.source = "espn";
  } else {
    store.espnFails += 1;
    // Fallback: Polymarket US per live game we already know from ESPN.
    if (store.espnFails >= ODDS_FRESHNESS.GAME_STATE_FALLBACK_AFTER_FAILS && store.states.length) {
      const live = store.states.filter((s) => s.phase !== "pre" && s.phase !== "final");
      const got = await Promise.all(live.map(async (s) => {
        const slug = `nfl-${s.awayAbbr}-${s.homeAbbr}-${etDate(now)}`.toLowerCase();
        const j = await getJson(PM_US_EVENT_URL + slug);
        const st = stateFromPmUsEvent(j?.event, s);
        return st ? { ...st, id: s.id } : null;
      }));
      states = got.filter(Boolean);
      if (states.length) store.source = "polymarket_us";
    }
  }
  if (states && states.length) {
    store.states = states.map((s) => trackGameState(s, now));
    store.updatedAt = now;
    emit();
  }
}

/** Start polling (ref-counted). Returns a stop function. */
export function startNflGameStatePoll() {
  store.users += 1;
  if (!store.timer && typeof window !== "undefined") {
    const tick = async () => {
      await pollOnce();
      if (store.users > 0) store.timer = setTimeout(tick, ODDS_FRESHNESS.GAME_STATE_POLL_MS);
    };
    store.timer = setTimeout(tick, 0);
  }
  return () => {
    store.users = Math.max(0, store.users - 1);
    if (!store.users && store.timer) {
      clearTimeout(store.timer);
      store.timer = null;
    }
  };
}

export const _internals = { store, pollOnce, clockSeconds, normTeam };
