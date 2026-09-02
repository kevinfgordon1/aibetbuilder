import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNHEDGED_TABLE,
  UNHEDGED_LIMIT,
  americanFromProb,
  coerceAmerican,
  fetchUnhedgedRfqs,
  formatAmerican,
  formatEtTime,
  formatVenue,
  isMissingTableError,
  isMissingUserIdColumn,
  filterMlbNflMoneylineRows,
  isMlbNflMoneylineRow,
  mapUnhedgedRow,
  mapUnhedgedRows,
  normalizeStatus,
  rowStatus,
  summarizeUnhedgedRows,
} from "./unhedgedTape.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// ── American conversion (same convention as the rest of the desk) ──
assert.equal(americanFromProb(0.08), 1150);
assert.equal(americanFromProb(0.2), 400);
assert.equal(americanFromProb(0.6), -150);
assert.equal(americanFromProb(0), null);
assert.equal(formatAmerican(1150), "+1150");
assert.equal(formatAmerican(-150), "-150");
assert.equal(coerceAmerican("+900"), 900);
assert.equal(coerceAmerican(-110), -110);
assert.equal(coerceAmerican(0.2), 400);
assert.equal(coerceAmerican(""), null);
assert.equal(coerceAmerican(null), null);

// ── ET clock ──
assert.equal(formatEtTime("2026-09-02T16:30:00.000Z"), "Sep 2, 12:30 PM ET");
assert.equal(formatEtTime(null), "—");
assert.equal(formatEtTime(""), "—");

// ── Venue ──
assert.equal(formatVenue("kalshi"), "Kalshi");
assert.equal(formatVenue("polymarket"), "Polymarket");
assert.equal(formatVenue("poly"), "Polymarket");
assert.equal(formatVenue(null), "—");

// ── Status aliases ──
assert.equal(normalizeStatus("would-quote"), "would_quote");
assert.equal(normalizeStatus("posted"), "quoted");
assert.equal(normalizeStatus("executed"), "filled");
assert.equal(normalizeStatus("received"), "seen");
assert.equal(rowStatus({ status: "quoted" }), "quoted");
assert.equal(rowStatus({ fill_american: -120 }), "filled");
assert.equal(rowStatus({ fair_american: 250 }), "would_quote");
assert.equal(rowStatus({}), "seen");
assert.equal(normalizeStatus("started"), "started");
assert.equal(rowStatus({ status: "started" }), "started");
assert.equal(rowStatus({ status: "seen", our_quote_american: 178 }), "would_quote");
assert.equal(rowStatus({ status: "seen" }), "seen");
assert.equal(rowStatus({ status: "filled", our_quote_american: 178 }), "filled");
assert.equal(rowStatus({ fill_yes_price: 0.21 }), "filled");

// ── Row mapping: worker-shaped row ──
{
  const row = mapUnhedgedRow({
    id: "r1",
    created_at: "2026-09-02T16:30:00.000Z",
    venue: "kalshi",
    label: "NYY / BOS",
    legs: [{ type: "ml", label: "NYY" }, { type: "ml", label: "BOS" }],
    contracts: 40,
    rfq_american: 900,
    would_quote_american: 850,
    status: "quoted",
    fill_american: null,
  });
  assert.equal(row.timeEt, "Sep 2, 12:30 PM ET");
  assert.equal(row.venue, "Kalshi");
  assert.equal(row.venueKey, "kalshi");
  assert.equal(row.label, "NYY / BOS");
  assert.equal(row.legs.length, 2);
  assert.equal(row.contractsText, "40");
  assert.equal(row.theirText, "+900");
  assert.equal(row.ourText, "+850");
  assert.equal(row.status, "quoted");
  assert.equal(row.statusTone, "fill");
  assert.equal(row.fillText, "—");
}

// ── YES price → American when no *_american column ──
{
  const row = mapUnhedgedRow({
    rfq_id: "abc",
    venue: "Polymarket",
    yes_price: 0.2,
    fair: 0.23,
    contracts_fp: "12.5",
    status: "filled",
    fill_price: 0.21,
    legs: ["NYY ML", "BOS ML"],
  });
  assert.equal(row.id, "abc");
  assert.equal(row.venue, "Polymarket");
  assert.equal(row.theirAmerican, 400);
  assert.equal(row.ourAmerican, 335);
  assert.equal(row.fillAmerican, 376);
  assert.equal(row.contractsText, "12.5");
  assert.equal(row.status, "filled");
  assert.equal(row.label, "NYY ML · BOS ML");
}

// ── NO price → YES American ──
{
  const row = mapUnhedgedRow({ no_price: 0.9, label: "solo" });
  assert.equal(row.theirAmerican, 900);
  assert.equal(row.theirText, "+900");
}

