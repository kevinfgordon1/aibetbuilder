'use strict';

// Vercel cron. NFL player props only — anytime TD, first TD, and 2+ TD.
// Kept off /api/fetch-odds so the featured moneyline job stays inside its budget.

const { supabase, applyBookAdjustments } = require('../lib/odds-shared');
const { runPlayerPropsJob } = require('../lib/player-props-job');

module.exports = async (req, res) => {
  try {
    const result = await runPlayerPropsJob({
      apiKey: process.env.ODDS_API_KEY,
      supabaseClient: supabase,
      applyBookAdjustments,
    });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.error || 'player props failed' });
    }
    res.status(200).json({
      success: true,
      sport: result.sport,
      events: result.events,
      upserts: result.upserts,
      errors: result.errors,
      usage: result.usage,
    });
  } catch (error) {
    const message = String(error && error.message || error).replace(/apiKey=[^&\s]+/gi, 'apiKey=redacted');
    res.status(500).json({ error: message });
  }
};

module.exports.config = { maxDuration: 60 };
