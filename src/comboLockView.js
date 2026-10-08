// Combo Locks presentation helpers: plain-English legs, status pills, money and
// ET dates, and History rows. Pure functions only (no React, no Supabase), so
// the page copy stays testable. American odds everywhere; never show raw
// Kalshi tickers or cent prices to the user.

import { sportFromTicker } from "./comboLegResult.js";
import { isLockPaused } from "./comboLockPause.js";
import { isFreeBetLock } from "./comboLockProfile.js";

export const ET_ZONE = "America/New_York";

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtAmerican(a) {
  const n = toNum(a);
  if (n == null || n === 0) return "—";
  const r = Math.round(n);
  return r > 0 ? "+" + r : String(r);
}

function decimalFromAmerican(a) {
  const n = toNum(a);
  if (n == null || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

export function americanFromProb(p) {
  if (!(p > 0 && p < 1)) return null;
  return p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p));
}

/**
 * We sell the parlay by buying NO. A NO price (dollars 0-1, or cents 1-99)
 * means the buyer of the parlay pays (1 - NO) for YES. Return those odds in
 * American so the page never shows "NO $0.92" or "92¢".
 */
export function americanFromNoPrice(no) {
  let n = toNum(no);
  if (n == null) return null;
  if (n > 1) n /= 100;
  return americanFromProb(1 - n);
}

/** "$1,025" for whole dollars, "$23.21" otherwise. */
export function dollars(v) {
  const n = toNum(v);
  if (n == null) return "—";
  const abs = Math.abs(n);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return (n < 0 ? "-$" : "$") + s;
}

/** "+$23.21" / "-$50.00" for P/L. */
export function signedDollars(v) {
  const n = toNum(v);
  if (n == null) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "+$") + s;
}

export function countText(n) {
  const v = toNum(n);
  return v == null ? "—" : Math.round(v).toLocaleString("en-US");
}

