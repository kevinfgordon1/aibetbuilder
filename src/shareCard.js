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

export function buildShareCardModel({
  kind = "promo",
  badge = "BEST PICK",
  bookLabel = "",
  ev = null,
  odds = "",
  stake = null,
  legs = [],
  title = "",
  subtitle = "",
} = {}) {
  const evNum = ev == null || !Number.isFinite(Number(ev)) ? null : Number(ev);
  const evText = evNum == null ? "" : ((evNum > 0 ? "+" : "") + "$" + evNum.toFixed(2) + " EV");
  const legLines = (legs || []).slice(0, 6).map((l) => {
    if (typeof l === "string") return l;
    const name = l.name || l.label || "";
    const extra = [l.market, l.game].filter(Boolean).join(" · ");
    return extra ? name + " — " + extra : name;
  }).filter(Boolean);
  return {
    kind: kind === "ev" ? "ev" : "promo",
    badge: String(badge || "PICK"),
    bookLabel: String(bookLabel || ""),
    ev: evNum,
    evText,
    odds: String(odds || ""),
    stake: stake == null || !Number.isFinite(Number(stake)) ? null : Number(stake),
    legs: legLines,
    title: String(title || ""),
    subtitle: String(subtitle || ""),
    brand: "AI Bet Builder",
    footer: "aibetbuilder.io",
  };
}

function paintShareCard(ctx, model, w, h) {
  const m = model || {};
  ctx.fillStyle = "#0a0b0f";
  ctx.fillRect(0, 0, w, h);

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, m.kind === "ev" ? "rgba(16,185,129,0.18)" : "rgba(59,130,246,0.20)");
  g.addColorStop(1, "rgba(139,92,246,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#e8eaed";
  ctx.font = "700 28px 'DM Sans', system-ui, sans-serif";
  ctx.fillText(m.brand || "AI Bet Builder", 56, 72);
  ctx.fillStyle = "#6b7280";
  ctx.font = "500 18px 'DM Sans', system-ui, sans-serif";
  ctx.fillText("Powered by Claude", 56, 102);

  ctx.fillStyle = m.kind === "ev" ? "#10b981" : "#3b82f6";
  ctx.font = "800 22px 'DM Sans', system-ui, sans-serif";
  ctx.fillText(String(m.badge || "PICK").toUpperCase(), 56, 168);

  ctx.fillStyle = "#f0f0f0";
  ctx.font = "800 64px 'DM Sans', system-ui, sans-serif";
  ctx.fillText(m.evText || m.title || "Pick", 56, 250);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "600 24px 'DM Sans', system-ui, sans-serif";
  const meta = [m.bookLabel, m.odds, m.stake != null ? ("$" + m.stake + " stake") : "", m.subtitle]
    .filter(Boolean)
    .join("   ·   ");
  if (meta) ctx.fillText(meta, 56, 300);

  let y = 360;
  ctx.font = "600 22px 'DM Sans', system-ui, sans-serif";
  for (const line of (m.legs || []).slice(0, 5)) {
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText("▸  " + line, 56, y);
    y += 36;
  }

  ctx.fillStyle = "#4b5563";
  ctx.font = "500 18px 'DM Sans', system-ui, sans-serif";
  ctx.fillText(m.footer || "aibetbuilder.io", 56, h - 40);
}

export function renderShareCardCanvas(model, { width = 1200, height = 630 } = {}) {
  if (typeof document === "undefined") return null;
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
