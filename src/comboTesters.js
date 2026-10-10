// Combo Locks testers: pure helpers for the "Connect your exchange" form and
// the owner's "All users" view. No network, no secrets.

import { buildComboStatement } from "./comboStatement.js";

export const VENUE_LABEL = { kalshi: "Kalshi", polymarket_us: "Polymarket US" };

export const CONNECT_COPY = {
  title: "Your exchange accounts",
  intro: "Combo Locks quotes and hedges on your own exchange account, with your own money and at your own risk. Profits and losses are yours.",
  keyAdvice: "Use a Kalshi API key with Full access, or with Read, Trade and Transfers (steps below). Disconnect here, or delete the key at the exchange, any time.",
  never: "Never share your exchange password or 2FA codes. We only ask for an API key, and nobody from aibetbuilder will ever ask for your password.",
};

// "How to connect your Kalshi key": short numbered guide on the card. Matches
// Kalshi's Create API key screen (Oct 2026). Open by default until Kalshi is
// connected. Full access (or Read + Trade + Transfers) lets combo-worker keep
// the tester's Combos balance funded from their own Default balance.
export const KALSHI_HOWTO = {
  title: "How to connect your Kalshi key",
  steps: [
    "On a computer, sign in at kalshi.com, open your Account settings and find API keys. Click Create API key.",
    "Key type: Ed25519 (Kalshi's default) or RSA. Either one works.",
    "Permissions: choose Full access (simplest), or check Read, Trade and Transfers. Leave the sub-account blank.",
    "Click Create. Copy the Key ID and download the private key file. Kalshi shows the private key only once.",
    "Back here, click Connect Kalshi. Paste the Key ID, then open the private key file and paste all of it, including the BEGIN and END lines. Click Check & save key.",
    "The site keeps your Amount to keep for combos (90% of your Kalshi cash unless you change it) in your Combos balance for you. Nothing to do here.",
  ],
  safe: "The site only uses this key to place your Combo Locks trades and move money between your own Kalshi balances. It never withdraws money.",
};

// Auto-funding status line under the Kalshi row.
export const AUTOFUND_COPY = {
  off: "Auto-funding is off for this key. To have the site fill your Combos balance for you, reconnect with a key that has Transfers or Full access. Your trades keep working meanwhile.",
  review: "Auto-funding starts once the owner confirms this key's permissions.",
  noCap: "Auto-funding is waiting for a daily limit. The owner sets it.",
  paused: "Auto-funding is off: your Amount to keep for combos is 0%, so nothing trades or moves.",
};

// "Amount to keep for combos": a % of total Kalshi cash (Default + Combos),
// recomputed by combo-worker every check (keep-pct.js there mirrors this).
// combo_settings.autofund_pct: null = DEFAULT_KEEP_PCT, 0 = off.
// Legacy combo_settings.autofund_cap_usd is used only when pct is null.
export const DEFAULT_KEEP_PCT = 90;

const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function keepSetting(pct, legacyUsd = null) {
  const p = numOrNull(pct);
  if (p != null) {
    const c = Math.min(100, Math.max(0, p));
    return c > 0 ? { mode: "pct", pct: c } : { mode: "off" };
  }
  const usd = numOrNull(legacyUsd);
  if (usd != null) return usd > 0 ? { mode: "usd", usd } : { mode: "off" };
  return { mode: "pct", pct: DEFAULT_KEEP_PCT, defaulted: true };
}

// Dollar target right now: never more than total cash; testers with a daily
// limit are never targeted above it. null = off / unknown limit.
export function keepTargetUsd(keep, totalUsd, caps = null) {
  if (!keep || keep.mode === "off") return null;
  const unlimited = !!(caps && caps.fundUnlimited);
  const daily = numOrNull(caps && caps.perDayUsd);
  if (!unlimited && !(daily > 0)) return null;
  const total = numOrNull(totalUsd);
  let t = keep.mode === "pct" ? (total == null ? null : Math.floor(total * keep.pct) / 100) : keep.usd;
  if (t == null) return null;
  if (total != null) t = Math.min(t, total);
  if (!unlimited) t = Math.min(t, daily);
  return Math.max(0, Math.round(t * 100) / 100);
}

