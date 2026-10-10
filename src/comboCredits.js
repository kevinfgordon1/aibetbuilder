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

// ---------------------------------------------------------------------------
// Per-user Combo Locks fees (combo_live_users.fees_enabled; SQL in
// sql/20261010_combo_fees_per_user.sql). Everyone else stays fee-free.
// Fee = 1% of the amount at risk on each filled lock:
//   0.01 x contracts x lay price, lay price = 1 - YES price (the NO side).
// Charged by the database as fills land: monthly allowance first (resets on
// the 1st, ET, no rollover), then purchased credits.

export const COMBO_FEE_RATE = 0.01;

/** Fee in USD for one fill: 0.01 x contracts x (1 - yesPrice), to the cent. */
export function lockFillFeeUsd(contracts, yesPrice, rate = COMBO_FEE_RATE) {
  const c = Number(contracts), y = Number(yesPrice);
  if (!(c > 0) || !(y > 0 && y < 1)) return 0;
  return round2(rate * c * (1 - y));
}

const decOf = (am) => {
  const a = Number(am);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};
const amOfProfit = (r) => (r >= 1 ? r * 100 : -100 / r);

/**
 * All-in "Selling at" odds once the 1% fee is counted. Per contract you risk
 * the lay price n and win 1 - n; the fee adds 1% to the risk, so in
 * profit-multiple terms (decimal - 1) the all-in price is 1.01x the exchange
 * price: +1150 on the exchange = +1162 all-in (lay -1150 -> -1162).
 */
export function allInFromExchange(exchangeAmerican, rate = COMBO_FEE_RATE) {
  const d = decOf(exchangeAmerican);
  if (!d) return null;
  const a = amOfProfit((d - 1) * (1 + rate));
  return a >= 0 ? Math.ceil(a - 1e-9) : -Math.floor(-a + 1e-9);
}

/**
 * Work backward from the user's all-in price to the exchange price we quote.
 * Rounded so the user never ends up worse than the all-in price they typed.
 */
export function exchangeFromAllIn(allInAmerican, rate = COMBO_FEE_RATE) {
  const d = decOf(allInAmerican);
  if (!d) return null;
  const r = (d - 1) / (1 + rate);
  let a = amOfProfit(r);
  if (a > -100 && a < 100) a = a >= 0 ? 100 : -100;
  return a >= 0 ? Math.floor(a + 1e-9) : -Math.ceil(-a - 1e-9);
}

/** Normalize a combo_my_fee_status() row. null = fee-free (everyone but fee users). */
export function feeStatusFromRow(row) {
  if (!row || !row.fees_enabled) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    feesEnabled: true,
    allowanceUsd: n(row.monthly_allowance_usd),
    allowanceUsedUsd: n(row.allowance_used_usd),
    allowanceLeftUsd: n(row.allowance_left_usd),
    creditsUsd: n(row.credits_usd),
    canQuote: row.can_quote !== false,
    monthEt: row.month_et || null,
  };
}

/** Banner copy when a fee user is out of allowance and credits. */
export function feeGateNote(status) {
  if (!status || status.canQuote) return null;
  return "Add credits to keep quoting. Your free monthly credits and purchased credits are used up, so new quotes are paused. Fills you already have stay as they are.";
}

/** "Resets Nov 1" for the allowance line. */
export function allowanceResetText(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(now).map((x) => [x.type, x.value]));
  const next = new Date(Date.UTC(+p.year + (+p.month === 12 ? 1 : 0), (+p.month % 12), 1, 12));
  return "Resets " + next.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
