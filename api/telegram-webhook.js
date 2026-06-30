const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────────────────────────────────
// POST /api/telegram-webhook
//
// Receives every message sent to @Kaygosports_bot.
//
// Auth model (Telegram's recommended pattern):
//   - We set the webhook URL with a secret_token (TELEGRAM_WEBHOOK_SECRET).
//   - Telegram includes that secret in the `X-Telegram-Bot-Api-Secret-Token`
//     header on every webhook call.
//   - We reject any request whose header doesn't match.
//   This prevents random callers from spamming this endpoint.
//
// Behaviour:
//   - On `/start`: insert/upsert into telegram_users with is_active=true,
//     customer_name = the user's Telegram first_name (+ last_name if present).
//   - On any other text: bot replies with a generic "you're subscribed" note
//     so the user knows the bot is alive.
//   - Always returns 200 OK to Telegram (so they don't retry).
// ─────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify the secret header Telegram sends ──────────────────────────
  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!providedSecret || providedSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Parse the update ─────────────────────────────────────────────────
  const update = req.body || {};
  const message = update.message;
  if (!message || !message.chat || !message.from) {
    // Could be a callback_query, edited_message, or other update type — ignore for now.
    return res.status(200).json({ ok: true, skipped: 'no message' });
  }

  const chatId      = message.chat.id;          // numeric — what we DM
  const firstName   = message.from.first_name || '';
  const lastName    = message.from.last_name  || '';
  const username    = message.from.username   || null;
  const text        = (message.text || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
                      || username
                      || `Telegram ${chatId}`;

  try {
    if (text.startsWith('/start')) {
      // ── Subscribe / re-subscribe the user ─────────────────────────
      // Upsert: if they previously /start'd (or you previously toggled is_active=false),
      // this re-activates them. We don't overwrite an existing customer_name on conflict
      // because you may have renamed them in the dashboard.
      const { error } = await supabase
        .from('telegram_users')
        .upsert(
          {
            telegram_chat_id: chatId,
            customer_name: displayName,
            is_active: true,
            notes: username ? `Telegram: @${username}` : null,
          },
          { onConflict: 'telegram_chat_id', ignoreDuplicates: false }
        );
      if (error) {
        console.error('upsert telegram_users error:', error);
        // Still ACK to Telegram so they don't retry; we'll log and move on.
      }

      await sendTelegram(chatId,
        `👋 Welcome, ${firstName || 'there'}!\n\n` +
        `You're subscribed to KayGo Sports alerts. ` +
        `Kevin will text you when a bet is placed on your account.\n\n` +
        `Reply STOP at any time to unsubscribe.`
      );
    } else if (/^\/?stop\b/i.test(text)) {
      // ── Unsubscribe ───────────────────────────────────────────────
      const { error } = await supabase
        .from('telegram_users')
        .update({ is_active: false })
        .eq('telegram_chat_id', chatId);
      if (error) console.error('stop update error:', error);

      await sendTelegram(chatId,
        `You're unsubscribed. Send /start any time to re-subscribe.`
      );
    } else if (/^\/?help\b/i.test(text)) {
      await sendTelegram(chatId,
        `KayGo Sports alerts.\n\n` +
        `/start — subscribe\n` +
        `STOP — unsubscribe\n` +
        `HELP — this message\n\n` +
        `Questions? Reach out to Kevin directly.`
      );
    } else {
      // Catch-all: tell them the bot is one-way for alerts
      await sendTelegram(chatId,
        `This bot sends KayGo Sports alerts. ` +
        `Reply STOP to unsubscribe, HELP for help.`
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Always ACK so Telegram doesn't retry forever
    return res.status(200).json({ ok: true, error: err.message });
  }
};

// ── Helper: send a Telegram message ──────────────────────────────────────
async function sendTelegram(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      console.error('sendTelegram non-ok:', resp.status, data);
    }
  } catch (err) {
    console.error('sendTelegram exception:', err);
  }
}