// "90" / "90%" -> 90; "" -> null (= 90% default); bad / >100 -> NaN.
export function parsePctInput(v) {
  const t = String(v == null ? "" : v).replace(/[%\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : NaN;
}

export function autoFundLine(row, caps, keep = null, totalUsd = null) {
  if (!row || !row.connected) return null;
  if (row.scopeStatus === "unverified") return { tone: "muted", text: AUTOFUND_COPY.review };
  if (!row.autoFund) return { tone: "warn", text: AUTOFUND_COPY.off };
  const k = keep || keepSetting(null);
  if (k.mode === "off") return { tone: "muted", text: AUTOFUND_COPY.paused };
  if (!(caps && caps.fundUnlimited) && !(numOrNull(caps && caps.perDayUsd) > 0)) return { tone: "muted", text: AUTOFUND_COPY.noCap };
  const t = keepTargetUsd(k, totalUsd, caps);
  const about = t != null ? ` (about ${money(t)} right now)` : "";
  const what = k.mode === "pct" ? `${k.pct}% of your Kalshi cash` : money(k.usd);
  return { tone: "ok", text: `Auto-funding is on: we keep ${what} in your Combos balance${about}.` };
}

const FUND_STATUS = { sending: "sending", accepted: "processing", confirmed: "done", failed: "failed" };

// One line per logged move (combo_fund_moves row).
export function fundMoveText(row) {
  if (!row) return "";
  const amt = Number(row.amount_usd);
  const amount = Number.isFinite(amt) ? "$" + amt.toFixed(2) : "—";
  const dir = Number(row.from_shard) === 1 ? "Combos → Default" : "Default → Combos";
  return `${amount} ${dir} · ${FUND_STATUS[row.status] || row.status || "—"}`;
}

export const VENUE_HELP = {
  kalshi: {
    where: "Follow the steps above: Full access, or Read, Trade and Transfers. Ed25519 or RSA keys both work.",
    idLabel: "Key ID",
    secretLabel: "Private key (the whole file, including the BEGIN/END lines)",
    secretPlaceholder: "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----",
  },
  polymarket_us: {
    where: "polymarket.us/developer → Create API key. Use the same sign-in method as the app.",
    idLabel: "Key ID",
    secretLabel: "Secret key",
    secretPlaceholder: "Paste the secret key shown once when you created it",
  },
};

export function money(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return "$" + (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2));
}

export function capsLine(caps) {
  if (!caps || (caps.perLockUsd == null && caps.perDayUsd == null)) return "No limits";
  return `${money(caps.perLockUsd)} per lock · ${money(caps.perDayUsd)} per day`;
}

export function venueStatusText(venue, row) {
  if (!row || !row.connected) return `${VENUE_LABEL[venue] || venue} not connected`;
  return row.label || `${VENUE_LABEL[venue] || venue} connected ••••${row.hint || ""}`;
}

// One word for the owner's table, worst state first.
export function userTradingState(u) {
  if (!u) return { key: "none", label: "—", tone: "skip" };
  if (u.desk === "server_keys" && u.is_owner) {
    return u.kill_switch ? { key: "kill", label: "Kill switch on", tone: "warn" } : { key: "trading", label: "Trading (server keys)", tone: "ok" };
  }
  if (!u.in_live_users || !u.approved) return { key: "not_approved", label: "Not approved", tone: "skip" };
  if (u.paused) return { key: "paused", label: "Paused by owner", tone: "loss" };
  if (u.desk !== "server_keys" && !(u.keys && u.keys.kalshi && u.keys.kalshi.connected)) return { key: "no_key", label: "No Kalshi key", tone: "warn" };
  if (u.kill_switch) return { key: "kill", label: "Kill switch on", tone: "warn" };
  return { key: "trading", label: "Trading", tone: "ok" };
}

// Realized P/L per user from the owner's RLS reads, with the same statement
// math as each user's own history.
export function pnlByUser(parlays = [], fills = []) {
  const fillsById = {};
  for (const f of fills || []) {
    if (!f || !f.parlay_id) continue;
    fillsById[f.parlay_id] = (fillsById[f.parlay_id] || 0) + (Number(f.count) || 0);
  }
  const groups = {};
  for (const p of parlays || []) {
    if (!p || !p.user_id) continue;
    (groups[p.user_id] = groups[p.user_id] || []).push(p);
  }
  const out = {};
  for (const [uid, rows] of Object.entries(groups)) {
    const st = buildComboStatement({ parlays: rows, fillsById });
    out[uid] = { realized: st.realized, settled: st.lockedFills + st.unfilledSettled, pending: st.pending };
  }
  return out;
}

export function signedMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return (n < 0 ? "−$" : "+$") + Math.abs(n).toFixed(2);
}

// Never keep a typed secret around after a submit, success or not.
export function emptyForm() {
  return { keyId: "", secret: "" };
}
