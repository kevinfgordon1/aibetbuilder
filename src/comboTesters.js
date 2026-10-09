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
    "The site moves money into your Combos balance for you, up to the cap you set. Nothing to do here.",
  ],
  safe: "The site only uses this key to place your Combo Locks trades and move money between your own Kalshi balances. It never withdraws money.",
};

// Auto-funding status line under the Kalshi row.
export const AUTOFUND_COPY = {
  off: "Auto-funding is off for this key. To have the site fill your Combos balance for you, reconnect with a key that has Transfers or Full access. Your trades keep working meanwhile.",
  review: "Auto-funding starts once the owner confirms this key's permissions.",
  noCap: "Auto-funding is waiting for a daily limit. The owner sets it.",
  paused: "Auto-funding is paused (your cap is $0).",
};

// The cap the worker uses: the tester's own cap, never above the daily limit.
export function effectiveCap(ownCap, dailyLimit) {
  const daily = Number(dailyLimit);
  if (dailyLimit == null || !(daily > 0)) return null;
  if (ownCap == null || ownCap === "") return daily;
  const own = Number(ownCap);
  if (!Number.isFinite(own) || own < 0) return daily;
  return Math.min(own, daily);
}

// "$120" / "120.50" -> 120.5; "" -> null (use the daily limit); bad -> NaN.
export function parseCapInput(v) {
  const t = String(v == null ? "" : v).replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

export function autoFundLine(row, caps, ownCap = null) {
  if (!row || !row.connected) return null;
  if (row.scopeStatus === "unverified") return { tone: "muted", text: AUTOFUND_COPY.review };
  if (!row.autoFund) return { tone: "warn", text: AUTOFUND_COPY.off };
  const cap = effectiveCap(ownCap, caps && caps.perDayUsd);
  if (cap == null) return { tone: "muted", text: AUTOFUND_COPY.noCap };
  if (cap === 0) return { tone: "muted", text: AUTOFUND_COPY.paused };
  return { tone: "ok", text: `Auto-funding is on: we keep your Combos balance topped up to ${money(cap)}.` };
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
