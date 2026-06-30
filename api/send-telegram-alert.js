const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────────────────────────────────
// POST /api/send-telegram-alert
//
// Sends a "bet placed" Telegram DM to a single customer.
//
// Auth: requires header `x-admin-secret` matching env ADMIN_API_SECRET.
//
// Body (JSON):
//   {
//     telegram_user_id: "<uuid from telegram_users table>",
//     bet_description: "Yankees ML -120",
//     risk: 100,
//     profit: 83.33,
//     placed_at: "2026-06-29T18:30:00Z"   // ISO 8601
//   }
//
// Returns 200 { success: true, telegram_message_id } on success.
// ─────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS for the admin UI on the same Vercel domain (and previews)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || providedSecret !== process.env.ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Validate body ────────────────────────────────────────────────────
  const { telegram_user_id, bet_description, risk, profit, placed_at } = req.body || {};
  if (!telegram_user_id || !bet_description || risk == null || profit == null || !placed_at) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['telegram_user_id', 'bet_description', 'risk', 'profit', 'placed_at'],
    });
  }

  try {
    // ── Look up the customer ──────────────────────────────────────────
    const { data: user, error: userErr } = await supabase
      .from('telegram_users')
      .select('id, customer_name, telegram_chat_id, is_active')
      .eq('id', telegram_user_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'Customer not found', details: userErr?.message });
    }
    if (!user.is_active) {
      return res.status(400).json({ error: 'Customer is not active (unsubscribed)' });
    }

    // ── Format the message ───────────────────────────────────────────
    const placedDate = new Date(placed_at);
    const placedFormatted = placedDate.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const riskFmt = Number(risk).toFixed(2);
    const profitFmt = Number(profit).toFixed(2);

    const text =
      `✅ Bet Placed for ${user.customer_name}\n\n` +
      `Wager: ${bet_description}\n` +
      `Risk: $${riskFmt}\n` +
      `To Win: $${profitFmt}\n` +
      `Placed: ${placedFormatted} ET\n\n` +
      `— KayGo Sports`;

    // ── Send to Telegram ──────────────────────────────────────────────
    const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResp = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_chat_id,
        text,
      }),
    });
    const tgData = await tgResp.json();

    if (!tgResp.ok || !tgData.ok) {
      return res.status(502).json({
        error: 'Telegram API error',
        telegram_response: tgData,
      });
    }

    return res.status(200).json({
      success: true,
      telegram_message_id: tgData.result?.message_id,
      sent_to: user.customer_name,
    });
  } catch (err) {
    console.error('send-telegram-alert error:', err);
    return res.status(500).json({ error: err.message });
  }
};
