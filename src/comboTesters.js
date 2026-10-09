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
    "Permissions: pick Full access (simplest). Or check Read all data, Trade and Transfers. Leave the sub-account blank.",
    "Click Create. Copy the Key ID and download the private key file. Kalshi shows the private key only once.",
    "Back here, click Connect Kalshi. Paste the Key ID, then open the private key file and paste all of it, including the BEGIN and END lines. Click Check & save key.",
    "That's it. The site moves money from your Kalshi Default balance into your Combos balance for you, up to your daily limit. Every move shows up on this card.",
  ],
  fallback: "Rather move it yourself? On kalshi.com go to Settings > Advance shard settings, turn on \"Disable balance management\", click Transfer and move money from Exchange 0 (Default) to Exchange 1 (Combos). Then turn the switch back off.",
  safe: "The key works only on your own Kalshi account. The site only moves your money between your own Default and Combos balances, never past your limit. Kalshi's API can't withdraw to a bank or send money to anyone else, and you can delete the key in Kalshi any time.",
};

// Auto-funding status line under the Kalshi row.
export const AUTOFUND_COPY = {
  off: "Auto-funding is off: this key can't move money into your Combos balance. To turn it on, create a new Kalshi key with Full access (or check Transfers too), then disconnect this one and connect the new key. Trading still works meanwhile.",
  review: "Auto-funding starts once the owner confirms this key's permissions.",
  noCap: "Auto-funding is waiting for a daily limit. The owner sets it.",
};

export function autoFundLine(row, caps) {
  if (!row || !row.connected) return null;
  if (row.scopeStatus === "unverified") return { tone: "muted", text: AUTOFUND_COPY.review };
  if (!row.autoFund) return { tone: "warn", text: AUTOFUND_COPY.off };
  const cap = caps && caps.perDayUsd;
  if (cap == null || !(Number(cap) > 0)) return { tone: "muted", text: AUTOFUND_COPY.noCap };
  return { tone: "ok", text: `Auto-funding is on. We top up your Combos balance from your Default balance, up to ${money(cap)} (your daily limit).` };
}

const FUND_STATUS = { sending: "sending", accepted: "processing", confirmed: "done", failed: "failed" };

// One line per logged move (combo_fund_moves row).
export function fundMoveText(row) {
  if (!row) return "";
  const amt = Number(row.amount_usd);
  const amount = Number.isFinite(amt) ? "$" + amt.toFixed(2) : "—";
  return `${amount} Default → Combos · ${FUND_STATUS[row.status] || row.status || "—"}`;
}

export const VENUE_HELP = {
  kalshi: {
    where: "Follow the steps above: Full access (or Read all data + Trade + Transfers). Ed25519 or RSA keys both work.",
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
