// Shareable pick IDs, clipboard helpers, and client-side PNG cards.
// IDs are derived from legs + book + stake (promo) or book + bet identity (+EV).
// No odds fetches — callers pass already-scanned card data only.

import { serializeAppHash } from "./comboAccess.js";

const PROMO_TYPES = new Set(["boost", "nosweat", "freebet"]);

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
};

export const SHARE_PROMO_TYPE_LABELS = {
  boost: "Profit Boost",
  nosweat: "No Sweat",
  freebet: "Free Bet",
};

const SHARE_MAX_LEGS = 6;
const SHARE_BASE_HEIGHT = 630;
const SHARE_MAX_HEIGHT = 800;
const SHARE_LEG_ROW = 54;

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

export function formatShareLeg(leg) {
  if (leg == null) return null;
  if (typeof leg === "string") {
    const name = leg.trim();
    return name ? { name, market: "", game: "", odds: "" } : null;
  }
  const name = String(leg.name || leg.label || "").trim();
  const market = formatShareMarket(leg.market);
  const game = String(leg.game || "").trim();
  const odds = formatShareAmerican(leg.odds != null ? leg.odds : leg.dk);
  if (!name && !market && !game) return null;
  return { name: name || "Leg", market, game, odds };
}

export function shareCardPromoRule(model = {}) {
  const type = model.promoType;
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
  if (model.promoType === "boost") return model.promoRule || model.promoLabel || "Profit Boost";
  return model.promoLabel || "Promo";
}

export function shareCardSubline(model = {}) {
  if (model.kind === "ev" || model.promoType === "boost" || model.promoType === "freebet") return "";
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
  if (model.promoType === "boost") {
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
    if (conv != null) chips.push((conv <= 1 ? conv * 100 : conv).toFixed(1) + "% conversion");
    else if (finiteNum(m.winProfit) != null) chips.push("win +$" + Math.round(m.winProfit));
  }
  if (m.kind === "ev" && m.marketLabel) chips.push(m.marketLabel);
  return chips.filter(Boolean);
}

