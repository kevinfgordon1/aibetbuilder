// Orchestration for /api/scan-ev-parlays: send @evparlaysbot as soon as
// we have toAlert + token + chat ids. Optional Supabase tables (ev_alert_chats,
// ev_parlay_alerts) are best-effort and cannot starve Telegram.
// odds_cache is required and hard-capped (~8s); timeout/error fail the request.
const {
  STAKE,
  selectNewAlerts,
  formatAlertMessage,
  mergeEvAlertChatIds,
} = require('./ev-parlay-alert');

const OPTIONAL_TABLE_TIMEOUT_MS = 2000;
// odds_cache is required for the scan. Cap well under maxDuration: 60 so a
// stuck PostgREST/statement cannot hold the invocation open with zero bytes.
const ODDS_CACHE_TIMEOUT_MS = 8000;
const ODDS_CACHE_COLUMNS = 'sport,data,fetched_at';

function timeoutError(label, ms) {
  const err = new Error(`${label} timed out after ${ms}ms`);
  err.name = 'TimeoutError';
  return err;
}

function applyAbortSignal(builder, signal) {
  if (builder && typeof builder.abortSignal === 'function' && signal) {
    return builder.abortSignal(signal);
  }
  return builder;
}

function alertRowsForUpsert(toAlert, sentAt) {
  return (toAlert || []).map(p => ({
    fingerprint: p.fingerprint,
    book_key: p.bookKey,
    ev_pct: p.evPct,
    sent_at: sentAt,
    legs: (p.legs || []).map(l => ({
      name: l.name,
      game: l.game,
      sport: l.sport,
      market: l.market,
      dk: l.dk,
      commence_time: l.commence_time,
    })),
  }));
}

/**
 * Run an optional table query with AbortController + wall-clock timeout.
 * Missing tables, statement timeouts, and hangs all become `{ data: [] }`.
 */
