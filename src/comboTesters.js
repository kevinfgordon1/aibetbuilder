// Combo Locks testers: pure helpers for the "Connect your exchange" form and
// the owner's "All users" view. No network, no secrets.

import { buildComboStatement } from "./comboStatement.js";

export const VENUE_LABEL = { kalshi: "Kalshi", polymarket_us: "Polymarket US" };

export const CONNECT_COPY = {
  title: "Your exchange accounts",
  intro: "Combo Locks quotes and hedges on your own exchange account, with your own money and at your own risk. Profits and losses are yours.",
  keyAdvice: "Use a trade-only API key (steps below). Disconnect here, or delete the key at the exchange, any time.",
  never: "Never share your exchange password or 2FA codes. We only ask for an API key, and nobody from aibetbuilder will ever ask for your password.",
};

// "How to connect your Kalshi key": short numbered guide on the card. Matches
// Kalshi's Create API key screen (Oct 2026). Open by default until Kalshi is
// connected.
export const KALSHI_HOWTO = {
  title: "How to connect your Kalshi key",
  steps: [
    "On a computer, sign in at kalshi.com, open your Account settings and find API keys. Click Create API key.",
    "Key type: Ed25519 (Kalshi's default) or RSA. Either one works.",
    "Permissions: check only Read all data and Trade. Leave everything else unchecked (Full access, Transfers, Accept block trades). Leave the sub-account blank.",
    "Click Create. Copy the Key ID and download the private key file. Kalshi shows the private key only once.",
    "Back here, click Connect Kalshi. Paste the Key ID, then open the private key file and paste all of it, including the BEGIN and END lines. Click Check & save key.",
    "Move the money you want to trade into your Kalshi Combos balance at kalshi.com/account/exchange-indexes. Combo quotes use only that balance.",
  ],
  safe: "This key can only read your account and place trades. It can't move or withdraw money, and you can delete it in Kalshi any time.",
};

export const VENUE_HELP = {
  kalshi: {
    where: "Follow the steps above: Read all data + Trade only. Ed25519 or RSA keys both work.",
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
