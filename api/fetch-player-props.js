'use strict';

// Vercel cron, every 5 minutes. Three jobs in one invocation:
//   NFL anytime touchdown (1+), games kicking off within 72 hours.
//   MLB batter home runs (1+ HR), games starting later today (ET).
//   NHL anytime goal scorer (1+ goal), games starting later today (ET).
// Kept off /api/fetch-odds so the featured moneyline job stays inside its budget.
// The jobs run in parallel and share one Polymarket US /book limiter (same IP).
// An MLB or NHL failure never fails the NFL response; they are reported
// under `mlb` / `nhl`.

const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const { runPlayerPropsJob } = require('../lib/player-props-job');
const { runPlayerHrJob } = require('../lib/player-hr-job');
const { runPlayerGoalJob } = require('../lib/player-goal-job');
const { createPolyBookLimiter } = require('../lib/player-td-feeds');

function redact(value) {
  return String(value || '').replace(/apiKey=[^&\s]+/gi, 'apiKey=redacted');
}

function sideJobSummary(job, fallbackError) {
  if (!job || !job.ok) return { ok: false, error: (job && job.error) || fallbackError };
  return {
    ok: true,
    sport: job.sport,
    gamesToday: job.gamesToday,
    events: job.events,
    upserts: job.upserts,
    players: job.players,
    venues: job.venues,
    creditsUsed: job.creditsUsed,
    oddsApiCalls: job.oddsApiCalls,
    oddsCallsBilled: job.oddsCallsBilled,
    usage: job.usage,
    ladders: job.ladders,
    errors: job.errors,
  };
}

async function handler(req, res, deps) {
  const d = deps || {};
  const runNfl = d.runNfl || runPlayerPropsJob;
  const runMlb = d.runMlb || runPlayerHrJob;
  const runNhl = d.runNhl || runPlayerGoalJob;
  try {
    const apiKey = d.apiKey !== undefined ? d.apiKey : process.env.ODDS_API_KEY;
    const supabaseClient = d.supabaseClient !== undefined ? d.supabaseClient : supabase;
    // Shared Polymarket /book pacing. A little over the single-job cap
    // because three jobs draw from it; still stops at the first 429.
    const polyLimiter = createPolyBookLimiter({ maxBooks: 20 });
    const ladderDeps = { polyLimiter };
    const [nfl, mlb, nhl] = await Promise.all([
      runNfl({ apiKey, supabaseClient, applyBookAdjustments, ladderDeps }),
      Promise.resolve()
        .then(() => runMlb({ apiKey, supabaseClient, applyBookAdjustments, ladderDeps }))
        .catch((err) => ({ ok: false, error: redact(err && err.message) })),
      Promise.resolve()
        .then(() => runNhl({ apiKey, supabaseClient, applyBookAdjustments, ladderDeps }))
        .catch((err) => ({ ok: false, error: redact(err && err.message) })),
    ]);
    if (!nfl.ok) {
      return res.status(500).json({ success: false, error: nfl.error || 'player props failed' });
    }
    res.status(200).json({
      success: true,
      sport: nfl.sport,
      events: nfl.events,
      upserts: nfl.upserts,
      errors: nfl.errors,
      usage: nfl.usage,
      mlb: sideJobSummary(mlb, 'mlb hr failed'),
      nhl: sideJobSummary(nhl, 'nhl goals failed'),
    });
  } catch (error) {
    res.status(500).json({ error: redact(error && error.message || error) });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
