// Combo Lock per-user Telegram opt-in (Oct 2026, testers).
// Deep link: https://t.me/Kaygosports_bot?start=cl_<token>
// Telegram delivers it to /api/telegram-webhook as "/start cl_<token>".
// The token is a row in public.combo_tg_links (service role only); linking
// stores that chat_id on that user's row. The combo-testers worker then sends
// that chat alerts about that user's own Combo Locks only.
'use strict';

const PAYLOAD_RE = /^\/start(?:@\w+)?\s+cl_([A-Za-z0-9_-]{16,60})\s*$/;

function parseComboLinkToken(text) {
  const m = PAYLOAD_RE.exec(String(text || '').trim());
  return m ? m[1] : null;
}

function isStopText(text) {
  return /^\/?stop\b/i.test(String(text || '').trim());
}

// Returns { linked: bool, reply: string }
async function linkComboChat(supabase, token, chatId) {
  const { data, error } = await supabase
    .from('combo_tg_links')
    .update({ chat_id: chatId, linked_at: new Date().toISOString(), enabled: true })
    .eq('link_token', token)
    .select('user_id');
  if (error || !data || !data.length) {
    return { linked: false, reply: "That Combo Lock alert link isn't valid. Ask Kevin for a new one." };
  }
  return {
    linked: true,
    reply: "You're set up for Combo Lock alerts. You'll get a message when your Combo Lock sends a quote or fills. Reply STOP to turn them off.",
  };
}

// STOP also turns off Combo Lock alerts for this chat.
async function unlinkComboChat(supabase, chatId) {
  const { error } = await supabase.from('combo_tg_links').update({ enabled: false }).eq('chat_id', chatId);
  return !error;
}

module.exports = { parseComboLinkToken, isStopText, linkComboChat, unlinkComboChat };
