// EV 3-leg parlay alert helpers (fingerprint, dedup, Telegram copy, scan).
// Pure module — no Supabase / Telegram I/O. Used by api/scan-ev-parlays.js.

const {
  ALL_BOOKS,
  calcParlayEV,
  buildAllLegsForBook,
  mainMarketLegs,
  sortLegsByEdge,
  evPct,
  passesEvThreshold,
  formatOdds,
  probToAmerican,
  bookLabel,
} = require("./promo-ev");

const STAKE = 100;
const BOOST_PCT = 0;
const NUM_LEGS = 3;
const MIN_EV_PCT = 2;
const SCAN_LEG_CAP = 120;
const GLOBAL_CANDIDATE_CAP = 15;
const ALERT_MAX = 5;
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;
const EV_JUMP_PCT = 1;
const SITE_URL = "https://www.aibetbuilder.io/";
const TIME_BUDGET_MS = 45000;
// Kevin's Telegram user id — same as KayGo ADMIN_CHAT_ID in api/telegram-webhook.js.
// Used only as chat_id for @evparlaysbot. Never send via TELEGRAM_BOT_TOKEN / KayGo bot.
const KEVIN_EV_ALERT_CHAT_ID = "8745205056";

function mergeEvAlertChatIds({ envChatId, rows } = {}) {
  const ids = new Set();
  const envId = String(envChatId || "").trim();
  if (envId) ids.add(envId);
  for (const row of rows || []) {
    if (row && row.telegram_chat_id != null) ids.add(String(row.telegram_chat_id));
  }
  if (ids.size === 0) ids.add(KEVIN_EV_ALERT_CHAT_ID);
  return [...ids];
}

function parlayFingerprint(bookKey, legs) {
  const names = (legs || []).map(l => l.name).filter(Boolean).slice().sort();
  const sports = [...new Set((legs || []).map(l => l.sport).filter(Boolean))].sort();
  return `${bookKey}::${sports.join(",")}::${names.join("|")}`;
}

function shouldRealert(existing, evPctNow, opts = {}) {
  const windowMs = opts.windowMs ?? DEDUP_WINDOW_MS;
  const jumpPct = opts.jumpPct ?? EV_JUMP_PCT;
  const nowMs = opts.nowMs ?? Date.now();
  if (!existing) return true;
  const sentAt = new Date(existing.sent_at).getTime();
  if (!Number.isFinite(sentAt)) return true;
  if (nowMs - sentAt >= windowMs) return true;
  const prev = Number(existing.ev_pct);
  if (Number.isFinite(prev) && evPctNow - prev >= jumpPct) return true;
  return false;
}

function considerTop(top, item, maxResults) {
  if (top.length < maxResults) {
    top.push(item);
    top.sort((a, b) => b.ev - a.ev);
    return;
  }
  if (item.ev <= top[top.length - 1].ev) return;
  top.push(item);
  top.sort((a, b) => b.ev - a.ev);
  top.length = maxResults;
}

function findMain3LegHits(legs, opts = {}) {
  const boostPct = opts.boostPct ?? BOOST_PCT;
  const stake = opts.stake ?? STAKE;
  const minEvPct = opts.minEvPct ?? MIN_EV_PCT;
  const maxResults = opts.maxResults ?? GLOBAL_CANDIDATE_CAP;
  const t0 = Date.now();
  const top = [];
  let comboCount = 0;
  const n = legs.length;
  const getGame = (leg) => leg.game;

  for (let i = 0; i < n; i++) {
    const gi = getGame(legs[i]);
    for (let j = i + 1; j < n; j++) {
      if (getGame(legs[j]) === gi) continue;
      const gj = getGame(legs[j]);
      for (let k = j + 1; k < n; k++) {
        if (getGame(legs[k]) === gi || getGame(legs[k]) === gj) continue;
        comboCount++;
        const trio = [legs[i], legs[j], legs[k]];
        const r = calcParlayEV(trio, boostPct, stake);
        if (!passesEvThreshold(r.ev, stake, minEvPct)) continue;
        considerTop(top, { legs: trio, ...r, evPct: evPct(r.ev, stake) }, maxResults);
      }
    }
  }

  return { parlays: top, comboCount, elapsedMs: Date.now() - t0 };
}

