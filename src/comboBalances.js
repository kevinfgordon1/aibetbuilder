// "Available to trade" for Combo Locks: pure helpers over public.combo_balances
// rows (written by combo-worker every ~60s with each account's own keys).
// Kalshi exchange_index 1 = combo bucket (KXMVE combos clear here), 0 = main /
// single-game. Polymarket US: buying power (cash net of open orders).

export const BALANCE_STALE_MS = 5 * 60 * 1000;
export const KALSHI_COMBO_SHARD = 1;
export const KALSHI_MAIN_SHARD = 0;

const KFEE = 0.0175;
const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
function nominalProbFromEff(sEff) {
  const b = 1 - KFEE;
  return (-b + Math.sqrt(b * b + 4 * KFEE * sEff)) / (2 * KFEE);
}

/** Hedge cost per contract (NO price paid), same as the worker's fillView().noBid. */
export function noBidFromFill(fillAmerican) {
  const a = Number(fillAmerican);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) return null;
  const v = floor2(1 - nominalProbFromEff(impliedProb(a)));
  return v > 0 && v < 1 ? v : null;
}

export function usd(n, { cents = true } = {}) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** "2:15 PM ET" (or "Oct 7, 2:15 PM ET" when not today in ET). */
export function etTime(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x) => x.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const t = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  if (day(d) === day(now)) return `${t} ET`;
  const md = d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  return `${md}, ${t} ET`;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** One shard/venue cell: amount + state ("ok" | "error" | "stale" | "waiting"). */
export function balanceCell(row, now = new Date()) {
  if (!row) return { state: "waiting", amount: null, at: null, checkedAt: null, error: null };
  const amount = num(row.available_usd);
  const at = row.fetched_at || null;
  const checkedAt = row.checked_at || null;
  const age = checkedAt ? now.getTime() - new Date(checkedAt).getTime() : Infinity;
  if (age > BALANCE_STALE_MS) return { state: "stale", amount, at, checkedAt, error: row.error || null };
  if (!row.ok) return { state: "error", amount, at, checkedAt, error: row.error || null };
  return { state: amount == null ? "waiting" : "ok", amount, at, checkedAt, error: null };
}

/** Group rows -> { [userId]: { kalshiCombo, kalshiMain, poly, updatedAt } }. */
export function balancesByUser(rows, now = new Date()) {
  const out = {};
  for (const r of rows || []) {
    if (!r || !r.user_id) continue;
    const u = out[r.user_id] || (out[r.user_id] = { kalshiCombo: balanceCell(null, now), kalshiMain: balanceCell(null, now), poly: balanceCell(null, now), updatedAt: null, polyBuyingPower: null });
    const cell = balanceCell(r, now);
    if (r.venue === "kalshi" && Number(r.shard) === KALSHI_COMBO_SHARD) u.kalshiCombo = cell;
    else if (r.venue === "kalshi" && Number(r.shard) === KALSHI_MAIN_SHARD) u.kalshiMain = cell;
    else if (r.venue === "polymarket_us") { u.poly = cell; u.polyBuyingPower = num(r.buying_power_usd); }
    const t = r.fetched_at || null;
    if (t && (!u.updatedAt || t > u.updatedAt)) u.updatedAt = t;
  }
  return out;
}

export function emptyBalances(now = new Date()) {
  return { kalshiCombo: balanceCell(null, now), kalshiMain: balanceCell(null, now), poly: balanceCell(null, now), updatedAt: null, polyBuyingPower: null };
}

/** Short line for a cell: "$1,234.56", "Couldn't load", "Checking…". */
export function cellText(cell) {
  if (!cell || cell.state === "waiting") return "Checking…";
  if (cell.state === "ok") return usd(cell.amount);
  if (cell.amount != null) return `${usd(cell.amount)} (couldn't refresh)`;
  return "Couldn't load";
}

export function cellNote(cell, now = new Date()) {
  if (!cell) return "";
  if (cell.state === "waiting") return "First balance check runs within a minute.";
  if (cell.state === "stale") return cell.checkedAt ? `Not updated since ${etTime(cell.checkedAt, now)}.` : "Not updated recently.";
  if (cell.state === "error") return cell.at ? `Last loaded ${etTime(cell.at, now)}.` : "Couldn't reach the exchange. Retrying every minute.";
  return "";
}

/**
 * Worst-case cash one lock can need on the combo bucket if its remaining size
 * fills at once: remaining contracts x NO price per contract.
 */
export function lockNeedUsd(parlay, filledContracts = 0) {
  if (!parlay) return null;
  const max = Number(parlay.max_contracts);
  const per = noBidFromFill(parlay.fill_american);
  if (!Number.isFinite(max) || max <= 0 || per == null) return null;
  const remaining = Math.max(0, max - (Number(filledContracts) || 0));
  return Math.round(remaining * per * 100) / 100;
}

/**
 * Largest single-lock need among active, unpaused locks, and whether the combo
 * balance is below it. filledById: { [parlay_id]: contracts filled }.
 */
export function comboShortfall({ comboUsd, parlays, filledById = {} }) {
  const bal = num(comboUsd);
  let worst = null;
  for (const p of parlays || []) {
    if (!p || p.archived_at || p.paused) continue;
    const need = lockNeedUsd(p, filledById[p.id] || 0);
    if (need == null || need <= 0) continue;
    if (!worst || need > worst.need) worst = { need, parlay: p };
  }
  if (!worst || bal == null) return { short: false, need: worst ? worst.need : null, parlay: worst ? worst.parlay : null };
  return { short: bal < worst.need, need: worst.need, parlay: worst.parlay, gap: Math.round((worst.need - bal) * 100) / 100 };
}

export function filledByParlay(fills) {
  const out = {};
  for (const f of fills || []) {
    if (!f || !f.parlay_id) continue;
    out[f.parlay_id] = (out[f.parlay_id] || 0) + (Number(f.count) || 0);
  }
  return out;
}

/** Compact Balance cell for the owner table. */
export function adminBalanceText(b, { kalshi = true, poly = false } = {}) {
  if (!b) return "—";
  const parts = [];
  if (kalshi) parts.push(`Combo ${b.kalshiCombo.state === "ok" ? usd(b.kalshiCombo.amount, { cents: false }) : b.kalshiCombo.state === "waiting" ? "…" : b.kalshiCombo.amount != null ? usd(b.kalshiCombo.amount, { cents: false }) + "*" : "?"}`);
  if (kalshi) parts.push(`Main ${b.kalshiMain.state === "ok" ? usd(b.kalshiMain.amount, { cents: false }) : b.kalshiMain.state === "waiting" ? "…" : b.kalshiMain.amount != null ? usd(b.kalshiMain.amount, { cents: false }) + "*" : "?"}`);
  if (poly) parts.push(`PM ${b.poly.state === "ok" ? usd(b.poly.amount, { cents: false }) : b.poly.state === "waiting" ? "…" : b.poly.amount != null ? usd(b.poly.amount, { cents: false }) + "*" : "?"}`);
  return parts.join(" · ");
}
