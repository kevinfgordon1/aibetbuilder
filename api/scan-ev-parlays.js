const { supabase } = require('../lib/odds-shared');
const { SPORT_KEYS, hydrateFeaturedOdds } = require('../lib/promo-ev');
const { scanBooksForEvParlays } = require('../lib/ev-parlay-alert');
const { resolveEvParlaysBotToken } = require('../lib/ev-parlays-bot-token');
const {
  applyAbortSignal,
  alertRowsForUpsert,
  deliverEvParlayAlerts,
  runRequired,
  skipTelegramRequested,
  ODDS_CACHE_TIMEOUT_MS,
  ODDS_CACHE_COLUMNS,
} = require('../lib/ev-parlay-scan-flow');

// Dedicated @evparlaysbot token. Do NOT use KayGo TELEGRAM_BOT_TOKEN.
// Env name: EVparlays_alert_telegram_bot_token (case-insensitive fallback).

// GET/POST /api/scan-ev-parlays
// Reads cached odds (no Odds API pull). Scores 3-leg $100 0% boost parlays
// for every Promo Builder book. Alerts @evparlaysbot when EV% > 2.
// Telegram is sent before any ev_parlay_alerts upsert; optional table I/O
// is hard-capped so a missing/slow table cannot starve the DM.
// odds_cache is required and hard-capped (~8s + abortSignal). Timeout/error
// returns 504/500 immediately — do not wait out maxDuration: 60.
module.exports = async (req, res) => {
  let sentSuccessfully = false;
  let payload = null;
  try {
    const oddsLoad = await runRequired(
      (signal) => applyAbortSignal(
        supabase
          .from('odds_cache')
          .select(ODDS_CACHE_COLUMNS)
          .in('sport', SPORT_KEYS),
        signal
      ),
      { timeoutMs: ODDS_CACHE_TIMEOUT_MS, label: 'odds_cache' }
    );
    if (!oddsLoad.ok) {
      console.error('scan-ev-parlays odds_cache:', oddsLoad.message);
      return res.status(oddsLoad.status).json({
        error: oddsLoad.message,
        timedOut: oddsLoad.timedOut,
      });
    }

    const oddsData = hydrateFeaturedOdds(oddsLoad.data);
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

    if (skipTelegramRequested(req)) {
      return res.status(200).json({
        ...summary,
        skippedTelegram: 'debug',
      });
    }

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
