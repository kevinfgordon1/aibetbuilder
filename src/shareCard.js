// Shareable pick IDs, clipboard helpers, and client-side PNG cards.
// IDs are derived from legs + book + stake (promo) or book + bet identity (+EV).
// No odds fetches — callers pass already-scanned card data only.

import { serializeAppHash } from "./comboAccess.js";
import { DEFAULT_PROFILE_BOOK } from "./userProfile.js";
import { formatPromoLegTitle } from "./soccerPairing.js";

const PROMO_TYPES = new Set(["boost", "nopromo", "nosweat", "freebet"]);

/** Default Promo type when the hash has no share/deep-link cardId. */
export const DEFAULT_PROMO_TYPE = "boost";

export function fnv1a36(str) {
  let h = 2166136261;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function legIdentityKey(leg) {
  if (!leg) return "";
  return [leg.game || "", leg.name || "", leg.market || "", leg.commence_time || ""].join("\0");
}

export function promoLegsKey(legs) {
  return (legs || []).map(legIdentityKey).sort().join("\n");
}

export function encodePromoCardId({ promoType = "boost", book = "draftkings", stake = 100, legs = [] } = {}) {
  const type = PROMO_TYPES.has(promoType) ? promoType : "boost";
  const bk = String(book || "draftkings").replace(/[^a-z0-9_]/gi, "") || "draftkings";
  const st = Math.round(Number(stake) || 0);
  return [type, bk, String(st), fnv1a36(promoLegsKey(legs))].join(".");
}

export function decodePromoCardId(cardId) {
  const raw = String(cardId == null ? "" : cardId).trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 4) return null;
  const hash = parts.pop();
  const stakePart = parts.pop();
  const book = parts.pop();
  const promoType = parts.join(".");
  if (!PROMO_TYPES.has(promoType) || !book || !hash) return null;
  const stake = Number(stakePart);
  if (!Number.isFinite(stake)) return null;
  return { promoType, book, stake, hash };
}

/**
 * Expanding/collapsing a Promo or +EV pick is view-only. Do not persist that
 * pick's cardId in the URL — a refresh would decode it and override Profile
 * promoBook / the default promo type. Share / deep-link cardIds still live
 * in the hash when the user opens or copies a real share URL.
 */
export function persistPickFocusInHash() {
  return false;
}

/**
 * Which cardId belongs in the URL for Promo / +EV.
 * Real share/deep-link cardIds stay. In-app focus (Optimize!, expand) does
 * not — putting those in the hash made TOKEN_REFRESHED on tab-return re-read
 * the cardId and force the sportsbook back to the book baked into it.
 */
export function hashCardIdForTab({ tab, focusCardId, shareCardId } = {}) {
  if (tab !== "promo" && tab !== "ev") return null;
  if (shareCardId && focusCardId && shareCardId === focusCardId) return shareCardId;
  if (shareCardId && !focusCardId) return null;
  if (persistPickFocusInHash()) return focusCardId || null;
  return null;
}

/** Apply share promo prefs only the first time we see this cardId. */
export function shouldApplySharePromoPrefs(cardId, alreadyAppliedCardId) {
  if (!cardId) return false;
  return String(cardId) !== String(alreadyAppliedCardId || "");
}

/**
 * Hash cardId after a view-only expand/collapse.
 * Never introduces a sticky cardId. Leaves an existing share-link cardId alone.
 */
export function hashCardIdAfterPickViewToggle({
  nextExpanded,
  incomingCardId,
  existingHashCardId,
} = {}) {
  if (persistPickFocusInHash()) {
    return nextExpanded ? (incomingCardId || null) : null;
  }
  return existingHashCardId || null;
}

/**
 * Promo prefs implied by a parsed route + Profile defaults.
 * A share/deep-link cardId wins (type, book, stake). A plain #promo (no
 * cardId) keeps Profile promoBook and DEFAULT_PROMO_TYPE.
 */
export function promoPrefsFromRoute(route, profilePrefs = {}) {
  const cardId = route && route.cardId;
  const decoded = cardId ? decodePromoCardId(cardId) : null;
  if (decoded) {
    return {
      source: "share",
      promoType: decoded.promoType,
      promoBook: decoded.book,
      stake: decoded.stake,
      focusCardId: cardId,
    };
  }
  return {
    source: "profile",
    promoType: DEFAULT_PROMO_TYPE,
    promoBook: profilePrefs.promoBook || DEFAULT_PROFILE_BOOK,
    stake: null,
    focusCardId: null,
  };
}

export function encodeEvCardId(bet = {}) {
  const book = String(bet.bookKey || bet.book || "book").replace(/[^a-z0-9_]/gi, "") || "book";
  const key = [bet.name || "", bet.market || "", bet.game || "", bet.commence_time || ""].join("\0");
  return book + "." + fnv1a36(key);
}