async function runOptional(run, { timeoutMs = OPTIONAL_TABLE_TIMEOUT_MS, label } = {}) {
  if (typeof run !== 'function') {
    return { data: [], error: null, timedOut: false };
  }

  const ctrl = new AbortController();
  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try { ctrl.abort(); } catch (_) { /* ignore */ }
        reject(timeoutError(label || 'optional query', timeoutMs));
      }, timeoutMs);
      Promise.resolve()
        .then(() => run(ctrl.signal))
        .then(resolve, reject);
    });
    if (result && result.error) {
      console.error(`scan-ev-parlays ${label} error:`, result.error);
      return { data: [], error: result.error, timedOut: false };
    }
    const data = result && result.data != null ? result.data : [];
    return { data: Array.isArray(data) ? data : [], error: null, timedOut: false };
  } catch (err) {
    try { if (!ctrl.signal.aborted) ctrl.abort(); } catch (_) { /* ignore */ }
    console.error(`scan-ev-parlays ${label}:`, err);
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { data: [], error: err, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Required query (odds_cache): same abort + wall-clock cap as runOptional,
 * but the caller must not proceed on failure.
 * Timeout / AbortError → 504. PostgREST or thrown error → 500.
 */
async function runRequired(run, { timeoutMs, label } = {}) {
  const out = await runOptional(run, { timeoutMs, label });
  if (out.timedOut) {
    return {
      ok: false,
      status: 504,
      data: [],
      error: out.error,
      timedOut: true,
      message: (out.error && out.error.message) || `${label || 'query'} timed out`,
    };
  }
  if (out.error) {
    return {
      ok: false,
      status: 500,
      data: [],
      error: out.error,
      timedOut: false,
      message: out.error.message || String(out.error),
    };
  }
  return { ok: true, status: 200, data: out.data, error: null, timedOut: false };
}

function skipTelegramRequested(req) {
  const q = req && req.query;
  if (q && (q.skipTelegram === '1' || q.skipTelegram === 1 || q.skipTelegram === true || q.skipTelegram === 'true')) {
    return true;
  }
  const url = req && req.url;
  if (typeof url === 'string' && url.includes('skipTelegram=')) {
    try {
      const v = new URL(url, 'http://localhost').searchParams.get('skipTelegram');
      return v === '1' || v === 'true';
    } catch (_) { /* ignore */ }
  }
  return false;
}

async function sendTelegram(token, chatId, text, fetchImpl = fetch) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await resp.json().catch(() => ({}));
  const ok = Boolean(resp.ok && data.ok);
  if (!ok) {
    console.error('scan-ev-parlays telegram send failed:', chatId, resp.status, data);
  }
  // Never include the request URL (it embeds the bot token).
  return { ok, status: resp.status, body: data };
}

function publicTelegramError(entry) {
  if (!entry) return undefined;
  if (Array.isArray(entry)) return entry.map(publicTelegramError);
  return {
    chatId: entry.chatId,
    status: entry.status,
    body: entry.body,
  };
}

/**
 * Resolve recipients, send Telegram immediately, then best-effort dedup write.
 *
 * Pre-send `ev_parlay_alerts` read is optional and hard-capped (~2s). Failure
 * is treated as no existing rows (may double-send). Chat-id load failure is
 * treated as `[]` so Kevin's fallback chat id still applies.
 */
async function deliverEvParlayAlerts({
  parlays,
  token,
  envChatId,
  loadChatRows,
  loadExistingRows,
  sendTelegramFn = sendTelegram,
  recordAlerts,
  timeoutMs = OPTIONAL_TABLE_TIMEOUT_MS,
  nowMs,
  stake = STAKE,
} = {}) {
  const list = parlays || [];
  const fingerprints = list.map(p => p.fingerprint).filter(Boolean);

  if (!token) {
    return {
      toAlert: selectNewAlerts(list, {}, { nowMs }).length,
      alerted: 0,
      recipients: 0,
      sent: false,
      skippedTelegram: 'missing_token',
    };
  }

  const [chats, existing] = await Promise.all([
    runOptional(loadChatRows, { timeoutMs, label: 'ev_alert_chats' }),
    fingerprints.length && typeof loadExistingRows === 'function'
      ? runOptional(
        signal => loadExistingRows(fingerprints, signal),
        { timeoutMs, label: 'ev_parlay_alerts read' }
      )
      : Promise.resolve({ data: [], error: null, timedOut: false }),
  ]);

  const existingByFingerprint = {};
  for (const row of existing.data || []) {
    if (row && row.fingerprint) existingByFingerprint[row.fingerprint] = row;
  }

  const toAlert = selectNewAlerts(list, existingByFingerprint, { nowMs });
  const result = {
    toAlert: toAlert.length,
    alerted: 0,
    recipients: 0,
    sent: false,
    skippedTelegram: undefined,
    telegramError: undefined,
    chatsTimedOut: Boolean(chats.timedOut),
    existingTimedOut: Boolean(existing.timedOut),
  };

  if (!toAlert.length) {
    return result;
  }

  const chatIds = mergeEvAlertChatIds({ envChatId, rows: chats.data });
  result.recipients = chatIds.length;
  if (!chatIds.length) {
    result.skippedTelegram = 'no_recipients';
    return result;
  }

  const text = formatAlertMessage(toAlert, stake);
  const telegramErrors = [];
  let sendOk = false;
  for (const chatId of chatIds) {
    try {
      const sent = await sendTelegramFn(token, chatId, text);
      if (sent && sent.ok) sendOk = true;
      else {
        telegramErrors.push({
          chatId,
          status: sent && sent.status,
          body: sent && sent.body,
        });
      }
    } catch (err) {
      console.error('scan-ev-parlays telegram send exception:', chatId, err);
      telegramErrors.push({
        chatId,
        status: 0,
        body: { error: err && err.message ? err.message : String(err) },
      });
    }
  }

  result.sent = sendOk;
  result.alerted = sendOk ? toAlert.length : 0;
  if (telegramErrors.length) {
    result.telegramError = publicTelegramError(
      telegramErrors.length === 1 ? telegramErrors[0] : telegramErrors
    );
  }

  // Dedup write is strictly after send. Hang/timeout/missing table: log only.
  if (sendOk && typeof recordAlerts === 'function') {
    const recorded = await runOptional(
      signal => recordAlerts(toAlert, signal),
      { timeoutMs, label: 'ev_parlay_alerts upsert' }
    );
    result.dedupWriteTimedOut = Boolean(recorded.timedOut);
    if (recorded.error) result.dedupWriteError = true;
  }

  return result;
}

module.exports = {
  OPTIONAL_TABLE_TIMEOUT_MS,
  ODDS_CACHE_TIMEOUT_MS,
  ODDS_CACHE_COLUMNS,
  applyAbortSignal,
  alertRowsForUpsert,
  runOptional,
  runRequired,
  skipTelegramRequested,
  sendTelegram,
  deliverEvParlayAlerts,
};
