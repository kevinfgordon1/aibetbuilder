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
// Auth model:
//   - We set the webhook URL with a secret_token (TELEGRAM_WEBHOOK_SECRET).
//   - Telegram includes that secret in the `X-Telegram-Bot-Api-Secret-Token`
//     header on every webhook call. We reject anything without it.
//
// Behaviour:
//   - `/start`  → upsert into telegram_users, is_active=true, welcome msg
//   - `stop`    → mark is_active=false, confirm unsubscribe
//   - `help`    → send help menu
//   - anything else → "Message sent" ack to sender; forward to admin
//
// Always returns 200 OK to Telegram so they don't retry.
// ─────────────────────────────────────────────────────────────────────────

// Admin chat ID — messages get forwarded here
const ADMIN_CHAT_ID = 8745205056;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify Telegram's secret header ─────────────────────────────────
  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!providedSecret || providedSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Parse the update ─────────────────────────────────────────────────
  const update = req.body || {};
  const message = update.message;
  if (!message || !message.chat || !message.from) {
    return res.status(200).json({ ok: true, skipped: 'no message' });
  }

  const chatId      = message.chat.id;
  const firstName   = message.from.first_name || '';
  const lastName    = message.from.last_name  || '';
  const username    = message.from.username   || null;
  const text        = (message.text || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
                      || username
                      || `Telegram ${chatId}`;

  // Don't forward the admin's own messages back to themselves
  const isAdmin = chatId === ADMIN_CHAT_ID;

  try {
    if (text.startsWith('/start')) {
      // ── Subscribe / re-subscribe ─────────────────────────────────
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
      if (error) console.error('upsert telegram_users error:', error);

      await sendTelegram(chatId,
        `👋 Welcome, ${firstName || 'there'}!\n\n` +
        `You're subscribed to KayGo Sports alerts. ` +
        `Kevin will text you when a bet is placed on your account.\n\n` +
        `Reply STOP at any time to unsubscribe.`
      );
    } else if (/^\/?stop\b/i.test(text)) {
      // ── Unsubscribe ─────────────────────────────────────────────
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
      // ── Catch-all: ack sender, forward to admin ────────────────
      if (!isAdmin) {
        // 1. Reply to the sender
        await sendTelegram(chatId, `Message sent.`);

        // 2. Forward to admin
        //    Include a tg:// link so admin can DM the customer directly
        //    even if they don't have a @username.
        const usernameLine = username ? `@${username}` : '(no username)';
        const forwardText =
          `💬 New reply from ${displayName}\n` +
          `${usernameLine}\n\n` +
          `"${text}"\n\n` +
          `👉 Reply directly: tg://user?id=${chatId}`;
        await sendTelegram(ADMIN_CHAT_ID, forwardText);
      }
      // If it IS the admin messaging the bot, just no-op silently.
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
};

// ── Helper: send a Telegram message ─────────────────────────────────────
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
