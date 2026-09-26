'use strict';

// Vercel cron, every 5 minutes. Two jobs in one invocation:
//   NFL anytime touchdown (1+), games kicking off within 72 hours.
//   MLB batter home runs (1+ HR), games starting later today (ET).
// Kept off /api/fetch-odds so the featured moneyline job stays inside its budget.
// The jobs run in parallel and share one Polymarket US /book limiter (same IP).
// An MLB failure never fails the NFL response; it is reported under `mlb`.

const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const { runPlayerPropsJob } = require('../lib/player-props-job');
const { runPlayerHrJob } = require('../lib/player-hr-job');
const { createPolyBookLimiter } = require('../lib/player-td-feeds');

function redact(value) {
  return String(value || '').replace(/apiKey=[^&\s]+/gi, 'apiKey=redacted');
}

async function handler(req, res, deps) {
  const d = deps || {};
  const runNfl = d.runNfl || runPlayerPropsJob;
  const runMlb = d.runMlb || runPlayerHrJob;
  try {
    const apiKey = d.apiKey !== undefined ? d.apiKey : process.env.ODDS_API_KEY;
    const supabaseClient = d.supabaseClient !== undefined ? d.supabaseClient : supabase;
    // Shared Polymarket /book pacing. A little over the single-job cap
    // because two jobs draw from it; still stops at the first 429.
    const polyLimiter = createPolyBookLimiter({ maxBooks: 16 });
    const ladderDeps = { polyLimiter };
    const [nfl, mlb] = await Promise.all([
      runNfl({ apiKey, supabaseClient, applyBookAdjustments, ladderDeps }),
      Promise.resolve()
        .then(() => runMlb({ apiKey, supabaseClient, applyBookAdjustments, ladderDeps }))
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
      mlb: mlb && mlb.ok
        ? {
          ok: true,
          sport: mlb.sport,
          gamesToday: mlb.gamesToday,
          events: mlb.events,
          upserts: mlb.upserts,
          players: mlb.players,
          venues: mlb.venues,
          creditsUsed: mlb.creditsUsed,
          oddsApiCalls: mlb.oddsApiCalls,
          oddsCallsBilled: mlb.oddsCallsBilled,
          usage: mlb.usage,
          ladders: mlb.ladders,
          errors: mlb.errors,
        }
        : { ok: false, error: (mlb && mlb.error) || 'mlb hr failed' },
    });
  } catch (error) {
    res.status(500).json({ error: redact(error && error.message || error) });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 60 };
