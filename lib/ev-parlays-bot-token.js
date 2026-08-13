// Dedicated @evparlaysbot token. Do NOT use KayGo TELEGRAM_BOT_TOKEN.
const EV_PARLAYS_BOT_TOKEN_ENV = 'EVparlays_alert_telegram_bot_token';

function trimmedToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Resolve Kevin's dedicated bot token.
 * Tries the preferred mixed-case name first, then a case-insensitive
 * search (Vercel/Lambda often injects EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN).
 * Never falls back to TELEGRAM_BOT_TOKEN.
 */
function resolveEvParlaysBotToken(env = process.env) {
  const exact = trimmedToken(env[EV_PARLAYS_BOT_TOKEN_ENV]);
  if (exact) {
    return { token: exact, envName: EV_PARLAYS_BOT_TOKEN_ENV };
  }

  const wanted = EV_PARLAYS_BOT_TOKEN_ENV.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() !== wanted) continue;
    const token = trimmedToken(env[key]);
    if (token) return { token, envName: key };
  }

  return { token: '', envName: null };
}

function evParlaysBotToken(env = process.env) {
  return resolveEvParlaysBotToken(env).token;
}

module.exports = {
  EV_PARLAYS_BOT_TOKEN_ENV,
  resolveEvParlaysBotToken,
  evParlaysBotToken,
};
