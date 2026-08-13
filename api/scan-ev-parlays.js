const { runEvParlayScan } = require('../lib/ev-parlay-scan-job');
const { skipTelegramRequested } = require('../lib/ev-parlay-scan-flow');

// Optional manual HTTP test. NOT on a Vercel cron — production scans run on
// the Railway worker (npm run ev-alerts). This handler keeps the short Vercel
// timeouts (25s odds_cache) so a hung PostgREST read cannot hold a serverless
// invocation for minutes.
//
// Dedicated @evparlaysbot token. Do NOT use KayGo TELEGRAM_BOT_TOKEN.
// Env name: EVparlays_alert_telegram_bot_token (case-insensitive fallback).
//
// GET/POST /api/scan-ev-parlays
// MLB only (baseball_mlb), Promo Builder "Next 24h" window. Reads cached odds
// (no Odds API pull). Scores 3-leg $100 0% boost parlays for every Promo
// Builder book. Alerts @evparlaysbot when EV% > 2.
// Telegram is sent before any ev_parlay_alerts upsert.
module.exports = async (req, res) => {
  let sentSuccessfully = false;
  let payload = null;
  try {
    const result = await runEvParlayScan({
      skipTelegram: skipTelegramRequested(req),
    });
    sentSuccessfully = Boolean(result.sentSuccessfully);
    payload = result.payload;
    return res.status(result.status).json(payload);
  } catch (err) {
    console.error('scan-ev-parlays error:', err);
    if (sentSuccessfully) {
      return res.status(200).json({
        ...(payload || { success: true }),
        alerted: (payload && payload.alerted) || 0,
        errorAfterSend: err.message,
      });
    }
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