function scanBooksForEvParlays(oddsData, opts = {}) {
  const stake = opts.stake ?? STAKE;
  const boostPct = opts.boostPct ?? BOOST_PCT;
  const minEvPct = opts.minEvPct ?? MIN_EV_PCT;
  const legCap = opts.legCap ?? SCAN_LEG_CAP;
  const candidateCap = opts.candidateCap ?? GLOBAL_CANDIDATE_CAP;
  const timeBudgetMs = opts.timeBudgetMs ?? TIME_BUDGET_MS;
  const books = opts.books || ALL_BOOKS;
  const t0 = Date.now();
  const globalTop = [];
  const stats = [];
  let comboCount = 0;
  let timedOut = false;

  for (const book of books) {
    if (Date.now() - t0 > timeBudgetMs) {
      timedOut = true;
      stats.push({ book: book.key, skipped: true, reason: "time_budget" });
      continue;
    }

    const rawLegs = buildAllLegsForBook(oddsData, book.key, null, null, "any");
    const mains = mainMarketLegs(rawLegs);
    if (mains.length < NUM_LEGS) {
      stats.push({ book: book.key, skipped: true, reason: "too_few_legs", legs: mains.length });
      continue;
    }

    const pool = sortLegsByEdge(mains).slice(0, legCap);
    const found = findMain3LegHits(pool, { boostPct, stake, minEvPct, maxResults: candidateCap });
    comboCount += found.comboCount;

    for (const p of found.parlays) {
      considerTop(globalTop, {
        ...p,
        bookKey: book.key,
        bookLabel: book.label || bookLabel(book.key),
        fingerprint: parlayFingerprint(book.key, p.legs),
      }, candidateCap);
    }

    stats.push({
      book: book.key,
      legs: pool.length,
      comboCount: found.comboCount,
      elapsedMs: found.elapsedMs,
      hits: found.parlays.length,
    });
  }

  return {
    parlays: globalTop,
    stats,
    comboCount,
    elapsedMs: Date.now() - t0,
    timedOut,
  };
}

function selectNewAlerts(parlays, existingByFingerprint, opts = {}) {
  const alertMax = opts.alertMax ?? ALERT_MAX;
  const nowMs = opts.nowMs ?? Date.now();
  const out = [];
  for (const p of parlays) {
    if (out.length >= alertMax) break;
    if (shouldRealert(existingByFingerprint[p.fingerprint], p.evPct, { nowMs })) {
      out.push(p);
    }
  }
  return out;
}

function formatET(commence_time) {
  if (!commence_time) return "";
  return new Date(commence_time).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

function formatParlayBlock(hit, stake = STAKE) {
  const trueAm = probToAmerican(hit.combinedProb);
  const evStr = hit.ev >= 0 ? `+$${hit.ev.toFixed(2)}` : `-$${Math.abs(hit.ev).toFixed(2)}`;
  const pctStr = `${hit.evPct.toFixed(1)}%`;
  const book = hit.bookLabel || bookLabel(hit.bookKey);
  const legLines = (hit.legs || []).map(l => {
    const when = formatET(l.commence_time);
    return when ? `${l.name}\n  ${when}` : l.name;
  });
  return [
    `+EV 3-leg (0% boost, $${stake} ${book})`,
    `EV ${evStr} (${pctStr})`,
    ...legLines,
    `${book} parlay ${formatOdds(hit.parlayOdds)} · True ${formatOdds(trueAm)}`,
  ].join("\n");
}

function formatAlertMessage(parlays, stake = STAKE) {
  const blocks = (parlays || []).map(p => formatParlayBlock(p, stake));
  return `${blocks.join("\n\n")}\n\n${SITE_URL}`;
}

module.exports = {
  STAKE,
  BOOST_PCT,
  NUM_LEGS,
  MIN_EV_PCT,
  SCAN_LEG_CAP,
  GLOBAL_CANDIDATE_CAP,
  ALERT_MAX,
  DEDUP_WINDOW_MS,
  EV_JUMP_PCT,
  SITE_URL,
  TIME_BUDGET_MS,
  parlayFingerprint,
  shouldRealert,
  considerTop,
  findMain3LegHits,
  scanBooksForEvParlays,
  selectNewAlerts,
  formatET,
  formatParlayBlock,
  formatAlertMessage,
  KEVIN_EV_ALERT_CHAT_ID,
  mergeEvAlertChatIds,
};
