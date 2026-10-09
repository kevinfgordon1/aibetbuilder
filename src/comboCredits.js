// Combo Locks prepaid credits — pure helpers + pricing config.
//
// 1 credit = $1. Users add credits with USDC through a Coinbase Business
// checkout; /api/coinbase-webhook writes the deposit to combo_credit_ledger.
// The balance is derived from the ledger (view combo_credit_balances).
//
// PRICING IS OFF. The 1% success fee and the free monthly allowance are
// config only and stay disabled until Kevin approves pricing AND a lawyer
// signs off. Nothing in the app debits credits today.

export const CREDIT_PRESETS_USD = Object.freeze([10, 25, 50, 100]);
export const DEFAULT_PRESET_USD = 25;

export const CREDITS_PRICING = Object.freeze({
  /** 1% of filled hedge notional, only when feesEnabled. */
  feeRate: 0.01,
  feesEnabled: false,
  /** Free monthly grant (resets each calendar month, ET), only when allowanceEnabled. */
  monthlyAllowanceUsd: 0,
  allowanceEnabled: false,
});

const round2 = (x) => Math.round(x * 100 + Number.EPSILON) / 100;

/** Fee in USD for a filled notional. 0 while fees are off (today). */
export function fillFeeUsd(notionalUsd, pricing = CREDITS_PRICING) {
  if (!pricing || !pricing.feesEnabled) return 0;
  const n = Number(notionalUsd);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return round2(n * Number(pricing.feeRate || 0));
}

/** Free monthly allowance in USD. 0 while the allowance is off (today). */
export function monthlyAllowanceUsd(pricing = CREDITS_PRICING) {
  if (!pricing || !pricing.allowanceEnabled) return 0;
  const n = Number(pricing.monthlyAllowanceUsd);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

export function isPresetAmount(n) {
  return CREDIT_PRESETS_USD.includes(Number(n));
}

/** Balance from raw ledger rows (same math as the SQL view). */
export function balanceFromLedger(rows) {
  let cents = 0;
  for (const r of rows || []) {
    const v = Number(r && r.amount_usd);
    if (Number.isFinite(v)) cents += Math.round(v * 100);
  }
  return cents / 100;
}

export function creditsText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const KIND_LABEL = Object.freeze({
  deposit: "Added with USDC",
  fee: "Combo Locks fee",
  allowance: "Free monthly credits",
  adjustment: "Adjustment",
  refund: "Refund",
});

export function ledgerLabel(row) {
  if (!row) return "";
  if (row.kind === "deposit" && row.source === "stripe_checkout") return "Added with card";
  if (row.kind === "refund" && row.source === "stripe_refund") return "Refunded to card";
  return KIND_LABEL[row.kind] || "Credit change";
}

/** Copy for the "Add credits" buttons/notes, based on server config status.
 * configured = USDC (Coinbase) or card (Stripe) is switched on; busy = false | "usdc" | "card". */
export function addCreditsState({ configured, loading = false, busy = false, error = null } = {}) {
  if (loading) return { disabled: true, note: "Checking…" };
  if (!configured) return { disabled: true, note: "Coming soon. Adding credits isn't switched on yet." };
  if (busy) return { disabled: true, note: busy === "card" ? "Opening card checkout…" : "Opening Coinbase checkout…" };
  if (error) return { disabled: false, note: error };
  return { disabled: false, note: "" };
}

/** ?credits=paid|failed on return from Coinbase checkout. */
export function returnNote(search) {
  let v = "";
  try { v = new URLSearchParams(String(search || "")).get("credits") || ""; } catch (_) { v = ""; }
  if (v === "paid") return { kind: "ok", text: "Thanks! Your payment is confirming. Credits usually show up within a minute or two." };
  if (v === "failed") return { kind: "warn", text: "The payment didn't go through, so nothing was charged. You can try again any time." };
  return null;
}

/** Env kill switch for the Combo Locks "Your credits" card.
 * Off by default. Set VITE_SHOW_CREDITS_CARD=1 / true / on to show it again.
 * Backend, tables, and Coinbase webhook stay in place either way.
 */
export function showCreditsCardFromEnv(raw) {
  if (raw == null || raw === "") return false;
  const s = String(raw).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

export function showCreditsCardEnabled() {
  let raw;
  try {
    const env = import.meta && import.meta.env;
    if (env && env.VITE_SHOW_CREDITS_CARD != null && env.VITE_SHOW_CREDITS_CARD !== "") {
      raw = env.VITE_SHOW_CREDITS_CARD;
    }
  } catch {
    /* node tests have no Vite env */
  }
  if (raw == null) {
    try {
      if (typeof process !== "undefined" && process.env && process.env.VITE_SHOW_CREDITS_CARD != null) {
        raw = process.env.VITE_SHOW_CREDITS_CARD;
      }
    } catch {
      /* ignore */
    }
  }
  if (raw == null) {
    try {
      if (typeof process !== "undefined" && process.env && process.env.SHOW_CREDITS_CARD != null) {
        raw = process.env.SHOW_CREDITS_CARD;
      }
    } catch {
      /* ignore */
    }
  }
  // Hard default: hidden until Kevin turns the card back on (unset → false).
  return showCreditsCardFromEnv(raw);
}

/** True when a Supabase error means the credits tables aren't installed yet. */
export function isMissingCreditsSchema(error) {
  const msg = String((error && (error.message || error.details)) || error || "");
  const code = String((error && error.code) || "");
  return code === "42P01" || code === "PGRST205" || /combo_credit_|schema cache|does not exist/i.test(msg);
}

/** USDC (Coinbase) button on the credits card. Off by default; set
 * VITE_SHOW_USDC_CREDITS=1 / true / on to show it. Backend stays in place. */
export function showUsdcCreditsEnabled() {
  let raw;
  try { const env = import.meta && import.meta.env; if (env && env.VITE_SHOW_USDC_CREDITS != null && env.VITE_SHOW_USDC_CREDITS !== "") raw = env.VITE_SHOW_USDC_CREDITS; } catch { /* node */ }
  if (raw == null) { try { if (typeof process !== "undefined" && process.env) raw = process.env.VITE_SHOW_USDC_CREDITS; } catch { /* ignore */ } }
  return showCreditsCardFromEnv(raw);
}
