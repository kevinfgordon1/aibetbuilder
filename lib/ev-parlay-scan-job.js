// Shared scan+send for EV parlay Telegram alerts.
// Used by the Railway worker (production) and leftover Vercel HTTP handler
// (optional manual tests). Timeouts are injected so Vercel stays short and
// Railway can wait ~120s for MLB odds_cache.
// Dedicated token: EVparlays_alert_telegram_bot_token (never TELEGRAM_BOT_TOKEN).
const { hydrateFeaturedOdds } = require('./promo-ev');
const { scanBooksForEvParlays, SCAN_SPORT_KEYS, TIME_BUDGET_MS } = require('./ev-parlay-alert');
const { resolveEvParlaysBotToken } = require('./ev-parlays-bot-token');
const {
  applyAbortSignal,
  alertRowsForUpsert,
  deliverEvParlayAlerts,
  loadOddsCacheBySport,
  ODDS_CACHE_TIMEOUT_MS,
  OPTIONAL_TABLE_TIMEOUT_MS,
  ODDS_CACHE_COLUMNS,
} = require('./ev-parlay-scan-flow');

function resolveSupabase(supabaseClient) {
  return supabaseClient || require('./odds-shared').supabase;
}

function defaultOddsCacheQuery(supabaseClient) {
  return (sport, signal) => applyAbortSignal(
    supabaseClient
      .from('odds_cache')
      .select(ODDS_CACHE_COLUMNS)
      .eq('sport', sport)
      .maybeSingle(),
    signal
  );
}

function defaultLoadChatRows(supabaseClient) {
  return (signal) => applyAbortSignal(
    supabaseClient.from('ev_alert_chats').select('telegram_chat_id').eq('is_active', true),
    signal
  );
}

function defaultLoadExistingRows(supabaseClient) {
  return (fingerprints, signal) => applyAbortSignal(
    supabaseClient
      .from('ev_parlay_alerts')
      .select('fingerprint, ev_pct, sent_at')
      .in('fingerprint', fingerprints),
    signal
  );
}

function defaultRecordAlerts(supabaseClient) {
  return (toAlert, signal) => applyAbortSignal(
    supabaseClient.from('ev_parlay_alerts').upsert(
      alertRowsForUpsert(toAlert, new Date().toISOString()),
      { onConflict: 'fingerprint' }
    ),
    signal
  );
}

/**
 * Load MLB odds_cache, score 3-leg +EV parlays, send @evparlaysbot, then
 * best-effort dedup write. Caller supplies timeouts (Vercel vs Railway).
 *
 * Returns { ok, status, payload, sentSuccessfully, elapsedMs }.
 */
async function runEvParlayScan({
  skipTelegram = false,
  oddsCacheTimeoutMs = ODDS_CACHE_TIMEOUT_MS,
  optionalTableTimeoutMs = OPTIONAL_TABLE_TIMEOUT_MS,
  timeBudgetMs = TIME_BUDGET_MS,
  supabaseClient,
  queryOddsCache,
  loadChatRows,
  loadExistingRows,
  recordAlerts,
  sendTelegramFn,
  token,
  envChatId = (process.env.EV_ALERT_TELEGRAM_CHAT_ID || '').trim(),
  nowMs,
  log = console.log,
  logError = console.error,
} = {}) {
  const t0 = Date.now();
  const querySport = queryOddsCache || defaultOddsCacheQuery(resolveSupabase(supabaseClient));

  const oddsLoad = await loadOddsCacheBySport(
    SCAN_SPORT_KEYS,
    querySport,
    { timeoutMs: oddsCacheTimeoutMs }
  );

  if (!oddsLoad.ok) {
    logError('ev-parlay-scan odds_cache:', oddsLoad.message, {
      loaded: oddsLoad.loadedSports,
      timedOut: oddsLoad.timedOutSports,
      errors: oddsLoad.errorSports,
      elapsedMs: Date.now() - t0,
    });
    return {
      ok: false,
      status: oddsLoad.status,
      sentSuccessfully: false,
      elapsedMs: Date.now() - t0,
      payload: {
        error: oddsLoad.message,
        timedOut: oddsLoad.timedOut,
        loadedSports: oddsLoad.loadedSports,
        timedOutSports: oddsLoad.timedOutSports,
        errorSports: oddsLoad.errorSports,
        elapsedMs: Date.now() - t0,
      },
    };
  }

  const oddsData = hydrateFeaturedOdds(oddsLoad.data);
  const scan = scanBooksForEvParlays(oddsData, { timeBudgetMs });
  log(
    `ev-parlay-scan combos=${scan.comboCount} scanMs=${scan.elapsedMs} timedOut=${scan.timedOut}`,
    { loaded: oddsLoad.loadedSports, timedOut: oddsLoad.timedOutSports, errors: oddsLoad.errorSports },
    scan.stats
  );

  const summary = {
    success: true,
    comboCount: scan.comboCount,
    scanElapsedMs: scan.elapsedMs,
    timedOut: scan.timedOut,
    candidates: scan.parlays.length,
    booksScanned: scan.stats.filter(s => !s.skipped).length,
    loadedSports: oddsLoad.loadedSports,
    timedOutSports: oddsLoad.timedOutSports,
    errorSports: oddsLoad.errorSports,
  };

  if (skipTelegram) {
    const elapsedMs = Date.now() - t0;
    return {
      ok: true,
      status: 200,
      sentSuccessfully: false,
      elapsedMs,
      payload: { ...summary, skippedTelegram: 'debug', elapsedMs },
    };
  }

  const resolved = token != null
    ? { token, envName: 'injected' }
    : resolveEvParlaysBotToken();
  log('ev-parlay-scan token:', { tokenPresent: Boolean(resolved.token), envName: resolved.envName });

  const delivered = await deliverEvParlayAlerts({
    parlays: scan.parlays,
    token: resolved.token,
    envChatId,
    nowMs,
    timeoutMs: optionalTableTimeoutMs,
    sendTelegramFn,
    loadChatRows: loadChatRows || defaultLoadChatRows(resolveSupabase(supabaseClient)),
    loadExistingRows: loadExistingRows || defaultLoadExistingRows(resolveSupabase(supabaseClient)),
    recordAlerts: recordAlerts || defaultRecordAlerts(resolveSupabase(supabaseClient)),
  });

  const elapsedMs = Date.now() - t0;
  const payload = {
    ...summary,
    toAlert: delivered.toAlert,
    alerted: delivered.alerted,
    recipients: delivered.recipients,
    elapsedMs,
  };
  if (delivered.skippedTelegram) payload.skippedTelegram = delivered.skippedTelegram;
  if (delivered.telegramError) payload.telegramError = delivered.telegramError;

  return {
    ok: true,
    status: 200,
    sentSuccessfully: Boolean(delivered.sent),
    elapsedMs,
    payload,
  };
}

module.exports = {
  runEvParlayScan,
  defaultOddsCacheQuery,
  ODDS_CACHE_COLUMNS,
};