// ── Newest first ──
{
  const mapped = mapUnhedgedRows([
    { id: "old", created_at: "2026-09-01T12:00:00.000Z", label: "old" },
    { id: "new", created_at: "2026-09-02T12:00:00.000Z", label: "new" },
  ]);
  assert.equal(mapped[0].id, "new");
  assert.equal(mapped[1].id, "old");
}

// ── Worker columns: our_quote / taker_american (status still seen) ──
{
  const row = mapUnhedgedRow({
    id: "w1",
    venue: "kalshi",
    status: "seen",
    our_quote_american: 178,
    our_fair_american: 201,
    taker_american: 190,
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl", side: "yes", teams: ["atl", "was"] }],
  });
  assert.equal(row.status, "would_quote");
  assert.equal(row.statusTone, "warn");
  assert.equal(row.ourAmerican, 178);
  assert.equal(row.ourText, "+178");
  assert.equal(row.theirAmerican, 190);
  assert.equal(row.fillText, "—");
  assert.equal(row.legs[0].text, "atl");
}

{
  const row = mapUnhedgedRow({
    id: "w2",
    status: "filled",
    fill_yes_price: 0.22,
  });
  assert.equal(row.status, "filled");
  assert.equal(row.statusTone, "ok");
  assert.equal(row.fillAmerican, 355);
  assert.equal(row.fillText, "+355");
}

