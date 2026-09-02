// Unhedged RFQ blotter — read-only mapping over public.unhedged_rfqs.
// Combo-worker writes this table in a parallel PR. Column names may arrive
// incrementally; pick known aliases and never invent a price.
//
// Status is seen / would_quote / quoted / filled only. Missing table must
// become an empty state (PGRST205 / 42P01), not a thrown error.

export const UNHEDGED_TABLE = "unhedged_rfqs";
export const UNHEDGED_LIMIT = 400;
export const UNHEDGED_STATUSES = ["seen", "would_quote", "quoted", "filled"];

const TIME_KEYS = [
  "created_at",
  "seen_at",
  "quoted_at",
  "filled_at",
  "rfq_created_ts",
  "created_ts",
  "created_time",
  "createdTime",
  "ts",
  "time",
  "at",
];

const VENUE_KEYS = ["venue", "exchange", "source", "book"];
const LABEL_KEYS = ["label", "title", "market_label", "parlay_label", "market_ticker", "ticker"];
const LEGS_KEYS = ["legs", "combo_legs", "comboLegs", "mve_selected_legs", "selected_legs"];
const CONTRACT_KEYS = ["contracts", "contracts_fp", "qty", "size", "count", "qtyDecimal"];

const THEIR_AMERICAN_KEYS = [
  "rfq_american",
  "their_american",
  "rfq_price_american",
  "their_price_american",
];
const THEIR_YES_KEYS = ["rfq_yes", "their_yes", "yes_price", "rfq_price", "target_yes"];
const THEIR_NO_KEYS = ["rfq_no", "their_no", "no_price"];

const OUR_AMERICAN_KEYS = [
  "would_quote_american",
  "fair_american",
  "our_american",
  "our_quote_american",
];
const OUR_PRICE_KEYS = ["would_quote", "fair", "our_quote"];

const FILL_AMERICAN_KEYS = ["fill_american", "filled_american", "fill_price_american"];
const FILL_PRICE_KEYS = ["fill_price", "fill", "filled_price"];

export function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pickFirst(row, keys) {
  if (!row || !keys) return null;
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

export function americanFromProb(p) {
  const n = toNum(p);
  if (!(n > 0 && n < 1)) return null;
  return n < 0.5
    ? Math.round((100 * (1 - n)) / n)
    : -Math.round((100 * n) / (1 - n));
}

export function formatAmerican(a) {
  const n = toNum(a);
  if (n == null || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole > 0 ? "+" + whole : String(whole);
}

// Explicit American fields (or integer-like odds). 0 < n < 1 is a probability,
// not American — do not treat 0.23 as +0.
export function coerceAmerican(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "—") return null;
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n)) return null;
      if (n > 0 && n < 1) return americanFromProb(n);
      return Math.round(n);
    }
    return null;
  }
  const n = toNum(value);
  if (n == null) return null;
  if (n > 0 && n < 1) return americanFromProb(n);
  return Math.round(n);
}

export function rowTime(row) {
  return pickFirst(row, TIME_KEYS);
}