export function shareCardDimensions(model = {}) {
  const total = (model.legs || []).length;
  const shown = Math.min(SHARE_MAX_LEGS, total);
  const moreRow = total > SHARE_MAX_LEGS ? 1 : 0;
  const extraRows = Math.max(0, shown - 3) + moreRow;
  const evStats = model.kind === "ev" && (model.trueProb != null || model.implied != null || model.edge != null) ? 1 : 0;
  const height = Math.min(
    SHARE_MAX_HEIGHT,
    SHARE_BASE_HEIGHT + extraRows * SHARE_LEG_ROW + evStats * 36,
  );
  return { width: 1200, height, shown, more: Math.max(0, total - shown) };
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

export function paintShareCard(ctx, model, w, h) {
  const m = model || {};
  const accent = accentFor(m);
  const evPositive = m.ev == null || m.ev >= 0;
  const evColor = evPositive ? "#10b981" : "#ef4444";

  ctx.fillStyle = "#0a0b0f";
  ctx.fillRect(0, 0, w, h);

  const wash = ctx.createLinearGradient(0, 0, w, h);
  wash.addColorStop(0, m.kind === "ev" ? "rgba(16,185,129,0.14)" : accent.soft);
  wash.addColorStop(0.55, "rgba(10,11,15,0)");
  wash.addColorStop(1, "rgba(139,92,246,0.10)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#e8eaed";
  ctx.font = sans("700", 22);
  ctx.fillText(m.brand || "AI Bet Builder", 36, 40);
  ctx.fillStyle = "#6b7280";
  ctx.font = sans("500", 15);
  ctx.textAlign = "right";
  ctx.fillText(m.footer || "aibetbuilder.io", w - 36, 40);
  ctx.textAlign = "left";

  const cardX = 28;
  const cardY = 56;
  const cardW = w - 56;
  const cardH = h - cardY - 20;
  fillRound(ctx, cardX, cardY, cardW, cardH, 16, "rgba(255,255,255,0.035)");
  strokeRound(ctx, cardX, cardY, cardW, cardH, 16, "rgba(255,255,255,0.10)", 1);
  ctx.fillStyle = accent.fill;
  ctx.fillRect(cardX, cardY + 16, 4, cardH - 32);

  const padL = cardX + 28;
  const padR = cardX + cardW - 24;
  const contentW = padR - padL;
  let y = cardY + 28;

  ctx.font = sans("800", 12);
  ctx.fillStyle = accent.fill;
  ctx.fillText(String(m.badge || "PICK").toUpperCase(), padL, y);

  const evBlockW = 280;
  ctx.textAlign = "right";
  ctx.fillStyle = evColor;
  ctx.font = mono("700", 40);
  const evMain = m.ev != null ? formatSignedMoney(m.ev) : (m.title || "");
  ctx.fillText(fitText(ctx, evMain, evBlockW), padR, y + 28);
  ctx.font = sans("600", 14);
  ctx.fillStyle = evPositive ? "rgba(16,185,129,0.85)" : "#ef4444";
  const evSub = [m.ev != null ? "EV" : "", m.evPctText].filter(Boolean).join("  ·  ");
  if (evSub) ctx.fillText(evSub, padR, y + 52);
  ctx.textAlign = "left";

  const typeLine = shareCardHeadline(m);
  const subline = shareCardSubline(m);
  ctx.fillStyle = "#e8eaed";
  ctx.font = sans("700", 26);
  ctx.fillText(fitText(ctx, typeLine, contentW - evBlockW - 16), padL, y + 36);
  if (subline) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = sans("600", 14);
    ctx.fillText(fitText(ctx, subline, contentW - evBlockW - 16), padL, y + 58);
  }

  y += subline ? 86 : 72;
  const chips = shareCardMetaChips(m);
  let cx = padL;
  const chipY = y;
  for (const chip of chips) {
    const used = drawChip(ctx, cx, chipY, chip);
    cx += used + 8;
    if (cx > padR - 80) break;
  }
  y += 46;

  if (m.kind === "ev" && (m.trueProb != null || m.implied != null || m.edge != null)) {
    const tiles = [
      { k: "True Prob", v: m.trueProb != null ? (m.trueProb * 100).toFixed(1) + "%" : "—", c: "#f59e0b" },
      { k: "Book Implied", v: m.implied != null ? (m.implied * 100).toFixed(1) + "%" : "—", c: "#e8eaed" },
      { k: "Edge", v: formatSignedPct(m.edge != null ? m.edge * 100 : null) || "—", c: (m.edge || 0) >= 0 ? "#10b981" : "#ef4444" },
    ];
    const gap = 10;
    const tw = (contentW - gap * 2) / 3;
    tiles.forEach((t, i) => {
      const tx = padL + i * (tw + gap);
      fillRound(ctx, tx, y, tw, 58, 10, "rgba(255,255,255,0.03)");
      strokeRound(ctx, tx, y, tw, 58, 10, "rgba(255,255,255,0.07)", 1);
      ctx.fillStyle = "#6b7280";
      ctx.font = sans("600", 11);
      ctx.fillText(t.k.toUpperCase(), tx + 12, y + 20);
      ctx.fillStyle = t.c;
      ctx.font = mono("700", 18);
      ctx.fillText(t.v, tx + 12, y + 44);
    });
    y += 72;
  }

  const dim = shareCardDimensions(m);
  const rows = (m.legs || []).slice(0, dim.shown);
  const tableH = cardY + cardH - y - 16;
  fillRound(ctx, padL, y, contentW, Math.max(48, tableH), 10, "rgba(0,0,0,0.22)");
  strokeRound(ctx, padL, y, contentW, Math.max(48, tableH), 10, "rgba(255,255,255,0.06)", 1);

  const colMarket = 150;
  const colOdds = 110;
  const nameW = contentW - colMarket - colOdds - 36;
  const headY = y + 22;
  ctx.font = sans("600", 11);
  ctx.fillStyle = "#6b7280";
  ctx.fillText("LEG", padL + 16, headY);
  ctx.textAlign = "center";
  ctx.fillText("MARKET", padL + 16 + nameW + colMarket / 2, headY);
  ctx.fillText("ODDS", padL + contentW - colOdds / 2 - 8, headY);
  ctx.textAlign = "left";

  let rowY = y + 34;
  const rowH = Math.min(SHARE_LEG_ROW, Math.max(44, (tableH - 36 - (dim.more ? 28 : 0)) / Math.max(1, rows.length)));
  rows.forEach((leg, i) => {
    const ry = rowY + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.02)";
      ctx.fillRect(padL + 1, ry, contentW - 2, rowH);
    }
    ctx.fillStyle = "#e8eaed";
    ctx.font = sans("600", 15);
    ctx.fillText(fitText(ctx, leg.name, nameW), padL + 16, ry + (leg.game ? 20 : rowH / 2 + 5));
    if (leg.game) {
      ctx.fillStyle = "#6b7280";
      ctx.font = sans("500", 12);
      ctx.fillText(fitText(ctx, leg.game, nameW), padL + 16, ry + 38);
    }
    ctx.textAlign = "center";
    const marketX = padL + 16 + nameW + colMarket / 2;
    if (leg.market) {
      ctx.font = sans("600", 12);
      const mw = Math.min(colMarket - 12, Math.ceil(ctx.measureText(leg.market).width) + 16);
      fillRound(ctx, marketX - mw / 2, ry + rowH / 2 - 12, mw, 24, 7, "rgba(255,255,255,0.06)");
      ctx.fillStyle = "#9ca3af";
      ctx.fillText(leg.market, marketX, ry + rowH / 2 + 5);
    } else {
      ctx.fillStyle = "#6b7280";
      ctx.font = sans("600", 13);
      ctx.fillText("—", marketX, ry + rowH / 2 + 5);
    }
    ctx.fillStyle = String(leg.odds || "").startsWith("+") ? "#10b981" : "#e8eaed";
    ctx.font = mono("700", 15);
    ctx.fillText(leg.odds || "—", padL + contentW - colOdds / 2 - 8, ry + rowH / 2 + 5);
    ctx.textAlign = "left";
  });

  if (dim.more) {
    ctx.fillStyle = "#93c5fd";
    ctx.font = sans("700", 13);
    ctx.fillText("+" + dim.more + " more", padL + 16, y + tableH - 14);
  } else {
    const used = 34 + rows.length * rowH;
    const bottom = shareCardBottomLine(m);
    if (bottom && tableH - used > 44) {
      const by = y + tableH - 36;
      ctx.fillStyle = evPositive ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.04)";
      ctx.fillRect(padL + 1, by - 10, contentW - 2, 36);
      ctx.fillStyle = evPositive ? "#6ee7b7" : "#9ca3af";
      ctx.font = sans("600", 13);
      ctx.fillText(fitText(ctx, bottom, contentW - 32), padL + 16, by + 14);
    }
  }
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
