const { supabase } = require('../lib/odds-shared');
const { SPORT_KEYS, hydrateFeaturedOdds } = require('../lib/promo-ev');
const {
  STAKE,
  scanBooksForEvParlays,
  selectNewAlerts,
  formatAlertMessage,
  mergeEvAlertChatIds,
} = require('../lib/ev-parlay-alert');
const { resolveEvParlaysBotToken } = require('../lib/ev-parlays-bot-token');

// Dedicated @evparlaysbot token. Do NOT use KayGo TELEGRAM_BOT_TOKEN.
// Env name: EVparlays_alert_telegram_bot_token (case-insensitive fallback).

async function collectChatIds() {
  const envId = (process.env.EV_ALERT_TELEGRAM_CHAT_ID || '').trim();

  const { data, error } = await supabase
    .from('ev_alert_chats')
    .select('telegram_chat_id')
    .eq('is_active', true);
  if (error) {
    console.error('scan-ev-parlays ev_alert_chats read error:', error);
  }

  // Env chat + active ev_alert_chats rows; if both empty, Kevin's user id
  // (same as KayGo ADMIN_CHAT_ID in api/telegram-webhook.js) as @evparlaysbot chat_id.
  return mergeEvAlertChatIds({ envChatId: envId, rows: error ? [] : data });
}

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    console.error('scan-ev-parlays telegram send failed:', chatId, resp.status, data);
    return false;
  }
  return true;
}

// GET/POST /api/scan-ev-parlays
// Reads cached odds (no Odds API pull). Scores 3-leg $100 0% boost parlays
// for every Promo Builder book. Alerts @evparlaysbot when EV% > 2.
module.exports = async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('odds_cache')
      .select('*')
      .in('sport', SPORT_KEYS);
    if (error) {
      console.error('scan-ev-parlays odds_cache error:', error);
      return res.status(500).json({ error: error.message });
    }

    const oddsData = hydrateFeaturedOdds(rows);
    const scan = scanBooksForEvParlays(oddsData);
    console.log(
      `scan-ev-parlays combos=${scan.comboCount} elapsedMs=${scan.elapsedMs} timedOut=${scan.timedOut}`,
      scan.stats
    );

    const fingerprints = scan.parlays.map(p => p.fingerprint);
    const existingByFingerprint = {};
    if (fingerprints.length) {
      const { data: existing, error: existErr } = await supabase
        .from('ev_parlay_alerts')
        .select('fingerprint, ev_pct, sent_at')
        .in('fingerprint', fingerprints);
      if (existErr) {
        console.error('scan-ev-parlays ev_parlay_alerts read error:', existErr);
      } else {
        for (const row of existing || []) existingByFingerprint[row.fingerprint] = row;
      }
    }

    const toAlert = selectNewAlerts(scan.parlays, existingByFingerprint);
    const summary = {
      success: true,
      comboCount: scan.comboCount,
      elapsedMs: scan.elapsedMs,
      timedOut: scan.timedOut,
      candidates: scan.parlays.length,
      toAlert: toAlert.length,
      booksScanned: scan.stats.filter(s => !s.skipped).length,
    };

    const { token, envName } = resolveEvParlaysBotToken();
    console.log('scan-ev-parlays:', { tokenPresent: Boolean(token), envName });
    if (!token) {
      return res.status(200).json({ ...summary, skippedTelegram: 'missing_token' });
    }

    if (!toAlert.length) {
      return res.status(200).json({ ...summary, alerted: 0 });
    }

    const chatIds = await collectChatIds();
    if (!chatIds.length) {
      console.log('scan-ev-parlays: no recipients (set EV_ALERT_TELEGRAM_CHAT_ID or /start @evparlaysbot)');
      return res.status(200).json({ ...summary, skippedTelegram: 'no_recipients' });
    }

    const text = formatAlertMessage(toAlert, STAKE);
    let sendOk = false;
    for (const chatId of chatIds) {
      if (await sendTelegram(token, chatId, text)) sendOk = true;
    }

    if (sendOk) {
      const now = new Date().toISOString();
      for (const p of toAlert) {
        const { error: upsertErr } = await supabase.from('ev_parlay_alerts').upsert({
          fingerprint: p.fingerprint,
          book_key: p.bookKey,
          ev_pct: p.evPct,
          sent_at: now,
          legs: (p.legs || []).map(l => ({
            name: l.name,
            game: l.game,
            sport: l.sport,
            market: l.market,
            dk: l.dk,
            commence_time: l.commence_time,
          })),
        }, { onConflict: 'fingerprint' });
        if (upsertErr) console.error('scan-ev-parlays dedup upsert error:', upsertErr);
      }
    }

    return res.status(200).json({ ...summary, alerted: sendOk ? toAlert.length : 0, recipients: chatIds.length });
  } catch (err) {
    console.error('scan-ev-parlays error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
