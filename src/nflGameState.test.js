import assert from "node:assert/strict";
import { ODDS_FRESHNESS, maskStaleOdds, resetConsensusTape } from "./oddsFreshness.js";
import {
  findGameState,
  freshnessMode,
  gameStateLine,
  phaseFromPlay,
  resetGameStateTrack,
  stateFromEspnEvent,
  stateFromPmUsEvent,
  statesFromEspnScoreboard,
  trackGameState,
} from "./nflGameState.js";

// ESPN scoreboard event for PHI @ CHI, captured at halftime 2026-09-28 ~9:45 PM ET.
const HALFTIME = {"id": "401872963", "status": {"clock": 0.0, "displayClock": "0:00", "period": 2, "type": {"id": "23", "name": "STATUS_HALFTIME", "state": "in", "completed": false, "description": "Halftime", "detail": "Halftime", "shortDetail": "Halftime"}}, "competitions": [{"competitors": [{"homeAway": "home", "score": "10", "team": {"id": "3", "abbreviation": "CHI", "displayName": "Chicago Bears"}}, {"homeAway": "away", "score": "7", "team": {"id": "21", "abbreviation": "PHI", "displayName": "Philadelphia Eagles"}}], "situation": {"lastPlay": {"id": "4018729632126", "type": {"id": "65", "text": "End of Half", "abbreviation": "EH"}, "text": "END QUARTER 2", "scoreValue": 0, "team": {"id": "21"}, "probability": {"tiePercentage": 0.0, "homeWinPercentage": 0.4936, "awayWinPercentage": 0.5064, "secondsLeft": 0}, "statYardage": 0, "drive": {"description": "8 plays, 67 yards, 1:52", "start": {"yardLine": 67, "text": "PHI 33"}, "end": {"yardLine": 0, "text": "CHI 0"}, "timeElapsed": {"displayValue": "1:52"}, "result": "TD"}, "start": {"yardLine": 15, "team": {"id": "21"}}, "end": {"yardLine": 15, "team": {"id": "21"}}}, "down": 1, "yardLine": 15, "distance": 10, "isRedZone": false, "homeTimeouts": 3, "awayTimeouts": 3}}]};

function live({ clock = "8:30", clockSec = 510, period = 2, lastPlay = { type: { text: "Pass Reception" }, text: "J.Hurts pass short right to A.Brown for 6 yards" }, home = "10", away = "7", possession = "21" } = {}) {
  const ev = structuredClone(HALFTIME);
  ev.status = { clock: clockSec, displayClock: clock, period, type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false } };
  ev.competitions[0].competitors.find((c) => c.homeAway === "home").score = home;
  ev.competitions[0].competitors.find((c) => c.homeAway === "away").score = away;
  ev.competitions[0].situation = {
    lastPlay,
    down: 3,
    distance: 4,
    yardLine: 35,
    isRedZone: false,
    possession,
    shortDownDistanceText: "3rd & 4",
    possessionText: "CHI 35",
    downDistanceText: "3rd & 4 at CHI 35",
  };
  return ev;
}

const NOW = Date.parse("2026-09-29T01:45:00Z");

// Halftime payload → halftime phase, no possession / down line.
{
  const st = stateFromEspnEvent(HALFTIME);
  assert.equal(st.phase, "halftime");
  assert.equal(st.homeAbbr, "CHI");
  assert.equal(st.awayAbbr, "PHI");
  assert.equal(st.homeScore, 10);
  assert.equal(st.awayScore, 7);
  assert.equal(st.downDistance, null);
  assert.equal(gameStateLine(st), "Halftime");
  assert.equal(statesFromEspnScoreboard({ events: [HALFTIME] }).length, 1);
}

// Status still HALFTIME but the 2H kickoff is the last play → live Q3 (ESPN lag seen tonight).
{
  const ko = structuredClone(HALFTIME);
  ko.competitions[0].situation.lastPlay = { type: { text: "Kickoff" }, text: "C.Santos kicks 65 yards from CHI 35 to landing zone to end zone, Touchback." };
  const st = stateFromEspnEvent(ko);
  assert.equal(st.phase, "live");
  assert.equal(st.period, 3);
  assert.equal(gameStateLine(st).startsWith("Q3 15:00"), true);
}

// Live payload → "Q2 8:30 · PHI ball · 3rd & 4 at CHI 35".
{
  const st = stateFromEspnEvent(live());
  assert.equal(st.phase, "live");
  assert.equal(st.possession, "PHI");
  assert.equal(gameStateLine(st), "Q2 8:30 · PHI ball · 3rd & 4 at CHI 35");
  const rz = live();
  rz.competitions[0].situation.isRedZone = true;
  assert.match(gameStateLine(stateFromEspnEvent(rz)), /\(RZ\)$/);
}