export function sharePath({ tab, lockId = null, cardId = null } = {}) {
  const hash = serializeAppHash({ tab, lockId, cardId });
  const path = hash.replace(/^#/, "");
  if (!path) return "/s/promo";
  return "/s/" + path;
}

export function absoluteShareUrl({ origin, tab, lockId = null, cardId = null } = {}) {
  const base = String(origin || "").replace(/\/$/, "");
  return base + sharePath({ tab, lockId, cardId });
}

export function shareCardFilename(model = {}) {
  const kind = model.kind === "ev" ? "ev" : "promo";
  const badge = (model.badge || "pick").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `aibetbuilder-${kind}-${badge || "pick"}.png`;
}

export const SHARE_MARKET_LABELS = {
  ML: "Moneyline",
  SPR: "Spread",
  TOT: "Total",
  TT: "Team Total",
  TD: "Touchdown scorer",
  HR: "Home run",
  GOAL: "Goal scorer",
};

const ET_SHARE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Sun, Oct 12, 1:00 PM ET" — empty when the time is missing/invalid. */
export function formatShareTimeET(commenceTime) {
  if (commenceTime == null || commenceTime === "") return "";
  const ms = new Date(commenceTime).getTime();
  if (!Number.isFinite(ms)) return "";
  return ET_SHARE_TIME.format(ms) + " ET";
}

export const SHARE_PROMO_TYPE_LABELS = {
  boost: "Profit Boost",
  nopromo: "No Promo",
  nosweat: "No Sweat",
  freebet: "Free Bet",
};

// Share image: 1080px wide portrait card (reads as a phone screenshot or a
// social post). Height grows with the number of legs; rows shrink as legs
// are added so 10 legs still fit. Anything past SHARE_MAX_LEGS collapses
// into a "+N more legs" row.
const SHARE_WIDTH = 1080;
const SHARE_MIN_HEIGHT = 1080;
const SHARE_PAD = 64;
const SHARE_MAX_LEGS = 10;

function finiteNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatSignedMoney(n) {
  const v = finiteNum(n);
  if (v == null) return "";
  const body = "$" + Math.abs(v).toFixed(2);
  if (v > 0) return "+" + body;
  if (v < 0) return "-" + body;
  return body;
}

function formatSignedPct(n) {
  const v = finiteNum(n);
  if (v == null) return "";
  const body = Math.abs(v).toFixed(1) + "%";
  if (v > 0) return "+" + body;
  if (v < 0) return "-" + body;
  return body;
}

export function formatShareAmerican(odds) {
  if (odds == null || odds === "") return "";
  if (typeof odds === "string" && /[+\-]\d/.test(odds.trim())) return String(odds).trim();
  const n = finiteNum(typeof odds === "string" ? String(odds).replace(/^\+/, "") : odds);
  if (n == null || n === 0) return "";
  return n > 0 ? "+" + n : String(n);
}

export function formatShareMarket(market) {
  if (market == null || market === "") return "";
  const raw = String(market).trim();
  const mapped = SHARE_MARKET_LABELS[raw.toUpperCase()];
  if (mapped) return mapped;
  if (/^moneyline$/i.test(raw)) return "Moneyline";
  if (/^spread$/i.test(raw)) return "Spread";
  if (/^totals?$/i.test(raw)) return "Total";
  if (/^team\s*totals?$/i.test(raw)) return "Team Total";
  return raw;
}

export function formatSharePromoType(promoType) {
  return SHARE_PROMO_TYPE_LABELS[promoType] || "";
}

// Selections from the app can end in a market code ("Seattle Seahawks ML").
// The sub line already says "Moneyline", so drop the code from the title.
export function plainShareLegName(name) {
  return String(name || "")
    .replace(/\s+(ML|SPR|TOT|TT)(?=\s+-\s+3 way market$)/i, "")
    .replace(/\s+(ML|SPR|TOT|TT)$/i, "")
    .trim();
}

export function formatShareLeg(leg) {
  if (leg == null) return null;
  if (typeof leg === "string") {
    const name = leg.trim();
    return name ? { name, market: "", game: "", odds: "", time: "" } : null;
  }
  const name = plainShareLegName(formatPromoLegTitle(leg) || String(leg.name || leg.label || "").trim());
  const market = formatShareMarket(leg.market);
  const game = String(leg.game || "").trim();
  const odds = formatShareAmerican(leg.odds != null ? leg.odds : leg.dk);
  const time = formatShareTimeET(leg.commence_time || leg.commenceTime);
  if (!name && !market && !game) return null;
  return { name: name || "Leg", market, game, odds, time };
}

export function shareCardPromoRule(model = {}) {
  const type = model.promoType;
  if (type === "nopromo") return "No Promo";
  if (type === "boost") {
    const pct = finiteNum(model.boostPct);
    return pct == null ? "Profit Boost" : pct + "% Profit Boost";
  }
  if (type === "nosweat") {
    const refundPct = finiteNum(model.refundPct);
    const conv = finiteNum(model.creditConversionPct);
    const parts = [];
    if (refundPct != null) parts.push(refundPct + "% refund");
    if (conv != null) parts.push("credit as " + conv + "% cash");
    return parts.length ? "No Sweat · " + parts.join(" · ") : "No Sweat";
  }
  if (type === "freebet") return "Free Bet";
  return "";
}

export function shareCardHeadline(model = {}) {
  if (model.kind === "ev") return model.title || "Plus EV";
  if (model.promoType === "nopromo") return "No Promo";
  if (model.promoType === "boost") return model.promoRule || model.promoLabel || "Profit Boost";
  return model.promoLabel || "Promo";
}

export function shareCardSubline(model = {}) {
  if (model.kind === "ev" || model.promoType === "boost" || model.promoType === "nopromo" || model.promoType === "freebet") return "";
  if (model.promoType === "nosweat") {
    return String(model.promoRule || "").replace(/^No Sweat(?: · )?/, "");
  }
  return "";
}

export function shareCardBottomLine(model = {}) {
  const ev = model.evText || "";
  const stake = finiteNum(model.stake);
  const stakeBit = stake != null ? " on a $" + Math.round(stake) + (model.promoType === "freebet" ? " free bet" : " stake") : "";
  if (model.kind === "ev") {
    if (model.edge != null && model.edge > 0) return "Book is underpricing this." + (ev ? " Expected profit " + ev + " per $100." : "");
    return ev ? ev + " per $100 stake." : "";
  }
  if (model.promoType === "nosweat") {
    const bits = [];
    if (ev) bits.push("Expected profit " + ev + stakeBit);
    const refund = finiteNum(model.refund);
    const credit = finiteNum(model.creditValue);
    if (refund != null && credit != null) {
      bits.push("If it loses: $" + Math.round(refund) + " credit ≈ $" + Math.round(credit) + " cash");
    }
    return bits.join(". ");
  }
  if (model.promoType === "freebet") {
    const cash = finiteNum(model.guaranteedCash);
    if (cash != null) return "Walk away with $" + cash.toFixed(2) + " guaranteed from the free bet.";
    return ev ? "Expected profit " + ev + stakeBit + "." : "";
  }
  if (model.promoType === "boost" || model.promoType === "nopromo") {
    return ev ? "Expected profit " + ev + stakeBit + "." : "";
  }
  return ev ? ev : "";
}

export function shareCardMetaChips(model = {}) {
  const m = model || {};
  const chips = [];
  if (m.bookLabel) chips.push(m.bookLabel);
  const n = (m.legsCount != null ? m.legsCount : (m.legs || []).length) || 0;
  if (m.kind !== "ev" && n > 0) chips.push(n === 1 ? "1 leg" : n + " legs");
  const stake = finiteNum(m.stake);
  if (stake != null) {
    if (m.promoType === "freebet") chips.push("$" + Math.round(stake) + " free bet");
    else chips.push("$" + Math.round(stake) + " stake");
  }
  if (m.promoType === "boost" && m.odds) chips.push(m.odds + " w/ boost");
  else if (m.odds) chips.push(m.odds);
  if (m.promoType === "boost" && m.parlayOdds && m.parlayOdds !== m.odds) {
    chips.push((n === 1 ? "Book " : "Parlay ") + m.parlayOdds);
  }
  if (m.promoType === "nosweat") {
    const refund = finiteNum(m.refund);
    const credit = finiteNum(m.creditValue);
    if (refund != null && credit != null) {
      chips.push("loss → $" + Math.round(refund) + " credit ≈ $" + Math.round(credit));
    } else if (refund != null) {
      chips.push("loss → $" + Math.round(refund) + " credit");
    }
  }
  if (m.promoType === "freebet") {
    const conv = finiteNum(m.conversionRate);
    const cash = finiteNum(m.guaranteedCash);
    if (cash != null) chips.push("$" + cash.toFixed(2) + " locked");
    if (conv != null) chips.push((conv * 100).toFixed(1) + "% conversion");
    else if (finiteNum(m.winProfit) != null) chips.push("win +$" + Math.round(m.winProfit));
  }
  if (m.kind === "ev" && m.marketLabel) chips.push(m.marketLabel);
  return chips.filter(Boolean);
}

function parseAmerican(odds) {
  const n = finiteNum(typeof odds === "string" ? odds.replace(/^\+/, "") : odds);
  return n == null || n === 0 ? null : n;
}

function americanToDecimal(odds) {
  const n = parseAmerican(odds);
  if (n == null) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function wholeOrCents(n) {
  const v = finiteNum(n);
  if (v == null) return "";
  const abs = Math.abs(v);
  const body = Math.abs(abs - Math.round(abs)) < 0.005
    ? Math.round(abs).toLocaleString("en-US")
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + body;
}

/** Cash returned if the promo bet wins. Free-bet stake is not returned. */
export function shareCardPayout(model = {}) {
  const m = model || {};
  if (finiteNum(m.payout) != null) return finiteNum(m.payout);
  const stake = finiteNum(m.stake);
  const win = finiteNum(m.winProfit);
  if (m.promoType === "freebet") {
    if (win != null) return win;
    const d = americanToDecimal(m.odds);
    return stake != null && d ? stake * (d - 1) : null;
  }
  if (stake != null && win != null) return stake + win;
  const d = americanToDecimal(m.odds);
  return stake != null && d ? stake * d : null;
}

/** Big result line + the smaller line under it. */
export function shareCardResult(model = {}) {
  const m = model || {};
  const stake = finiteNum(m.stake);
  const stakeTxt = stake != null ? "$" + Math.round(stake) : "";
  const cash = finiteNum(m.guaranteedCash);
  if (m.promoType === "freebet" && cash != null && m.hedge) {
    const conv = finiteNum(m.conversionRate);
    return {
      headline: wholeOrCents(cash) + " guaranteed",
      sub: (stakeTxt ? "from a " + stakeTxt + " free bet" : "from a free bet") + (conv != null ? " · " + (conv * 100).toFixed(0) + "% converted to cash" : ""),
      positive: true,
    };
  }
  const ev = finiteNum(m.ev);
  const positive = ev == null || ev >= 0;
  const headline = ev == null ? (m.title || "Top pick") : formatSignedMoney(ev) + " EV";
  let sub;
  if (m.kind === "ev") sub = "expected profit per $100 bet";
  else if (m.promoType === "freebet") sub = "expected profit on a " + (stakeTxt || "") + " free bet";
  else if (m.promoType === "nosweat") sub = "expected profit on a " + (stakeTxt || "") + " no-sweat bet";
  else sub = "expected profit on a " + (stakeTxt || "") + " bet";
  return { headline, sub: sub.replace(/ {2,}/g, " "), positive };
}

/** "DraftKings · 30% Profit Boost · $100" */
export function shareCardPromoLine(model = {}) {
  const m = model || {};
  const stake = finiteNum(m.stake);
  const stakeTxt = stake != null ? "$" + Math.round(stake) : "";
  const parts = [m.bookLabel];
  if (m.kind === "ev") {
    parts.push(m.marketLabel, m.odds);
  } else if (m.promoType === "boost") {
    parts.push(m.promoRule || "Profit Boost", stakeTxt);
  } else if (m.promoType === "nopromo") {
    parts.push("No promo", stakeTxt ? stakeTxt + " bet" : "");
  } else if (m.promoType === "freebet") {
    parts.push(stakeTxt ? stakeTxt + " Free Bet" : "Free Bet");
  } else if (m.promoType === "nosweat") {
    const refundPct = finiteNum(m.refundPct);
    parts.push("No Sweat", stakeTxt, refundPct != null ? refundPct + "% back as credit if it loses" : "");
  }
  return parts.filter(Boolean).join(" · ");
}

/** Stat tiles under the legs (label / value / optional note). */
export function shareCardStats(model = {}) {
  const m = model || {};
  const stake = finiteNum(m.stake);
  const stakeTxt = stake != null ? wholeOrCents(stake) : "—";
  if (m.kind === "ev") {
    return [
      { k: "True chance", v: m.trueProb != null ? (m.trueProb * 100).toFixed(1) + "%" : "—" },
      { k: "Book implies", v: m.implied != null ? (m.implied * 100).toFixed(1) + "%" : "—" },
      { k: "Your edge", v: formatSignedPct(m.edge != null ? m.edge * 100 : null) || "—", good: (m.edge || 0) >= 0 },
    ];
  }
  const payout = shareCardPayout(m);
  const n = (m.legs || []).length;
  const oddsLabel = n > 1 ? "Parlay odds" : "Odds";
  const tiles = [];
  if (m.promoType === "boost" && m.parlayOdds && m.odds && m.parlayOdds !== m.odds) {
    tiles.push({ k: oddsLabel, v: m.parlayOdds + " → " + m.odds, note: "with boost" });
  } else {
    tiles.push({ k: oddsLabel, v: m.odds || m.parlayOdds || "—" });
  }
  if (m.promoType === "freebet") {
    tiles.push({ k: "Free bet", v: stakeTxt });
    tiles.push({ k: "Wins", v: payout != null ? wholeOrCents(payout) : "—", note: "stake not returned", good: true });
  } else {
    tiles.push({ k: "Bet", v: stakeTxt });
    tiles.push({ k: "Pays", v: payout != null ? wholeOrCents(payout) : "—", good: true });
  }
  return tiles;
}

function shareRowSpec(n) {
  if (n <= 3) return { h: 132, title: 36, sub: 23 };
  if (n <= 5) return { h: 116, title: 33, sub: 22 };
  if (n <= 7) return { h: 100, title: 30, sub: 21 };
  return { h: 88, title: 27, sub: 19 };
}

/** Vertical layout shared by shareCardDimensions and paintShareCard. */
export function shareCardLayout(model = {}) {
  const m = model || {};
  const total = (m.legs || []).length;
  const steps = m.promoType === "freebet" && m.hedge && total === 1;
  const shown = steps ? 1 : Math.min(SHARE_MAX_LEGS, total);
  const more = steps ? 0 : Math.max(0, total - shown);
  const row = shareRowSpec(shown);
  const L = {};
  let y = SHARE_PAD;
  L.header = y; y += 64 + 44;            // logo row
  L.badge = y; y += 44 + 34;             // pill
  L.headline = y; y += 92;               // big result
  L.sub = y; y += 44 + 26;
  L.promo = y; y += 64 + 44;             // promo pill
  if (steps) {
    L.step1 = y; y += 236 + 20;
    L.step2 = y; y += 236 + 24;
    L.keep = y; y += 96;
  } else {
    L.listLabel = y; y += 40;
    L.list = y; y += shown * row.h + (more ? 64 : 0);
    y += 28;
    L.stats = y; y += 132;
  }
  y += 40;
  const contentEnd = y;
  const height = Math.max(SHARE_MIN_HEIGHT, contentEnd + 104);
  L.footer = height - 104;
  return { width: SHARE_WIDTH, height, shown, more, steps, row, L };
}

export function shareCardDimensions(model = {}) {
  const { width, height, shown, more } = shareCardLayout(model);
  return { width, height, shown, more };
}

export function buildShareCardModel({
  kind = "promo",
  badge = "BEST PICK",
  bookLabel = "",
  ev = null,
  evPct = null,
  odds = "",
  parlayOdds = "",
  stake = null,
  legs = [],
  title = "",
  subtitle = "",
  promoType = null,
  boostPct = null,
  refundPct = null,
  creditConversionPct = null,
  refund = null,
  creditValue = null,
  winProfit = null,
  conversionRate = null,
  guaranteedCash = null,
  trueProb = null,
  implied = null,
  edge = null,
  market = "",
  payout = null,
  hedge = null,
} = {}) {
  const evNum = finiteNum(ev);
  const stakeNum = finiteNum(stake);
  let pct = finiteNum(evPct);
  if (pct == null && evNum != null && stakeNum && stakeNum !== 0) pct = (evNum / stakeNum) * 100;
  if (pct == null && evNum != null && kind === "ev") pct = evNum;
  const evText = evNum == null ? "" : formatSignedMoney(evNum) + " EV";
  const formattedLegs = (legs || []).map(formatShareLeg).filter(Boolean);
  const type = PROMO_TYPES.has(promoType) ? promoType : null;
  const marketLabel = formatShareMarket(market) || (formattedLegs[0] && formattedLegs[0].market) || "";
  return {
    kind: kind === "ev" ? "ev" : "promo",
    badge: String(badge || "PICK"),
    promoType: type,
    promoLabel: formatSharePromoType(type),
    promoRule: shareCardPromoRule({
      promoType: type,
      boostPct,
      refundPct,
      creditConversionPct,
    }),
    bookLabel: String(bookLabel || ""),
    ev: evNum,
    evPct: pct,
    evText,
    evPctText: formatSignedPct(pct),
    odds: String(odds || ""),
    parlayOdds: String(parlayOdds || ""),
    stake: stakeNum,
    boostPct: finiteNum(boostPct),
    refundPct: finiteNum(refundPct),
    creditConversionPct: finiteNum(creditConversionPct),
    refund: finiteNum(refund),
    creditValue: finiteNum(creditValue),
    winProfit: finiteNum(winProfit),
    conversionRate: finiteNum(conversionRate),
    guaranteedCash: finiteNum(guaranteedCash),
    trueProb: finiteNum(trueProb),
    implied: finiteNum(implied),
    edge: finiteNum(edge),
    marketLabel,
    legs: formattedLegs,
    legsCount: formattedLegs.length,
    title: String(title || ""),
    subtitle: String(subtitle || ""),
    payout: finiteNum(payout),
    hedge: hedge && finiteNum(hedge.stake) != null ? {
      stake: finiteNum(hedge.stake),
      bookLabel: String(hedge.bookLabel || ""),
      odds: formatShareAmerican(hedge.odds),
      selection: plainShareLegName(hedge.selection),
      payout: finiteNum(hedge.payout),
    } : null,
    brand: "AI Bet Builder",
    footer: "aibetbuilder.io",
  };
}

function sans(weight, size) {
  return weight + " " + size + "px 'DM Sans', system-ui, sans-serif";
}

function mono(weight, size) {
  return weight + " " + size + "px 'JetBrains Mono', ui-monospace, monospace";
}

function accentFor(model) {
  if (model.kind === "ev") return { fill: "#10b981", soft: "rgba(16,185,129,0.16)", border: "rgba(16,185,129,0.28)" };
  if (model.promoType === "freebet" || model.promoType === "nosweat") {
    return { fill: "#8b5cf6", soft: "rgba(139,92,246,0.16)", border: "rgba(139,92,246,0.30)" };
  }
  return { fill: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.28)" };
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill) {
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRound(ctx, x, y, w, h, r, stroke, lineWidth) {
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth || 1;
  ctx.stroke();
}

function fitText(ctx, text, maxWidth) {
  const t = String(text == null ? "" : text);
  if (!t) return "";
  if (ctx.measureText(t).width <= maxWidth) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = t.slice(0, mid) + "…";
    if (ctx.measureText(s).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "…" : t.slice(0, lo) + "…";
}

function drawChip(ctx, x, y, label, opts = {}) {
  const padX = 12;
  const h = opts.h || 30;
  ctx.font = opts.font || sans("600", 13);
  const text = String(label);
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  fillRound(ctx, x, y, w, h, 8, opts.bg || "rgba(255,255,255,0.06)");
  strokeRound(ctx, x, y, w, h, 8, opts.border || "rgba(255,255,255,0.10)", 1);
  ctx.fillStyle = opts.color || "#d1d5db";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2 + 0.5);
  ctx.textBaseline = "alphabetic";
  return w;
}

// Shrink the font (down to minSize) before truncating with an ellipsis.
function fitFont(ctx, text, maxWidth, fontFn, weight, size, minSize) {
  const t = String(text == null ? "" : text);
  let px = size;
  ctx.font = fontFn(weight, px);
  while (px > minSize && ctx.measureText(t).width > maxWidth) {
    px -= 1;
    ctx.font = fontFn(weight, px);
  }
  return fitText(ctx, t, maxWidth);
}

function drawLogo(ctx, x, y, size) {
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, "#3b82f6");
  g.addColorStop(1, "#8b5cf6");
  fillRound(ctx, x, y, size, size, size * 0.24, g);
  ctx.fillStyle = "#ffffff";
  ctx.font = sans("800", Math.round(size * 0.6));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", x + size / 2, y + size / 2 + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function legSubline(leg) {
  return [leg.market, leg.game, leg.time].filter(Boolean).join(" · ");
}

function oddsColor(odds) {
  return String(odds || "").startsWith("+") ? "#34d399" : "#f3f4f6";
}

export function paintShareCard(ctx, model, w, h) {
  const m = model || {};
  const layout = shareCardLayout(m);
  const L = layout.L;
  const W = w || layout.width;
  const H = h || layout.height;
  const accent = accentFor(m);
  const PAD = SHARE_PAD;
  const inner = W - PAD * 2;
  const result = shareCardResult(m);
  const good = "#34d399";
  const bad = "#f87171";

  // Background: site dark + soft blue/purple glow.
  ctx.fillStyle = "#0a0b0f";
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, "rgba(59,130,246,0.20)");
  wash.addColorStop(0.45, "rgba(10,11,15,0)");
  wash.addColorStop(1, "rgba(139,92,246,0.20)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Header: logo + wordmark, URL on the right.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  drawLogo(ctx, PAD, L.header, 64);
  ctx.fillStyle = "#f3f4f6";
  ctx.font = sans("700", 34);
  ctx.fillText(m.brand || "AI Bet Builder", PAD + 84, L.header + 44);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9ca3af";
  ctx.font = sans("600", 26);
  ctx.fillText(m.footer || "aibetbuilder.io", W - PAD, L.header + 42);
  ctx.textAlign = "left";

  // Badge pill.
  const badge = String(m.badge || "PICK").toUpperCase();
  ctx.font = sans("800", 20);
  const bw = Math.ceil(ctx.measureText(badge).width) + 36;
  fillRound(ctx, PAD, L.badge, bw, 44, 22, accent.soft);
  strokeRound(ctx, PAD, L.badge, bw, 44, 22, accent.border, 1.5);
  ctx.fillStyle = m.kind === "ev" ? good : (m.promoType === "freebet" || m.promoType === "nosweat") ? "#c4b5fd" : "#93c5fd";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, PAD + 18, L.badge + 23);
  ctx.textBaseline = "alphabetic";

  // Result headline.
  ctx.fillStyle = result.positive ? good : bad;
  const headline = fitFont(ctx, result.headline, inner, sans, "800", 88, 52);
  ctx.fillText(headline, PAD, L.headline + 80);
  ctx.fillStyle = "#d1d5db";
  ctx.fillText(fitFont(ctx, result.sub, inner, sans, "500", 32, 22), PAD, L.sub + 36);

  // Book · promo · stake.
  const promoLine = shareCardPromoLine(m);
  if (promoLine) {
    fillRound(ctx, PAD, L.promo, inner, 64, 14, "rgba(255,255,255,0.05)");
    strokeRound(ctx, PAD, L.promo, inner, 64, 14, "rgba(255,255,255,0.10)", 1);
    ctx.fillStyle = "#f3f4f6";
    ctx.textBaseline = "middle";
    ctx.fillText(fitFont(ctx, promoLine, inner - 48, sans, "700", 28, 20), PAD + 24, L.promo + 33);
    ctx.textBaseline = "alphabetic";
  }

  if (layout.steps) {
    const leg = (m.legs || [])[0] || {};
    const hedge = m.hedge || {};
    const stake = finiteNum(m.stake);
    const freeWins = shareCardPayout(m);
    const step = (y, opts) => {
      fillRound(ctx, PAD, y, inner, 236, 16, opts.bg);
      strokeRound(ctx, PAD, y, inner, 236, 16, opts.border, 1.5);
      const x = PAD + 28;
      const rightW = 230;
      const textW = inner - 56 - rightW - 16;
      ctx.fillStyle = opts.labelColor;
      ctx.fillText(fitFont(ctx, opts.label, inner - 56, sans, "800", 20, 15), x, y + 44);
      ctx.fillStyle = "#f9fafb";
      ctx.fillText(fitFont(ctx, opts.title, textW, sans, "700", 36, 24), x, y + 100);
      ctx.fillStyle = "#b4bac4";
      ctx.fillText(fitFont(ctx, opts.sub1, textW, sans, "500", 23, 17), x, y + 142);
      if (opts.sub2) {
        ctx.fillStyle = "#9ca3af";
        ctx.fillText(fitFont(ctx, opts.sub2, textW, sans, "500", 22, 17), x, y + 178);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = oddsColor(opts.odds);
      ctx.font = mono("700", 40);
      ctx.fillText(opts.odds || "", PAD + inner - 28, y + 100);
      ctx.fillStyle = "#f3f4f6";
      ctx.font = mono("700", 30);
      ctx.fillText(opts.amount, PAD + inner - 28, y + 150);
      ctx.fillStyle = "#9ca3af";
      ctx.font = sans("600", 21);
      ctx.fillText(opts.amountNote, PAD + inner - 28, y + 184);
      ctx.textAlign = "left";
    };
    step(L.step1, {
      bg: "rgba(139,92,246,0.10)",
      border: "rgba(139,92,246,0.40)",
      labelColor: "#c4b5fd",
      label: "STEP 1 · USE YOUR " + (stake != null ? "$" + Math.round(stake) + " " : "") + "FREE BET AT " + String(m.bookLabel || "YOUR BOOK").toUpperCase(),
      title: leg.name,
      sub1: [leg.market, leg.game].filter(Boolean).join(" · "),
      sub2: leg.time,
      odds: leg.odds,
      amount: stake != null ? wholeOrCents(stake) : "",
      amountNote: freeWins != null ? "wins " + wholeOrCents(freeWins) : "free bet",
    });
    step(L.step2, {
      bg: "rgba(16,185,129,0.09)",
      border: "rgba(16,185,129,0.38)",
      labelColor: "#6ee7b7",
      label: "STEP 2 · HEDGE " + wholeOrCents(hedge.stake) + " CASH AT " + String(hedge.bookLabel || "ANOTHER BOOK").toUpperCase(),
      title: hedge.selection || "Opposite side",
      sub1: [leg.game].filter(Boolean).join(" · "),
      sub2: "",
      odds: hedge.odds,
      amount: wholeOrCents(hedge.stake),
      amountNote: hedge.payout != null ? "pays " + wholeOrCents(hedge.payout) : "cash",
    });
    fillRound(ctx, PAD, L.keep, inner, 76, 14, "rgba(16,185,129,0.12)");
    ctx.fillStyle = "#d1fae5";
    ctx.textBaseline = "middle";
    const keep = "Either way, you keep " + wholeOrCents(m.guaranteedCash) + " in cash.";
    ctx.fillText(fitFont(ctx, keep, inner - 48, sans, "700", 30, 20), PAD + 24, L.keep + 39);
    ctx.textBaseline = "alphabetic";
  } else {
    const legs = (m.legs || []).slice(0, layout.shown);
    const n = (m.legs || []).length;
    const label = m.kind === "ev" ? "THE BET" : n > 1 ? n + "-LEG PARLAY" : "THE BET";
    ctx.fillStyle = "#9ca3af";
    ctx.font = sans("800", 20);
    ctx.fillText(label, PAD, L.listLabel + 22);

    const row = layout.row;
    const listH = legs.length * row.h + (layout.more ? 64 : 0);
    fillRound(ctx, PAD, L.list, inner, Math.max(row.h, listH), 16, "rgba(255,255,255,0.035)");
    strokeRound(ctx, PAD, L.list, inner, Math.max(row.h, listH), 16, "rgba(255,255,255,0.10)", 1);
    const oddsW = 170;
    const textW = inner - 56 - oddsW;
    legs.forEach((leg, i) => {
      const ry = L.list + i * row.h;
      if (i > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(PAD + 24, ry, inner - 48, 1);
      }
      const titleY = ry + row.h / 2 - row.sub * 0.25;
      ctx.fillStyle = "#f9fafb";
      ctx.fillText(fitFont(ctx, leg.name, textW, sans, "700", row.title, Math.max(18, row.title - 10)), PAD + 28, titleY);
      const sub = legSubline(leg);
      if (sub) {
        ctx.fillStyle = "#a1a7b3";
        ctx.fillText(fitFont(ctx, sub, textW, sans, "500", row.sub, Math.max(15, row.sub - 5)), PAD + 28, titleY + row.sub + 12);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = oddsColor(leg.odds);
      ctx.font = mono("700", row.title + 2);
      ctx.textBaseline = "middle";
      ctx.fillText(leg.odds || "—", PAD + inner - 28, ry + row.h / 2);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    });
    if (layout.more) {
      const my = L.list + legs.length * row.h;
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(PAD + 24, my, inner - 48, 1);
      ctx.fillStyle = "#93c5fd";
      ctx.font = sans("700", 22);
      ctx.textBaseline = "middle";
      ctx.fillText("+" + layout.more + " more " + (layout.more === 1 ? "leg" : "legs") + " on aibetbuilder.io", PAD + 28, my + 33);
      ctx.textBaseline = "alphabetic";
    }

    const tiles = shareCardStats(m);
    const gap = 16;
    const tw = (inner - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => {
      const tx = PAD + i * (tw + gap);
      fillRound(ctx, tx, L.stats, tw, 124, 14, "rgba(255,255,255,0.045)");
      strokeRound(ctx, tx, L.stats, tw, 124, 14, "rgba(255,255,255,0.09)", 1);
      ctx.fillStyle = "#9ca3af";
      ctx.fillText(fitFont(ctx, t.k.toUpperCase(), tw - 40, sans, "700", 19, 14), tx + 20, L.stats + 38);
      ctx.fillStyle = t.good ? good : "#f3f4f6";
      ctx.fillText(fitFont(ctx, t.v, tw - 40, mono, "700", 34, 20), tx + 20, L.stats + 84);
      if (t.note) {
        ctx.fillStyle = "#9ca3af";
        ctx.fillText(fitFont(ctx, t.note, tw - 40, sans, "500", 18, 13), tx + 20, L.stats + 110);
      }
    });
  }

  // Footer.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(PAD, L.footer, inner, 1);
  ctx.fillStyle = "#9ca3af";
  ctx.font = sans("600", 21);
  ctx.fillText("21+ · Gambling problem? Call 1-800-GAMBLER", PAD, L.footer + 58);
  ctx.textAlign = "right";
  ctx.fillStyle = "#6b7280";
  ctx.font = sans("500", 19);
  ctx.fillText("Odds change. Check your book.", W - PAD, L.footer + 58);
  ctx.textAlign = "left";
}

export function renderShareCardCanvas(model, opts = {}) {
  if (typeof document === "undefined") return null;
  const dim = shareCardDimensions(model);
  const width = opts.width || dim.width;
  const height = opts.height || dim.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintShareCard(ctx, model, width, height);
  return canvas;
}

export function shareCardToBlob(model, opts) {
  const canvas = renderShareCardCanvas(model, opts);
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return "copied";
  }
  if (typeof document === "undefined") return "unavailable";
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok ? "copied" : "unavailable";
}

export async function downloadShareCardPng(model, filename) {
  const blob = await shareCardToBlob(model);
  if (!blob || typeof document === "undefined") return "unavailable";
  const name = filename || shareCardFilename(model);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}

export async function shareOrDownloadCard({ model, url, title } = {}) {
  const blob = model ? await shareCardToBlob(model) : null;
  const fileName = shareCardFilename(model || {});
  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
  const canFiles = typeof navigator !== "undefined" && navigator.canShare && file
    && navigator.canShare({ files: [file] });
  if (canFiles) {
    await navigator.share({
      files: [file],
      title: title || (model && model.badge) || "AI Bet Builder",
      text: (model && (model.evText || model.subtitle)) || "",
      url: url || undefined,
    });
    return "shared";
  }
  const canUrl = typeof navigator !== "undefined" && navigator.share && url;
  if (canUrl && !file) {
    await navigator.share({ title: title || "AI Bet Builder", url });
    return "shared";
  }
  if (model) return downloadShareCardPng(model, fileName);
  if (url) return copyTextToClipboard(url);
  return "unavailable";
}