// ── MLB / NFL moneyline filter (hide ncaaf; spreads out) ──
{
  const mlb = {
    id: "mlb",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const nfl = {
    id: "nfl",
    legs: [{ league: "nfl", symbol: "aec-nfl-ne-sea-2026-09-09", selection: "sea" }],
  };
  const mixed = {
    id: "mix",
    legs: [
      { league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL" },
      { league: "nfl", ticker: "KXNFLGAME-26SEP09NESEA-SEA" },
    ],
  };
  const ncaaf = {
    id: "ncaaf",
    legs: [{ league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" }],
  };
  const mixedNcaaf = {
    id: "mix-ncaaf",
    legs: [
      { league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL" },
      { league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" },
    ],
  };
  const spread = {
    id: "spread",
    legs: [{ league: "mlb", type: "spread", ticker: "KXMLBSPREAD-26SEP02NYYBOS" }],
  };
  assert.equal(isMlbNflMoneylineRow(mlb), true);
  assert.equal(isMlbNflMoneylineRow(nfl), true);
  assert.equal(isMlbNflMoneylineRow(mixed), true);
  assert.equal(isMlbNflMoneylineRow(ncaaf), false);
  assert.equal(isMlbNflMoneylineRow(mixedNcaaf), false);
  assert.equal(isMlbNflMoneylineRow(spread), false);
  assert.equal(isMlbNflMoneylineRow({ id: "empty", legs: [] }), false);
  const kept = filterMlbNflMoneylineRows([mlb, nfl, mixed, ncaaf, mixedNcaaf, spread]);
  assert.deepEqual(kept.map((r) => r.id), ["mlb", "nfl", "mix"]);
}

// ── Summary counts mapped statuses over the filtered list; no invented fills ──
{
  const mapped = mapUnhedgedRows([
    { id: "a", status: "seen", our_quote_american: 150, created_at: "2026-09-02T12:00:00.000Z" },
    { id: "b", status: "seen", created_at: "2026-09-02T11:00:00.000Z" },
    { id: "c", status: "started", created_at: "2026-09-02T10:00:00.000Z" },
    { id: "d", status: "filled", fill_american: -110, created_at: "2026-09-02T09:00:00.000Z" },
  ]);
  const s = summarizeUnhedgedRows(mapped, { fetched: 400 });
  assert.equal(s.fetched, 400);
  assert.equal(s.total, 4);
  assert.equal(s.wouldQuote, 1);
  assert.equal(s.seen, 1);
  assert.equal(s.started, 1);
  assert.equal(s.filled, 1);
  assert.equal(s.quoted, 0);
  assert.equal(mapped[0].id, "a");
}

// ── Missing table / missing user_id column ──
assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingTableError({ code: "42P01", message: 'relation "unhedged_rfqs" does not exist' }), true);
assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), true);
assert.equal(isMissingUserIdColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), true);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.venue does not exist' }), false);

function createSequenceClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, select: null, eq: null, order: null, limit: null, ops: [] };
      calls.push(state);
      const idx = calls.length - 1;
      const chain = {
        select(cols) { state.select = cols; state.ops.push("select"); return chain; },
        eq(col, val) { state.eq = { col, val }; state.ops.push("eq"); return chain; },
        order(col, opts) { state.order = { col, opts }; state.ops.push("order"); return chain; },
        limit(n) { state.limit = n; state.ops.push("limit"); return chain; },
        then(resolve, reject) {
          const r = responses[Math.min(idx, responses.length - 1)];
          return Promise.resolve(r).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function assertOrderBeforeLimit(call) {
  assert.deepEqual(call.order, { col: "created_at", opts: { ascending: false } });
  const orderAt = call.ops.indexOf("order");
  const limitAt = call.ops.indexOf("limit");
  assert.ok(orderAt >= 0, "expected .order()");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt < limitAt, "expected .order() before .limit()");
}

// ── Select * scoped to signed-in user_id ──
{
  const rows = [{ id: "1", user_id: "u1", status: "seen" }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", limit: 50 });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls[0].table, UNHEDGED_TABLE);
  assert.equal(client.calls[0].select, "*");
  assert.deepEqual(client.calls[0].eq, { col: "user_id", val: "u1" });
  assert.equal(client.calls[0].limit, 50);
  assertOrderBeforeLimit(client.calls[0]);
}

// ── No user_id → all rows RLS allows ──
{
  const rows = [{ id: "2", status: "quoted" }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: null });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls[0].eq, null);
  assert.equal(client.calls[0].limit, UNHEDGED_LIMIT);
  assert.equal(UNHEDGED_LIMIT, 400);
  assertOrderBeforeLimit(client.calls[0]);
}

// ── user_id column missing → retry without the filter ──
{
  const rows = [{ id: "3", venue: "kalshi" }];
  const client = createSequenceClient([
    { data: null, error: { code: "42703", message: 'column unhedged_rfqs.user_id does not exist' } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[0].eq, { col: "user_id", val: "u1" });
  assert.equal(client.calls[1].eq, null);
  assertOrderBeforeLimit(client.calls[0]);
  assertOrderBeforeLimit(client.calls[1]);
}

// ── Missing table is an empty blotter, not a throw ──
{
  const client = createSequenceClient([{
    data: null,
    error: { code: "PGRST205", message: "Could not find the table 'public.unhedged_rfqs' in the schema cache" },
  }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, true);
  assert.deepEqual(result.rows, []);
}

{
  const client = createSequenceClient([]);
  client.from = () => { throw { code: "42P01", message: 'relation "unhedged_rfqs" does not exist' }; };
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, true);
  assert.deepEqual(result.rows, []);
}

// ── Other errors stay empty but not "missing table" ──
{
  const client = createSequenceClient([{ data: null, error: { code: "42501", message: "permission denied" } }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.code, "42501");
}

// ── App.jsx: private tab only; Promo Builder / Combo Locks wiring untouched ──
{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /import UnhedgedTape from "\.\/UnhedgedTape"/);
  assert.match(app, /tabStyle\("unhedged"\)/);
  assert.match(app, />Unhedged RFQs</);
  assert.match(app, /activeTab === "unhedged" && user\?\.email === OWNER_EMAIL && <UnhedgedTape user=\{user\} \/>/);
  assert.match(app, /<button style=\{tabStyle\("combo"\)\} onClick=\{\(\) => setActiveTab\("combo"\)\}>Combo Locks<\/button>/);
  assert.match(app, /<button style=\{tabStyle\("missTape"\)\} onClick=\{\(\) => setActiveTab\("missTape"\)\}>Miss tape<\/button>/);
  assert.match(app, /activeTab === "combo" && user\?\.email === OWNER_EMAIL && <ComboLocks user=\{user\} prefill=\{comboPrefill\} \/>/);
  assert.match(app, /activeTab === "promo"/);
  assert.match(app, />Promo Builder</);
}

// ── Page is read-only and not inside Combo Locks ──
{
  const page = fs.readFileSync(path.join(dir, "UnhedgedTape.jsx"), "utf8");
  assert.match(page, /className="uh"/);
  assert.match(page, /Unhedged RFQs/);
  assert.match(page, /read-only/);
  assert.match(page, /No unhedged RFQ tape yet/);
  assert.match(page, /This tab is private/);
  assert.match(page, /Time ET/);
  assert.match(page, /Would-quote/);
  assert.match(page, /MLB and NFL moneyline/);
  assert.match(page, /we are paper/);
  assert.match(page, /is-filled/);
  assert.match(page, /filterMlbNflMoneylineRows/);
  assert.match(page, /summarizeUnhedgedRows/);
  assert.doesNotMatch(page, /NCAAF|ncaaf/);
  assert.doesNotMatch(page, /onSubmit|postQuote|createQuote|type="submit"/);
  assert.doesNotMatch(page, /className="cl"/);
  assert.doesNotMatch(page, /combo_parlays|combo_submissions|combo_fills/);
}

// ── Forbidden Combo Locks files were not edited ──
{
  const forbidden = [
    "ComboLocks.jsx",
    "ComboTape.jsx",
    "comboDesk.js",
    "comboTape.js",
    "comboPrefill.js",
    "comboSettlement.js",
  ];
  for (const name of forbidden) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    assert.doesNotMatch(text, /UnhedgedTape|unhedgedTape|unhedged_rfqs/);
  }
}

console.log("unhedgedTape.test.js: ok");