// Stoppages from the last play.
{
  assert.equal(phaseFromPlay("Timeout", "Timeout #1 by CHI at 08:30."), "timeout");
  assert.equal(phaseFromPlay("Two-minute warning", "Two-Minute Warning"), "two_minute");
  assert.equal(phaseFromPlay("Official Timeout", "(Replay Official reviewed the pass completion)"), "review");
  assert.equal(phaseFromPlay("End Period", "END QUARTER 1"), "end_period");
  assert.equal(phaseFromPlay("Pass Reception", "J.Hurts pass to A.Brown"), null);
  const to = stateFromEspnEvent(live({ lastPlay: { type: { text: "Timeout" }, text: "Timeout #2 by PHI at 08:30." } }));
  assert.equal(to.phase, "timeout");
  assert.equal(gameStateLine(to), "Q2 8:30 · PHI ball · 3rd & 4 at CHI 35 · Timeout");
  const endQ = structuredClone(HALFTIME);
  endQ.status = { clock: 0, displayClock: "0:00", period: 1, type: { name: "STATUS_END_PERIOD", state: "in" } };
  assert.equal(stateFromEspnEvent(endQ).phase, "end_period");
  assert.equal(gameStateLine(stateFromEspnEvent(endQ)), "End Q1");
}

// Modes: halftime / timeout → stopped; running clock → running; stale feed → running.
{
  resetGameStateTrack();
  const ht = trackGameState(stateFromEspnEvent(HALFTIME), NOW);
  assert.deepEqual(freshnessMode(ht, NOW), { mode: "stopped", reason: "Halftime" });
  assert.equal(freshnessMode(ht, NOW + ODDS_FRESHNESS.GAME_STATE_MAX_AGE_MS + 1).mode, "running");
  const run = trackGameState(stateFromEspnEvent(live()), NOW + 5_000);
  assert.equal(freshnessMode(run, NOW + 5_000).mode, "running");
  assert.equal(freshnessMode(null, NOW).mode, "running");
}

// Score → pulled for GAME_STATE_PULL_GRACE_MS, then until the clock moves, capped at PULL_MAX.
{
  resetGameStateTrack();
  const t0 = NOW;
  trackGameState(stateFromEspnEvent(live({ clock: "3:10", clockSec: 190 })), t0);
  const td = trackGameState(stateFromEspnEvent(live({ clock: "3:02", clockSec: 182, away: "14", lastPlay: { type: { text: "Passing Touchdown" }, text: "J.Hurts pass to D.Smith for 12 yds, TOUCHDOWN" } })), t0 + 5_000);
  assert.equal(td.lastScoreMs, t0 + 5_000);
  assert.deepEqual(freshnessMode(td, t0 + 30_000), { mode: "pulled", reason: "after score" });
  // Past the grace, clock still stopped at 3:02 (PAT, kickoff pending) → still pulled.
  const still = trackGameState(stateFromEspnEvent(live({ clock: "3:02", clockSec: 182, away: "14" })), t0 + 100_000);
  assert.equal(freshnessMode(still, t0 + 100_000).mode, "pulled");
  // Clock moves → play resumed → running (tight) again.
  const resumed = trackGameState(stateFromEspnEvent(live({ clock: "2:55", clockSec: 175, away: "14" })), t0 + 110_000);
  assert.equal(freshnessMode(resumed, t0 + 110_000).mode, "running");
  // Clock never moves → capped.
  resetGameStateTrack();
  trackGameState(stateFromEspnEvent(live({ clock: "3:10", clockSec: 190 })), t0);
  const stuck = trackGameState(stateFromEspnEvent(live({ clock: "3:10", clockSec: 190, home: "13" })), t0 + 1_000);
  assert.equal(freshnessMode(stuck, t0 + ODDS_FRESHNESS.GAME_STATE_PULL_MAX_MS + 2_000).mode, "running");
}

// Turnover (interception) → pulled "after turnover".
{
  resetGameStateTrack();
  trackGameState(stateFromEspnEvent(live()), NOW);
  const pick = trackGameState(stateFromEspnEvent(live({ possession: "3", lastPlay: { type: { text: "Pass Interception Return" }, text: "J.Hurts pass INTERCEPTED by K.Byard" } })), NOW + 5_000);
  assert.deepEqual(freshnessMode(pick, NOW + 10_000), { mode: "pulled", reason: "after turnover" });
}