function validDate(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sun, Oct 12 · 1:00 PM ET" */
export function etDateTime(iso, { weekday = true } = {}) {
  const d = validDate(iso);
  if (!d) return "";
  const day = d.toLocaleDateString("en-US", { timeZone: ET_ZONE, ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: ET_ZONE, hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ET`;
}

/** "Oct 12" */
export function etDay(iso) {
  const d = validDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { timeZone: ET_ZONE, month: "short", day: "numeric" });
}

/** "Oct 7, 6:41 PM ET" — compact timestamp for activity tables. */
export function etStamp(iso) {
  const d = validDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-US", { timeZone: ET_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}

const SPORT_WORD = { mlb: "MLB", nfl: "NFL", ncaaf: "College football", nhl: "NHL", nba: "NBA", ncaab: "College basketball", wnba: "WNBA" };

export function lockSports(parlay) {
  const seen = [];
  for (const leg of (parlay && parlay.legs) || []) {
    const s = leg && (sportFromTicker(leg.ticker, leg.gameKey) || null);
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.map((s) => SPORT_WORD[s] || s.toUpperCase());
}

export const LEG_TYPE_WORD = { side: "Moneyline", spread: "Spread", total: "Total", prop: "Player prop" };

function propWord(ticker) {
  const t = String(ticker || "").toUpperCase();
  if (/KXMLBHR/.test(t)) return "to hit a home run";
  if (/TD/.test(t) && /KXNFL|KXNCAAF/.test(t)) return "anytime TD";
  if (/KXNHLGOAL/.test(t) || (/KXNHL/.test(t) && /GOAL/.test(t))) return "to score a goal";
  return "";
}

/** One leg in plain words. Never includes the Kalshi ticker. */
export function plainLeg(leg) {
  if (!leg) return { text: "", typeWord: "", game: "" };
  const label = String(leg.label || "").trim();
  const type = leg.type || "";
  let text = label;
  if (type === "side" && label && !/\bto win\b/i.test(label)) text = `${label} to win`;
  if (type === "prop") {
    const m = label.match(/^(.*?):\s*1\+\s*$/);
    const word = propWord(leg.ticker);
    if (m && word) text = `${m[1]} ${word}`;
    else if (m) text = `${m[1]} (1+)`;
  }
  return { text: text || "Leg", typeWord: LEG_TYPE_WORD[type] || "", game: String(leg.game || "") };
}

const FREE_BET_PREFIX = /^free bet\s*·\s*/i;

/** Card title: the legs in plain words unless Kevin typed his own label. */
export function lockTitle(parlay) {
  if (!parlay) return "Lock";
  const legs = (parlay.legs || []).filter(Boolean);
  const label = String(parlay.label || "").replace(FREE_BET_PREFIX, "").trim();
  const auto = legs.map((l) => String(l.label || "").trim()).join(" + ");
  if (legs.length && (!label || label === auto)) return legs.map((l) => plainLeg(l).text).join(" + ");
  return label || "Lock";
}

/**
 * One status per lock, with a color tone:
 *   Paused (you turned it off) · Filled (fully hedged) · Stopped (master switch)
 *   · Off (worker not watching) · Partly filled · Quoting.
 */
export function lockStatus({ parlay, filled = 0, ceiling = null, kill = false } = {}) {
  const f = Math.max(0, toNum(filled) || 0);
  const cap = toNum(ceiling != null ? ceiling : parlay && parlay.max_contracts);
  if (isLockPaused(parlay)) {
    return { key: "paused", label: "Paused", tone: "amber", hint: f > 0 ? "You paused this lock. What's already filled stays locked." : "You paused this lock. It isn't being offered. Turn it back on any time." };
  }
  if (cap > 0 && f >= cap) {
    return { key: "filled", label: "Filled", tone: "green", hint: "Fully hedged. Your profit is locked; now we wait for the games." };
  }
  if (kill) {
    return { key: "stopped", label: "Stopped", tone: "red", hint: "The master switch is on, so nothing is being offered." };
  }
  if (parlay && parlay.active === false) {
    return { key: "off", label: "Off", tone: "grey", hint: "Not being offered right now." };
  }
  if (f > 0) {
    return { key: "partial", label: "Partly filled", tone: "teal", hint: "Part of this parlay is hedged. Still looking for buyers for the rest." };
  }
  return { key: "quoting", label: "Quoting", tone: "blue", hint: "Looking for a buyer on Kalshi and Polymarket at your price." };
}

/** Your sportsbook bet in numbers: stake, odds, max payout. */
export function betSummary(parlay) {
  if (!parlay) return null;
  const stake = toNum(parlay.parlay_stake);
  const american = toNum(parlay.parlay_american);
  const dec = decimalFromAmerican(american);
  const freeBet = isFreeBetLock(parlay);
  const maxPayout = stake > 0 && dec ? (freeBet ? stake * (dec - 1) : stake * dec) : null;
  const boost = toNum(parlay.boost_pct);
  return {
    stake,
    american,
    odds: fmtAmerican(american),
    freeBet,
    maxPayout,
    sellAt: fmtAmerican(parlay.fill_american),
    book: String(parlay.sportsbook || "").trim(),
    boostPct: boost > 0 ? boost : null,
    betLine: stake > 0 && american ? `${freeBet ? "Free bet " : ""}${dollars(stake)} at ${fmtAmerican(american)}` : "—",
  };
}

/** "NFL · Sun, Oct 12 · 1:00 PM ET · DraftKings · 30% boost" */
export function lockMetaLine(parlay) {
  if (!parlay) return "";
  const s = betSummary(parlay);
  const bits = [lockSports(parlay).join(" + "), etDateTime(parlay.starts_at), s.book];
  if (s.freeBet) bits.push("free bet");
  else if (s.boostPct) bits.push(`${s.boostPct}% boost`);
  return bits.filter(Boolean).join(" · ");
}

/**
 * Plain profit line for a lock from comboLockProfile.lockProfile().
 * Returns { lead, text, tone }.
 */
export function profitLine(profile) {
  if (!profile || !profile.current) return null;
  const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
  const both = (p) => (close(p.hit, p.miss)
    ? `${signedDollars(p.hit)} either way`
    : `${signedDollars(p.hit)} if it hits · ${signedDollars(p.miss)} if it misses`);
  const full = profile.target && profile.remaining === 0;
  if (profile.filled > 0) {
    return {
      lead: full ? "Locked profit" : "Where you stand now",
      text: both(profile.current),
      tone: Math.min(profile.current.hit, profile.current.miss) >= 0 ? "pos" : "warn",
    };
  }
  if (profile.target) {
    return {
      lead: "If fully hedged",
      text: both(profile.target),
      tone: profile.target.locks ? "pos" : "warn",
    };
  }
  return { lead: "Not hedged yet", text: both(profile.current), tone: "muted" };
}

const ATTEMPT_WORDS = [
  [/\bover_limit\b/g, "too big for this lock"],
  [/\boversized\b/g, "too big for this lock"],
  [/\bgame_started\b/g, "game already started"],
  [/\bno_lock_overlap\w*/g, "price wouldn't lock profit"],
  [/\bno_lock\b/g, "price wouldn't lock profit"],
  [/\bkill_switch\b/g, "master switch on"],
  [/\bno_purchase\b/g, "buyer didn't take it"],
  [/\bno_taker\b/g, "buyer took no one"],
  [/\btoo_slow\b/g, "too slow"],
  [/\bunfilled\b/g, "not taken"],
  [/\barmed\b/g, "lock added"],
  [/\bRFQs?\b/g, (m) => (m === "RFQs" ? "requests" : "request")],
];

/** Turn worker codes in activity labels into plain words. */
export function plainAttemptLabel(label) {
  let s = String(label == null ? "" : label);
  for (const [re, word] of ATTEMPT_WORDS) s = s.replace(re, word);
  // Worker labels quote Kalshi NO prices in cents ("outbid at 92¢"). Show the
  // parlay odds that price implies instead.
  s = s.replace(/(\d+(?:\.\d+)?)¢/g, (m, c) => {
    const a = americanFromNoPrice(Number(c) / 100);
    return a == null ? m : fmtAmerican(a);
  });
  return s.replace(/_/g, " ");
}

/** "parlay lost (we won)" / "risk won" / "awaiting settlement" -> plain words. */
export function plainOutcomeText(text) {
  const t = String(text == null ? "" : text).toLowerCase();
  if (/^(parlay|risk) won\b|parlay won \(/.test(t)) return "Parlay hit";
  if (/^(parlay|risk) lost\b|parlay lost \(/.test(t)) return "Parlay missed";
  if (/push/.test(t)) return "Push";
  if (/awaiting/.test(t)) return "Waiting on Kalshi";
  if (/pending/.test(t)) return "Waiting on games";
  return text || "";
}

/** History result in plain words, from a comboStatement line. */
export function historyResult(line) {
  if (!line) return { text: "—", tone: "wait" };
  const side = line.side;
  const pnl = toNum(line.pnl);
  const tone = pnl == null ? "wait" : pnl > 0 ? "win" : pnl < 0 ? "lose" : "wait";
  if (line.settled && side === "hit") return { text: "Parlay hit", tone };
  if (line.settled && side === "miss") return { text: "Parlay missed", tone };
  if (line.settled && side === "push") return { text: "Push", tone: "wait" };
  if (line.resultKind === "awaiting") return { text: "Waiting on Kalshi", tone: "wait" };
  return { text: "Waiting on games", tone: "wait" };
}

export function historyTotals(lines) {
  const t = { net: 0, wins: 0, losses: 0, settled: 0, pending: 0, hedgedPnl: 0, hedgedN: 0, openPnl: 0, openN: 0 };
  for (const line of lines || []) {
    const pnl = toNum(line && line.pnl);
    if (!(line && line.settled) || pnl == null) { t.pending += 1; continue; }
    t.settled += 1;
    t.net += pnl;
    if (pnl > 0.004) t.wins += 1;
    else if (pnl < -0.004) t.losses += 1;
    if ((toNum(line.filled) || 0) > 0) { t.hedgedPnl += pnl; t.hedgedN += 1; } else { t.openPnl += pnl; t.openN += 1; }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  t.net = r2(t.net); t.hedgedPnl = r2(t.hedgedPnl); t.openPnl = r2(t.openPnl);
  return t;
}

/** One History row for a statement line plus its archived parlay row. */
export function historyRow(line, parlay) {
  const p = parlay || {};
  const s = betSummary(p) || {};
  const res = historyResult(line);
  const when = p.starts_at || (line && line.createdAt) || null;
  return {
    id: line && line.id,
    date: etDay(when),
    dateFull: etDateTime(when),
    title: parlay ? lockTitle(p) : (line && line.label) || "Lock",
    sports: parlay ? lockSports(p).join(" + ") : ((line && line.sportLabels) || []).join(" + "),
    bet: s.betLine || "—",
    book: s.book || "",
    soldAt: p.fill_american != null ? fmtAmerican(p.fill_american) : "—",
    hedged: ((line && line.filled) || 0) > 0,
    result: res.text,
    resultTone: res.tone,
    pnl: line ? line.pnl : null,
  };
}
