// Standalone @evparlaysbot scanner for Railway.
// Long-running process: scan MLB + next 24h +EV 3-legs, send Telegram, sleep,
// repeat. Does NOT go through Vercel HTTP. A crash here cannot starve the Vite
// app or Vercel serverless concurrency.
//
// Dedicated token only: EVparlays_alert_telegram_bot_token (case-insensitive).
// Never TELEGRAM_BOT_TOKEN / KayGo.
const { runEvParlayScan } = require('../lib/ev-parlay-scan-job');
const { resolveEvParlaysBotToken } = require('../lib/ev-parlays-bot-token');

const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000;
const WORKER_ODDS_CACHE_TIMEOUT_MS = 120000;
const WORKER_OPTIONAL_TABLE_TIMEOUT_MS = 8000;
const WORKER_SCAN_TIME_BUDGET_MS = 240000;

function parsePositiveMs(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return fallback;
  return Math.floor(n);
}

function scanIntervalMs(env = process.env) {
  return parsePositiveMs(env.EV_SCAN_INTERVAL_MS, DEFAULT_SCAN_INTERVAL_MS);
}

function oddsCacheTimeoutMs(env = process.env) {
  return parsePositiveMs(env.EV_ODDS_CACHE_TIMEOUT_MS, WORKER_ODDS_CACHE_TIMEOUT_MS);
}

function optionalTableTimeoutMs(env = process.env) {
  return parsePositiveMs(env.EV_OPTIONAL_TABLE_TIMEOUT_MS, WORKER_OPTIONAL_TABLE_TIMEOUT_MS);
}

function scanTimeBudgetMs(env = process.env) {
  return parsePositiveMs(env.EV_SCAN_TIME_BUDGET_MS, WORKER_SCAN_TIME_BUDGET_MS);
}

function sleep(ms, wakeRef) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (wakeRef) {
      wakeRef.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }
  });
}

function requiredEnvPresent(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SERVICE_KEY || '').trim();
  return Boolean(url && key);
}

async function runOnce(opts = {}) {
  const env = opts.env || process.env;
  const t0 = Date.now();
  const timeouts = {
    oddsCacheTimeoutMs: opts.oddsCacheTimeoutMs ?? oddsCacheTimeoutMs(env),
    optionalTableTimeoutMs: opts.optionalTableTimeoutMs ?? optionalTableTimeoutMs(env),
    timeBudgetMs: opts.timeBudgetMs ?? scanTimeBudgetMs(env),
  };
  console.log('ev-parlay-worker scan start', timeouts);
  const result = await runEvParlayScan({
    ...timeouts,
    skipTelegram: Boolean(opts.skipTelegram),
    token: opts.token,
    envChatId: opts.envChatId,
    supabaseClient: opts.supabaseClient,
    queryOddsCache: opts.queryOddsCache,
    loadChatRows: opts.loadChatRows,
    loadExistingRows: opts.loadExistingRows,
    recordAlerts: opts.recordAlerts,
    sendTelegramFn: opts.sendTelegramFn,
  });
  const elapsedMs = Date.now() - t0;
  const payload = result && result.payload ? result.payload : {};
  console.log('ev-parlay-worker scan done', {
    ok: result.ok,
    status: result.status,
    sentSuccessfully: result.sentSuccessfully,
    elapsedMs,
    combos: payload.comboCount,
    scanElapsedMs: payload.scanElapsedMs,
    candidates: payload.candidates,
    toAlert: payload.toAlert,
    alerted: payload.alerted,
    recipients: payload.recipients,
    timedOut: payload.timedOut,
    loadedSports: payload.loadedSports,
    timedOutSports: payload.timedOutSports,
    errorSports: payload.errorSports,
    skippedTelegram: payload.skippedTelegram,
    error: payload.error,
  });
  return { ...result, elapsedMs };
}

async function main() {
  if (!requiredEnvPresent()) {
    console.error('ev-parlay-worker missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const { token, envName } = resolveEvParlaysBotToken();
  if (!token) {
    console.error(
      'ev-parlay-worker missing EVparlays_alert_telegram_bot_token (case-insensitive). Will scan but cannot send Telegram.'
    );
  } else {
    console.log('ev-parlay-worker token present', { envName });
  }

  const intervalMs = scanIntervalMs();
  console.log('ev-parlay-worker starting', {
    intervalMs,
    oddsCacheTimeoutMs: oddsCacheTimeoutMs(),
    optionalTableTimeoutMs: optionalTableTimeoutMs(),
    timeBudgetMs: scanTimeBudgetMs(),
    fallbackChatId: '8745205056',
  });

  let stopping = false;
  const wakeRef = {};
  const onStop = (signal) => {
    console.log(`ev-parlay-worker received ${signal}, will exit after current scan`);
    stopping = true;
    if (typeof wakeRef.wake === 'function') wakeRef.wake();
  };
  process.on('SIGTERM', () => onStop('SIGTERM'));
  process.on('SIGINT', () => onStop('SIGINT'));

  while (!stopping) {
    try {
      await runOnce();
    } catch (err) {
      console.error('ev-parlay-worker scan error:', err && err.message ? err.message : err);
    }
    if (stopping) break;
    const waitMs = scanIntervalMs();
    console.log(`ev-parlay-worker sleeping ${waitMs}ms until next scan`);
    await sleep(waitMs, wakeRef);
  }

  console.log('ev-parlay-worker stopped');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('ev-parlay-worker fatal:', err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SCAN_INTERVAL_MS,
  WORKER_ODDS_CACHE_TIMEOUT_MS,
  WORKER_OPTIONAL_TABLE_TIMEOUT_MS,
  WORKER_SCAN_TIME_BUDGET_MS,
  parsePositiveMs,
  scanIntervalMs,
  oddsCacheTimeoutMs,
  optionalTableTimeoutMs,
  scanTimeBudgetMs,
  requiredEnvPresent,
  runOnce,
  main,
};