export function timeMs(ts) {
  if (ts == null || ts === "") return 0;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

export function formatEtTime(ts) {
  const ms = timeMs(ts);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

export function venueKey(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  if (s === "kalshi" || s === "kxi" || s.startsWith("kalshi")) return "kalshi";
  if (s === "polymarket" || s === "poly" || s === "pm" || s.startsWith("polymarket")) return "polymarket";
  return s;
}

export function formatVenue(value) {
  const key = venueKey(value);
  if (key === "kalshi") return "Kalshi";
  if (key === "polymarket") return "Polymarket";
  if (!key) return "—";
  return String(value).trim();
}

function legChip(leg) {
  if (leg == null) return null;
  if (typeof leg === "string") {
    const text = leg.trim();
    return text ? { type: "", text } : null;
  }
  if (typeof leg !== "object") return null;
  const type = String(leg.type || leg.side || "").trim();
  const text = String(
    leg.label || leg.title || leg.market_ticker || leg.ticker || leg.symbol || leg.slug || ""
  ).trim();
  if (!text && !type) return null;
  return { type, text: text || type };
}

export function rowLegs(row) {
  const raw = pickFirst(row, LEGS_KEYS);
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? [{ type: "", text }] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(legChip).filter(Boolean);
}

export function rowLabel(row) {
  const label = pickFirst(row, LABEL_KEYS);
  if (label != null && String(label).trim()) return String(label).trim();
  const chips = rowLegs(row);
  if (!chips.length) return "—";
  return chips.map((c) => (c.type ? `${c.type} ${c.text}` : c.text).trim()).join(" · ");
}

export function rowContracts(row) {
  return toNum(pickFirst(row, CONTRACT_KEYS));
}

export function theirRfqAmerican(row) {
  const stated = pickFirst(row, THEIR_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const yes = pickFirst(row, THEIR_YES_KEYS);
  const fromYes = yes != null ? coerceAmerican(yes) : null;
  if (fromYes != null) return fromYes;
  const no = toNum(pickFirst(row, THEIR_NO_KEYS));
  if (no != null && no > 0 && no < 1) return americanFromProb(1 - no);
  return null;
}

export function ourQuoteAmerican(row) {
  const stated = pickFirst(row, OUR_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const price = pickFirst(row, OUR_PRICE_KEYS);
  return price != null ? coerceAmerican(price) : null;
}

export function fillAmerican(row) {
  const stated = pickFirst(row, FILL_AMERICAN_KEYS);
  if (stated != null) return coerceAmerican(stated);
  const price = pickFirst(row, FILL_PRICE_KEYS);
  return price != null ? coerceAmerican(price) : null;
}

export function normalizeStatus(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "seen" || raw === "received" || raw === "new") return "seen";
  if (raw === "would_quote" || raw === "wouldquote" || raw === "would") return "would_quote";
  if (raw === "quoted" || raw === "quote" || raw === "posted") return "quoted";
  if (raw === "filled" || raw === "fill" || raw === "executed") return "filled";
  return null;
}

export function rowStatus(row) {
  const fromCol = normalizeStatus(pickFirst(row, ["status", "state"]));
  if (fromCol) return fromCol;
  if (fillAmerican(row) != null) return "filled";
  if (ourQuoteAmerican(row) != null) return "would_quote";
  return "seen";
}

export function statusTone(status) {
  if (status === "filled") return "ok";
  if (status === "quoted") return "fill";
  if (status === "would_quote") return "warn";
  return "";
}

export function formatContracts(n) {
  const v = toNum(n);
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(v);
}

export function mapUnhedgedRow(row, index = 0) {
  const at = rowTime(row);
  const venueRaw = pickFirst(row, VENUE_KEYS);
  const status = rowStatus(row);
  return {
    id: (row && (row.id || row.rfq_id)) || `row-${index}`,
    at,
    timeEt: formatEtTime(at),
    venue: formatVenue(venueRaw),
    venueKey: venueKey(venueRaw),
    label: rowLabel(row),
    legs: rowLegs(row),
    contracts: rowContracts(row),
    contractsText: formatContracts(rowContracts(row)),
    theirAmerican: theirRfqAmerican(row),
    theirText: formatAmerican(theirRfqAmerican(row)) || "—",
    ourAmerican: ourQuoteAmerican(row),
    ourText: formatAmerican(ourQuoteAmerican(row)) || "—",
    status,
    statusTone: statusTone(status),
    fillAmerican: fillAmerican(row),
    fillText: formatAmerican(fillAmerican(row)) || "—",
  };
}

export function sortUnhedgedRows(rows) {
  return [...(rows || [])].sort((a, b) => timeMs(b.at) - timeMs(a.at) || String(b.id).localeCompare(String(a.id)));
}

export function mapUnhedgedRows(rows) {
  return sortUnhedgedRows((rows || []).map((row, i) => mapUnhedgedRow(row, i)));
}

function errorText(error) {
  if (!error) return "";
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = errorText(error);
  return (
    msg.includes("could not find the table")
    || (msg.includes("unhedged_rfqs") && (
      msg.includes("does not exist")
      || msg.includes("not find")
      || msg.includes("schema cache")
    ))
  );
}

export function isMissingUserIdColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = errorText(error);
  if (!msg.includes("user_id")) return false;
  return (
    code === "42703"
    || code === "PGRST204"
    || msg.includes("does not exist")
    || msg.includes("not find")
    || msg.includes("unknown")
  );
}

async function runSelect(client, { userId, limit }) {
  let q = client.from(UNHEDGED_TABLE).select("*");
  if (userId) q = q.eq("user_id", userId);
  if (typeof q.limit === "function") q = q.limit(limit);
  return q;
}

// Select * for the signed-in user when user_id exists on the table; otherwise
// every row RLS already allows. A missing table is an empty blotter, not a crash.
export async function fetchUnhedgedRfqs(client, { userId = null, limit = UNHEDGED_LIMIT } = {}) {
  if (!client || typeof client.from !== "function") {
    return { rows: [], missingTable: false, error: { message: "no client" } };
  }
  let result;
  try {
    result = await runSelect(client, { userId, limit });
  } catch (err) {
    if (isMissingTableError(err)) return { rows: [], missingTable: true, error: err };
    return { rows: [], missingTable: false, error: err };
  }
  let error = result && result.error;
  let data = result && result.data;
  if (error && userId && isMissingUserIdColumn(error)) {
    try {
      result = await runSelect(client, { userId: null, limit });
    } catch (err) {
      if (isMissingTableError(err)) return { rows: [], missingTable: true, error: err };
      return { rows: [], missingTable: false, error: err };
    }
    error = result && result.error;
    data = result && result.data;
  }
  if (error && isMissingTableError(error)) {
    return { rows: [], missingTable: true, error };
  }
  if (error) return { rows: [], missingTable: false, error };
  return { rows: Array.isArray(data) ? data : [], missingTable: false, error: null };
}
