// Adverse Protect Telegram ping. Same KayGo bot as the rest of this app
// (TELEGRAM_BOT_TOKEN). Chat id prefers TELEGRAM_ALERT_CHAT_ID (combo-worker)
// and otherwise Kevin's admin chat already used by api/telegram-webhook.js.
// Not the +EV parlays bot.
'use strict';

const KEVIN_ADMIN_CHAT_ID = '8745205056';

function protectChatId(env) {
  const named = String((env && env.TELEGRAM_ALERT_CHAT_ID) || '').trim();
  return named || KEVIN_ADMIN_CHAT_ID;
}

async function sendProtectTelegram(text, { env = process.env, fetchImpl = fetch } = {}) {
  const token = String((env && env.TELEGRAM_BOT_TOKEN) || '').trim();
  const chatId = protectChatId(env);
  if (!token) return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN missing' };
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text || '').slice(0, 500) }),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  if (!res.ok || (body && body.ok === false)) {
    return { ok: false, skipped: false, status: res.status };
  }
  return { ok: true, skipped: false };
}

module.exports = {
  KEVIN_ADMIN_CHAT_ID,
  protectChatId,
  sendProtectTelegram,
  sendProtectPing: sendProtectTelegram,
};
