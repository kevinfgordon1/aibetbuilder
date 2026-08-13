const { supabase } = require('../lib/odds-shared');
const { resolveEvParlaysBotToken } = require('../lib/ev-parlays-bot-token');

// ─────────────────────────────────────────────────────────────────────────
// POST /api/ev-alert-telegram-webhook
//
// Receives messages sent to @evparlaysbot (Kevin's private +EV parlay alerts).
// Separate from KayGo (@Kaygosports_bot / api/telegram-webhook.js).
//
// Auth: Telegram secret header must match EV_ALERT_TELEGRAM_WEBHOOK_SECRET.
// Token used to reply: EVparlays_alert_telegram_bot_token (case-insensitive).
//
// /start → upsert ev_alert_chats (NOT telegram_users)
// /stop  → is_active=false
// /help  → short menu
// Always 200 so Telegram does not retry.
// ─────────────────────────────────────────────────────────────────────────

async function sendTelegram(chatId, text) {
  const { token, envName } = resolveEvParlaysBotToken();
  if (!token) {
    console.log('ev-alert-telegram-webhook:', { tokenPresent: false, envName });
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      console.error('ev-alert sendTelegram non-ok:', resp.status, data);
    }
  } catch (err) {
    console.error('ev-alert sendTelegram exception:', err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!providedSecret || providedSecret !== process.env.EV_ALERT_TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const update = req.body || {};
  const message = update.message;
  if (!message || !message.chat || !message.from) {
    return res.status(200).json({ ok: true, skipped: 'no message' });
  }

  const chatId = message.chat.id;
  const firstName = message.from.first_name || '';
  const lastName = message.from.last_name || '';
  const username = message.from.username || null;
  const text = (message.text || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
    || username
    || `Telegram ${chatId}`;

  try {
    if (text.startsWith('/start')) {
      const { error } = await supabase
        .from('ev_alert_chats')
        .upsert(
          {
            telegram_chat_id: chatId,
            display_name: displayName,
            username,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'telegram_chat_id', ignoreDuplicates: false }
        );
      if (error) console.error('upsert ev_alert_chats error:', error);

      await sendTelegram(chatId,
        `You're subscribed to +EV 3-leg parlay alerts on @evparlaysbot.\n\n` +
        `You'll get a ping when a 3-leg $100 / 0% boost parlay on any sportsbook ` +
        `clears EV% > 2.\n\n` +
        `/stop to unsubscribe · /help for commands`
      );
    } else if (/^\/?stop\b/i.test(text)) {
      const { error } = await supabase
        .from('ev_alert_chats')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('telegram_chat_id', chatId);
      if (error) console.error('ev_alert_chats stop update error:', error);

      await sendTelegram(chatId, `Unsubscribed from +EV parlay alerts. Send /start to subscribe again.`);
    } else if (/^\/?help\b/i.test(text)) {
      await sendTelegram(chatId,
        `@evparlaysbot — private +EV 3-leg alerts.\n\n` +
        `/start — subscribe\n` +
        `/stop — unsubscribe\n` +
        `/help — this message`
      );
    } else {
      await sendTelegram(chatId, `This bot only sends +EV parlay alerts. /start · /stop · /help`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('ev-alert-telegram-webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
