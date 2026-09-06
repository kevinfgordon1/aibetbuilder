// Lightweight share landing for OG unfurls. Hash fragments never reach the
// server, so Copy link uses /s/{tab}/{id} → this page → /#{tab}/{id}.
// Combo / owner routes get a generic card — no lock contents in the HTML.

'use strict';

const TAB_LABEL = {
  promo: 'Promo pick',
  ev: '+EV pick',
  odds: 'Odds Board',
  combo: 'AI Bet Builder',
  missTape: 'AI Bet Builder',
  miss: 'AI Bet Builder',
  'miss-tape': 'AI Bet Builder',
  unhedged: 'AI Bet Builder',
  profile: 'Profile',
};

const PROMO_TYPE_LABEL = {
  boost: 'Profit Boost',
  nosweat: 'No Sweat',
  freebet: 'Free Bet',
};

const BOOK_LABEL = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  williamhill_us: 'Caesars',
  betmgm: 'BetMGM',
  betrivers: 'BetRivers',
  fanatics: 'Fanatics',
  hardrockbet: 'Hard Rock',
  espnbet: 'theScore Bet',
  bovada: 'Bovada',
  mybookieag: 'MyBookie',
  betonlineag: 'BetOnline',
  pinnacle: 'Pinnacle',
  lowvig: 'LowVig',
  betus: 'BetUS',
  betanysports: 'BetAnything',
  kalshi: 'Kalshi',
  novig: 'Novig',
  prophetx: 'ProphetX',
  polymarket: 'Polymarket',
  betopenly: 'BetOpenly',
};

const GATED = new Set(['combo', 'missTape', 'miss', 'miss-tape', 'unhedged', 'profile']);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseSharePath(p) {
  const raw = String(p == null ? '' : p).replace(/^#/, '').replace(/^\/+/, '').trim();
  const parts = raw.split('/').filter(Boolean);
  const tab = parts[0] || 'promo';
  const rest = parts.slice(1).join('/');
  return { tab, rest, raw: raw || 'promo' };
}

function bookLabel(key) {
  const k = String(key || '').toLowerCase();
  if (BOOK_LABEL[k]) return BOOK_LABEL[k];
  if (!k) return '';
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePromoShareId(cardId) {
  const raw = String(cardId == null ? '' : cardId).trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length < 4) return null;
  const hash = parts.pop();
  const stakePart = parts.pop();
  const book = parts.pop();
  const promoType = parts.join('.');
  if (!PROMO_TYPE_LABEL[promoType] || !book || !hash) return null;
  const stake = Number(stakePart);
  if (!Number.isFinite(stake)) return null;
  return { promoType, book, stake, hash };
}

function parseEvShareId(cardId) {
  const raw = String(cardId == null ? '' : cardId).trim();
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const book = raw.slice(0, dot);
  const hash = raw.slice(dot + 1);
  if (!book || !hash) return null;
  return { book, hash };
}

function shareOgCopy({ tab, rest }) {
  if (tab === 'promo') {
    const parsed = parsePromoShareId(rest);
    if (parsed) {
      const promo = PROMO_TYPE_LABEL[parsed.promoType];
      const book = bookLabel(parsed.book);
      const title = 'AI Bet Builder — ' + book + ' ' + promo;
      return {
        title,
        description: 'Open this ' + book + ' ' + promo + ' pick on AI Bet Builder.',
      };
    }
    return {
      title: 'AI Bet Builder — Promo pick',
      description: 'Open this promo pick on AI Bet Builder.',
    };
  }
  if (tab === 'ev') {
    const parsed = parseEvShareId(rest);
    const book = parsed ? bookLabel(parsed.book) : '';
    return {
      title: book ? 'AI Bet Builder — ' + book + ' +EV pick' : 'AI Bet Builder — +EV pick',
      description: book
        ? 'Open this ' + book + ' +EV pick on AI Bet Builder.'
        : 'Open this +EV pick on AI Bet Builder.',
    };
  }
  return {
    title: 'AI Bet Builder — ' + (TAB_LABEL[tab] || 'Pick'),
    description: 'Open this pick on AI Bet Builder.',
  };
}

function originFromReq(req) {
  const proto = (req.headers && (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'])) || 'https';
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'aibetbuilder.io';
  return String(proto).split(',')[0].trim() + '://' + String(host).split(',')[0].trim();
}

function handler(req, res) {
  const q = (req && req.query) || {};
  const fromQuery = q.p || q.path || '';
  let path = Array.isArray(fromQuery) ? fromQuery.join('/') : String(fromQuery);
  if (!path && req && req.url) {
    const u = String(req.url).split('?')[0];
    const m = /^\/s\/(.*)$/.exec(u);
    if (m) path = m[1];
  }
  const parsed = parseSharePath(path);
  const gated = GATED.has(parsed.tab);
  const og = shareOgCopy({ tab: parsed.tab, rest: parsed.rest });
  const title = gated ? 'AI Bet Builder' : og.title;
  const description = gated
    ? 'Sign in to continue.'
    : (q.t || q.title)
      ? String(Array.isArray(q.t) ? q.t[0] : q.t)
      : og.description;
  const origin = originFromReq(req);
  const dest = origin + '/#' + parsed.raw;
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(dest)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta http-equiv="refresh" content="0;url=${esc(dest)}" />
  <link rel="canonical" href="${esc(dest)}" />
</head>
<body style="background:#0a0b0f;color:#e8eaed;font-family:system-ui,sans-serif;padding:40px;text-align:center">
  <p>Opening AI Bet Builder…</p>
  <p><a href="${esc(dest)}" style="color:#60a5fa">Continue</a></p>
  <script>location.replace(${JSON.stringify(dest)});</script>
</body>
</html>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(page);
}

handler._helpers = { parseSharePath, esc, GATED, TAB_LABEL, shareOgCopy, parsePromoShareId, bookLabel };
module.exports = handler;
