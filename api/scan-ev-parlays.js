const { supabase } = require('../lib/odds-shared');
const { SPORT_KEYS, hydrateFeaturedOdds } = require('../lib/promo-ev');
const { scanBooksForEvParlays } = require('../lib/ev-parlay-alert');
const { resolveEvParlaysBotToken } = require('../lib/ev-parlays-bot-token');
const {
  applyAbortSignal,
  alertRowsForUpsert,
  deliverEvParlayAlerts,
} = require('../lib/ev-parlay-scan-flow');

// Dedicated @evparlaysbot token. Do NOT use KayGo TELEGRAM_BOT_TOKEN.
// Env name: EVparlays_alert_telegram_bot_token (case-insensitive fallback).

// GET/POST /api/scan-ev-parlays
// Reads cached odds (no Odds API pull). Scores 3-leg $100 0% boost parlays
// for every Promo Builder book. Alerts @evparlaysbot when EV% > 2.
// Telegram is sent before any ev_parlay_alerts upsert; optional table I/O
// is hard-capped so a missing/slow table cannot starve the DM.
module.exports = async (req, res) => {
  let sentSuccessfully = false;
  let payload = null;
  try {
    const { data: rows, error } = await supabase
      .from('odds_cache')
      .select('*')
      .in('sport', SPORT_KEYS);
    if (error) {
      console.error('scan-ev-parlays odds_cache error:', error);
      return res.status(500).json({ error: error.message });
    }

    const oddsData = hydrateFeaturedOdds(rows);
    const scan = scanBooksForEvParlays(oddsData);
    console.log(
      `scan-ev-parlays combos=${scan.comboCount} elapsedMs=${scan.elapsedMs} timedOut=${scan.timedOut}`,
      scan.stats
    );

    const summary = {
      success: true,
      comboCount: scan.comboCount,
      elapsedMs: scan.elapsedMs,
      timedOut: scan.timedOut,
      candidates: scan.parlays.length,
      booksScanned: scan.stats.filter(s => !s.skipped).length,
    };

    const { token, envName } = resolveEvParlaysBotToken();
    console.log('scan-ev-parlays:', { tokenPresent: Boolean(token), envName });

    const delivered = await deliverEvParlayAlerts({
      parlays: scan.parlays,
      token,
      envChatId: (process.env.EV_ALERT_TELEGRAM_CHAT_ID || '').trim(),
      loadChatRows: (signal) => applyAbortSignal(
        supabase.from('ev_alert_chats').select('telegram_chat_id').eq('is_active', true),
        signal
      ),
      loadExistingRows: (fingerprints, signal) => applyAbortSignal(
        supabase
          .from('ev_parlay_alerts')
          .select('fingerprint, ev_pct, sent_at')
          .in('fingerprint', fingerprints),
        signal
      ),
      recordAlerts: (toAlert, signal) => applyAbortSignal(
        supabase.from('ev_parlay_alerts').upsert(
          alertRowsForUpsert(toAlert, new Date().toISOString()),
          { onConflict: 'fingerprint' }
        ),
        signal
      ),
    });

    sentSuccessfully = Boolean(delivered.sent);
    payload = {
      ...summary,
      toAlert: delivered.toAlert,
      alerted: delivered.alerted,
      recipients: delivered.recipients,
    };
    if (delivered.skippedTelegram) payload.skippedTelegram = delivered.skippedTelegram;
    if (delivered.telegramError) payload.telegramError = delivered.telegramError;

    return res.status(200).json(payload);
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