// Board game ↔ feed state by team names.
{
  const st = stateFromEspnEvent(HALFTIME);
  assert.equal(findGameState([st], { home: "Chicago Bears", away: "Philadelphia Eagles" }), st);
  assert.equal(findGameState([st], { home: "Bears", away: "Eagles" }), st);
  assert.equal(findGameState([st], { home: "Philadelphia Eagles", away: "Chicago Bears" }), null);
}

// Polymarket US fallback payload (halftime, captured tonight).
{
  const pm = stateFromPmUsEvent({ id: "112325", eventState: { score: "7-10", elapsed: "", period: "HT", live: true, ended: false } }, { home: "Chicago Bears", away: "Philadelphia Eagles", homeAbbr: "CHI", awayAbbr: "PHI" });
  assert.equal(pm.phase, "halftime");
  assert.equal(pm.homeScore, 10);
  assert.equal(pm.awayScore, 7);
  const q3 = stateFromPmUsEvent({ id: "1", eventState: { score: "7-10", elapsed: "12:41", period: "Q3", live: true } });
  assert.equal(gameStateLine(q3), "Q3 12:41");
}

// Masking with game modes.
{
  const KICK = "2026-09-29T00:15:00Z";
  const g = (odds, stamps, flags) => ({ id: "gm", away: "Philadelphia Eagles", home: "Chicago Bears", commence_time: KICK, is_live: true, bookOdds: odds, bookLineUpdatedAt: stamps, ...(flags ? { bookLineFlags: flags } : {}) });
  const at = (ago) => ({ ml_away: NOW - ago, ml_home: NOW - ago });
  const odds = { draftkings: { ml_away: -120, ml_home: 100 }, pinnacle: { ml_away: -160, ml_home: 140 }, kalshi: { ml_away: -162, ml_home: 142 } };
  const stamps = { draftkings: at(3 * 60_000), pinnacle: at(5_000), kalshi: at(5_000) };
  const opts = (gameMode) => ({ nowMs: NOW, tape: new Map(), gameMode });
  // Running: DK 3m old and 40 cents off the market → frozen.
  assert.match(maskStaleOdds(g(odds, stamps), opts(null)).bookLineMasked.draftkings.ml_away, /^frozen 3m/);
  // Halftime: same price is fine (stopped gate 5m).
  assert.equal(maskStaleOdds(g(odds, stamps), opts({ mode: "stopped", reason: "Halftime" })).bookLineMasked, undefined);
  // Halftime, 6 min old and off-market → frozen again.
  const old = { ...stamps, draftkings: at(6 * 60_000) };
  assert.match(maskStaleOdds(g(odds, old), opts({ mode: "stopped", reason: "Halftime" })).bookLineMasked.draftkings.ml_away, /^frozen 6m/);
  // Stopped absolute cap is 20m (running cap is 5m).
  const nine = { draftkings: at(9 * 60_000), pinnacle: at(9 * 60_000), kalshi: at(9 * 60_000) };
  const same = { draftkings: { ml_away: -160, ml_home: 140 }, pinnacle: { ml_away: -160, ml_home: 140 }, kalshi: { ml_away: -160, ml_home: 140 } };
  assert.ok(maskStaleOdds(g(same, nine), opts(null)).bookLineMasked.draftkings);
  assert.equal(maskStaleOdds(g(same, nine), opts({ mode: "stopped", reason: "Halftime" })).bookLineMasked, undefined);
  // Pulled after score: nothing called frozen; OTB still hidden but labelled as the pull.
  const flags = { fanduel: { ml_away: "off the board", ml_home: "off the board" } };
  const pulledOdds = { ...odds, fanduel: { ml_away: -150, ml_home: 130 } };
  const pulledStamps = { ...stamps, fanduel: at(60_000) };
  const pulled = maskStaleOdds(g(pulledOdds, pulledStamps, flags), opts({ mode: "pulled", reason: "after score" }));
  assert.equal(pulled.bookLineMasked.draftkings, undefined);
  assert.equal(pulled.bookLineMasked.fanduel.ml_away, "pulled after score");
  assert.equal(pulled.bookOdds.fanduel.ml_away, null);
  // Pregame (not live): game mode ignored.
  const pre = { ...g(odds, stamps), is_live: false };
  assert.equal(maskStaleOdds(pre, opts({ mode: "pulled", reason: "after score" })).bookLineMasked, undefined);
  resetConsensusTape();
}

console.log("nflGameState tests passed");
