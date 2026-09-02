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
  formatAmount,
  formatCashSize,
  formatEtTime,
  formatScanAmerican,
  formatUnhedgedLeg,
  formatUnhedgedLegName,
  formatVenue,
  fairAmerican,
  filterFilledUnhedgedRows,
  isFilledUnhedgedRow,
  isMissingStatusColumn,
  legFairAmerican,
  isMissingFilledAtColumn,
  isMissingTableError,
  isMissingUserIdColumn,
  sortUnhedgedRows,
  isTickerBlob,
  filterMlbNflMoneylineRows,
  isMlbNflMoneylineRow,
  mapUnhedgedRow,
  mapUnhedgedRows,
  normalizeStatus,
  ourQuoteAmerican,
  rowStatus,
  resolveTeamToken,
  summarizeUnhedgedRows,
  teamDisplayName,
  visibleUnhedgedRows,
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
assert.equal(rowStatus({ fair_american: 250 }), "seen");
assert.equal(rowStatus({ our_fair_american: 250 }), "seen");
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
  assert.equal(row.label, "Yanks ML · Red Sox ML");
  assert.equal(row.legs.length, 2);
  assert.equal(row.legs[0].text, "Yanks ML");
  assert.equal(row.legs[1].text, "Red Sox ML");
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
  assert.equal(row.ourAmerican, null);
  assert.equal(row.ourText, "—");
  assert.equal(row.fairAmerican, null);
  assert.equal(row.fairText, "—");
  assert.equal(row.fillAmerican, 376);
  assert.equal(row.contractsText, "12.5");
  assert.equal(row.amountText, "12.5");
  assert.equal(row.status, "filled");
  assert.equal(row.label, "Yanks ML · Red Sox ML");
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

// ── Client sort: filled first by filled_at, then created_at ──
{
  const mapped = mapUnhedgedRows([
    { id: "seen-new", status: "seen", created_at: "2026-09-02T16:00:00.000Z" },
    {
      id: "fill-later",
      status: "filled",
      fill_american: -110,
      created_at: "2026-09-02T08:00:00.000Z",
      filled_at: "2026-09-02T16:26:00.000Z",
    },
    {
      id: "fill-earlier",
      status: "filled",
      fill_american: 200,
      created_at: "2026-09-02T07:00:00.000Z",
      filled_at: "2026-09-02T16:24:00.000Z",
    },
  ]);
  assert.equal(mapped[0].id, "fill-later");
  assert.equal(mapped[1].id, "fill-earlier");
  assert.equal(mapped[2].id, "seen-new");
  assert.equal(mapped[0].filledAt, "2026-09-02T16:26:00.000Z");
  const resorted = sortUnhedgedRows(mapped.slice().reverse());
  assert.deepEqual(resorted.map((r) => r.id), ["fill-later", "fill-earlier", "seen-new"]);
  const s = summarizeUnhedgedRows(mapped, { fetched: 400 });
  assert.equal(s.fetched, 400);
  assert.equal(s.filled, 2);
  assert.equal(s.seen, 1);
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
  assert.equal(row.fairAmerican, 201);
  assert.equal(row.fairText, "+201");
  assert.equal(row.theirAmerican, 190);
  assert.equal(row.fillText, "—");
  assert.equal(row.legs[0].text, "Braves ML");
  assert.equal(row.label, "Braves ML");
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

// ── Filled row maps contracts, cash_size, fill, fair, would-quote (no invent) ──
assert.equal(formatCashSize(25), "$25");
assert.equal(formatCashSize(12.5), "$12.50");
assert.equal(formatAmount(40, 25), "40 · $25");
assert.equal(formatAmount(40, null), "40");
assert.equal(formatAmount(null, 12.5), "$12.50");
assert.equal(formatAmount(null, null), "—");
assert.equal(ourQuoteAmerican({ our_quote_american: 178, our_fair_american: 201 }), 178);
assert.equal(fairAmerican({ our_quote_american: 178, our_fair_american: 201 }), 201);
assert.equal(ourQuoteAmerican({ our_fair_american: 201 }), null);
assert.equal(fairAmerican({ our_quote_american: 178 }), null);
{
  const row = mapUnhedgedRow({
    id: "fill-map",
    status: "filled",
    venue: "kalshi",
    filled_at: "2026-09-02T16:26:00.000Z",
    created_at: "2026-09-02T08:00:00.000Z",
    contracts: 40,
    cash_size: 12.5,
    fill_american: -110,
    our_fair_american: 201,
    our_quote_american: 178,
    legs: [{ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", fair_american: 145 }],
  });
  assert.equal(row.status, "filled");
  assert.equal(row.contracts, 40);
  assert.equal(row.cashSize, 12.5);
  assert.equal(row.amountText, "40 · $12.50");
  assert.equal(row.fillAmerican, -110);
  assert.equal(row.fillText, "-110");
  assert.equal(row.fairAmerican, 201);
  assert.equal(row.fairText, "+201");
  assert.equal(row.ourAmerican, 178);
  assert.equal(row.ourText, "+178");
  assert.equal(row.legs[0].text, "Rockies ML +145");
  assert.notEqual(row.fairText, row.fillText);
  assert.notEqual(row.fairText, row.ourText);
}

// ── Spoken parlay names from Kalshi tickers (COL + yes → Rockies ML) ──
assert.equal(isTickerBlob("KXMLBGAME-26SEP021510BALCOL-COL"), true);
assert.equal(isTickerBlob("KXNFLGAME-26SEP09NEKC-KC"), true);
assert.equal(isTickerBlob("KXMVE-SOMETHING"), true);
assert.equal(isTickerBlob("Rockies ML"), false);
assert.equal(isTickerBlob("Nats ML · Rangers ML"), false);
assert.equal(teamDisplayName("COL", "mlb"), "Rockies");
assert.equal(teamDisplayName("WSH", "mlb"), "Nats");
assert.equal(teamDisplayName("WAS", "mlb"), "Nats");
assert.equal(teamDisplayName("NYY", "mlb"), "Yanks");
assert.equal(teamDisplayName("KC", "mlb"), "Royals");
assert.equal(teamDisplayName("KC", "nfl"), "Chiefs");
assert.equal(teamDisplayName("PHI", "nfl"), "Eagles");
assert.equal(teamDisplayName("rockies", "mlb"), "Rockies");
assert.equal(teamDisplayName("orioles", "mlb"), "Orioles");
assert.equal(teamDisplayName("red-sox", "mlb"), "Red Sox");
assert.equal(teamDisplayName("white-sox", "mlb"), "White Sox");
assert.equal(teamDisplayName("nats", "mlb"), "Nats");
assert.equal(teamDisplayName("yankees", "mlb"), "Yanks");
assert.equal(teamDisplayName("chiefs", "nfl"), "Chiefs");
assert.equal(teamDisplayName("eagles", "nfl"), "Eagles");
assert.equal(teamDisplayName("49ers", "nfl"), "Niners");
assert.equal(resolveTeamToken("COL", "mlb"), "COL");
assert.equal(resolveTeamToken("rockies", "mlb"), "COL");
assert.equal(resolveTeamToken("kc", "nfl"), "KC");
assert.equal(resolveTeamToken("aec-mlb-bal-col-2026-09-02-col", "mlb"), "COL");
assert.equal(resolveTeamToken("aec-mlb-bal-col-2026-09-02-rockies", "mlb"), "COL");
assert.equal(
  formatUnhedgedLeg({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "yes",
    league: "mlb",
    fair_american: 145,
  }),
  "Rockies ML +145",
);
assert.equal(formatScanAmerican(-118), "\u2212118");
assert.equal(legFairAmerican({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes" }), null);
assert.equal(legFairAmerican({ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", fair_american: 145 }), 145);

{
  const row = mapUnhedgedRow({
    id: "col-yes",
    venue: "kalshi",
    ticker: "KXMVE-COMBO-SHOULD-HIDE",
    legs: [{
      ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
      symbol: "KXMLBGAME-26SEP021510BALCOL-COL",
      side: "yes",
      league: "mlb",
      selection: "COL",
      teams: ["BAL", "COL"],
      date: "2026-09-02",
    }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.label, "Rockies ML");
  assert.doesNotMatch(row.label, /KXMLB|KXMVE|BALCOL/);
  assert.doesNotMatch(row.legs[0].text, /KXMLB|BALCOL|COL-/);
}

{
  const noOpp = formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "no",
    league: "mlb",
    teams: ["BAL", "COL"],
  });
  assert.equal(noOpp, "Orioles ML");
  const noSolo = formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "no",
    league: "mlb",
  });
  assert.equal(noSolo, "Rockies lose");
}

{
  const row = mapUnhedgedRow({
    ticker: "KXMVE-HIDE-ME",
    label: "KXMLBGAME-26SEP021510WSHTEX-WSH",
    legs: [
      { ticker: "KXMLBGAME-26SEP021510WSHTEX-WSH", side: "yes", league: "mlb", selection: "wsh", teams: ["wsh", "tex"] },
      { ticker: "KXMLBGAME-26SEP021510TEXHOU-TEX", side: "yes", league: "mlb", selection: "tex" },
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", selection: "col" },
    ],
  });
  assert.equal(row.label, "Nats ML · Rangers ML · Rockies ML");
  assert.deepEqual(row.legs.map((l) => l.text), ["Nats ML", "Rangers ML", "Rockies ML"]);
  for (const chip of row.legs) {
    assert.equal(isTickerBlob(chip.text), false);
    assert.doesNotMatch(chip.text, /KXMLB|KXNFL|KXMVE/);
  }
}

{
  const row = mapUnhedgedRow({
    legs: [{ ticker: "KXNFLGAME-26SEP09NEKC-KC", side: "yes", league: "nfl", selection: "kc", teams: ["ne", "kc"] }],
  });
  assert.equal(row.legs[0].text, "Chiefs ML");
  assert.equal(row.label, "Chiefs ML");
}

{
  const row = mapUnhedgedRow({
    legs: [{ ticker: "KXNFLGAME-26SEP09PHIKC-PHI", side: "no", league: "nfl", teams: ["phi", "kc"] }],
  });
  assert.equal(row.legs[0].text, "Chiefs ML");
}

// ── Polymarket worker legs: symbol/slug, no ticker; last token is the pick ──
assert.equal(isTickerBlob("aec-mlb-bal-col-2026-09-02-col"), true);
assert.equal(isTickerBlob("aec-mlb-bal-col-2026-09-02-rockies"), true);
assert.equal(isTickerBlob("aec-nfl-phi-kc-2026-09-09-chiefs"), true);
assert.equal(
  formatUnhedgedLegName({ symbol: "aec-mlb-bal-col-2026-09-02-col", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLegName({ symbol: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({ symbol: "aec-mlb-bal-col-2026-09-02-col", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({ slug: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb" }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    ticker: "KXMLBGAME-26SEP021510BALCOL-COL",
    side: "yes",
    league: "mlb",
  }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02",
    selection: "rockies",
    side: "yes",
    league: "mlb",
  }),
  "Rockies ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bos-cws-2026-09-02-red-sox",
    side: "yes",
    league: "mlb",
  }),
  "Red Sox ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bos-cws-2026-09-02-white-sox",
    side: "yes",
    league: "mlb",
  }),
  "White Sox ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-wsh-nyy-2026-09-02-nats",
    side: "yes",
    league: "mlb",
  }),
  "Nats ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-wsh-nyy-2026-09-02-yankees",
    side: "yes",
    league: "mlb",
  }),
  "Yanks ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-kc-2026-09-09-chiefs",
    side: "yes",
    league: "nfl",
  }),
  "Chiefs ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-kc-2026-09-09-kc",
    side: "yes",
    league: "nfl",
  }),
  "Chiefs ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-sf-2026-09-09-eagles",
    side: "yes",
    league: "nfl",
  }),
  "Eagles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-nfl-phi-sf-2026-09-09-49ers",
    side: "yes",
    league: "nfl",
  }),
  "Niners ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
    teams: ["orioles", "rockies"],
  }),
  "Orioles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
    teams: ["bal", "col"],
  }),
  "Orioles ML",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "no",
    league: "mlb",
  }),
  "Rockies lose",
);
assert.equal(
  formatUnhedgedLeg({
    symbol: "aec-mlb-bal-col-2026-09-02-rockies",
    side: "yes",
    league: "mlb",
    fair_american: 145,
  }),
  "Rockies ML +145",
);

{
  const row = mapUnhedgedRow({
    id: "poly-col",
    venue: "polymarket",
    legs: [{
      symbol: "aec-mlb-bal-col-2026-09-02-col",
      side: "yes",
      league: "mlb",
      selection: "col",
      teams: ["bal", "col"],
      fair_american: 145,
    }],
  });
  assert.equal(row.venue, "Polymarket");
  assert.equal(row.legs[0].text, "Rockies ML +145");
  assert.equal(row.label, "Rockies ML +145");
  assert.doesNotMatch(row.label, /aec-mlb|KXMLB|BALCOL/);
}

{
  const row = mapUnhedgedRow({
    id: "poly-rockies",
    venue: "poly",
    legs: [{
      symbol: "aec-mlb-bal-col-2026-09-02-rockies",
      side: "yes",
      league: "mlb",
      selection: "rockies",
      teams: ["orioles", "rockies"],
    }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.label, "Rockies ML");
}

{
  const row = mapUnhedgedRow({
    venue: "polymarket",
    our_fair_american: 400,
    legs: [
      { symbol: "aec-mlb-bal-col-2026-09-02-rockies", side: "yes", league: "mlb", selection: "rockies", fair_american: 145 },
      { symbol: "aec-nfl-phi-kc-2026-09-09-chiefs", side: "yes", league: "nfl", selection: "chiefs", fair_american: -118 },
    ],
  });
  assert.equal(row.label, "Rockies ML +145 · Chiefs ML \u2212118");
  assert.deepEqual(row.legs.map((l) => l.text), ["Rockies ML +145", "Chiefs ML \u2212118"]);
  assert.equal(row.ourText, "—");
  assert.equal(row.fairText, "+400");
}

// ── Per-leg fair (worker fields only; row our_fair_american is the parlay) ──
{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    our_quote_american: 380,
    ticker: "KXMVE-PARLAY",
    legs: [
      { ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb", fair_american: 145 },
      { ticker: "KXMLBGAME-26SEP021510BOSNYY-BOS", side: "yes", league: "mlb", our_fair_american: -118 },
      { ticker: "KXMLBGAME-26SEP021510PITMIL-PIT", side: "yes", league: "mlb", true_american: -133 },
    ],
  });
  assert.equal(row.label, "Rockies ML +145 · Red Sox ML \u2212118 · Pirates ML \u2212133");
  assert.deepEqual(row.legs.map((l) => l.text), [
    "Rockies ML +145",
    "Red Sox ML \u2212118",
    "Pirates ML \u2212133",
  ]);
  assert.equal(row.ourAmerican, 380);
  assert.equal(row.ourText, "+380");
  assert.equal(row.fairAmerican, 400);
  assert.equal(row.fairText, "+400");
  for (const chip of row.legs) {
    assert.doesNotMatch(chip.text, /KXMLB|KXMVE|\+400|\+380/);
  }
}

{
  const row = mapUnhedgedRow({
    our_fair_american: 400,
    legs: [{ ticker: "KXMLBGAME-26SEP021510BALCOL-COL", side: "yes", league: "mlb" }],
  });
  assert.equal(row.legs[0].text, "Rockies ML");
  assert.equal(row.label, "Rockies ML");
  assert.equal(row.ourText, "—");
  assert.equal(row.fairText, "+400");
  assert.doesNotMatch(row.legs[0].text, /\+400|\+145|145/);
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
  assert.equal(s.withQuote, 1);
  assert.equal(mapped[0].id, "d");
  assert.equal(mapped[1].id, "a");
}

// ── Seen / started / would_quote are not shown; NCAAF filled stays hidden ──
{
  const seen = {
    id: "seen",
    status: "seen",
    created_at: "2026-09-02T16:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const started = {
    id: "started",
    status: "started",
    created_at: "2026-09-02T15:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const would = {
    id: "would",
    status: "would_quote",
    our_quote_american: 150,
    created_at: "2026-09-02T14:00:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const filledMlb = {
    id: "filled-mlb",
    status: "filled",
    fill_american: -110,
    our_fair_american: 201,
    our_quote_american: 178,
    contracts: 40,
    cash_size: 25,
    filled_at: "2026-09-02T16:26:00.000Z",
    legs: [{ league: "mlb", ticker: "KXMLBGAME-26SEP021305ATLWSH-ATL", selection: "atl" }],
  };
  const filledNcaaf = {
    id: "filled-ncaaf",
    status: "filled",
    fill_american: 200,
    filled_at: "2026-09-02T16:30:00.000Z",
    legs: [{ league: "ncaaf", ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG" }],
  };
  assert.equal(isFilledUnhedgedRow(seen), false);
  assert.equal(isFilledUnhedgedRow(started), false);
  assert.equal(isFilledUnhedgedRow(would), false);
  assert.equal(isFilledUnhedgedRow(filledMlb), true);
  assert.deepEqual(filterFilledUnhedgedRows([seen, started, would, filledMlb, filledNcaaf]).map((r) => r.id), ["filled-mlb", "filled-ncaaf"]);
  const shown = visibleUnhedgedRows([seen, started, would, filledMlb, filledNcaaf]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "filled-mlb");
  assert.equal(shown[0].fillAmerican, -110);
  assert.equal(shown[0].fairAmerican, 201);
  assert.equal(shown[0].ourAmerican, 178);
  assert.equal(shown[0].amountText, "40 · $25");
  assert.equal(shown.some((r) => r.id === "seen" || r.status === "seen"), false);
}

// ── Missing table / missing user_id column ──
assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingTableError({ code: "42P01", message: 'relation "unhedged_rfqs" does not exist' }), true);
assert.equal(isMissingTableError({ code: "42501", message: "permission denied" }), false);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), true);
assert.equal(isMissingUserIdColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), true);
assert.equal(isMissingUserIdColumn({ code: "42703", message: 'column unhedged_rfqs.venue does not exist' }), false);
assert.equal(isMissingFilledAtColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingFilledAtColumn({ code: "42703", message: 'column unhedged_rfqs.filled_at does not exist' }), true);
assert.equal(isMissingFilledAtColumn({ code: "PGRST204", message: "Could not find the 'user_id' column" }), false);
assert.equal(isMissingStatusColumn({ code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" }), true);
assert.equal(isMissingStatusColumn({ code: "42703", message: 'column unhedged_rfqs.status does not exist' }), true);
assert.equal(isMissingStatusColumn({ code: "42703", message: 'column unhedged_rfqs.user_id does not exist' }), false);
assert.equal(isMissingStatusColumn({ code: "PGRST204", message: "Could not find the 'filled_at' column" }), false);

function createSequenceClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, select: null, eq: null, eqs: [], order: null, orders: [], limit: null, ops: [] };
      calls.push(state);
      const idx = calls.length - 1;
      const chain = {
        select(cols) { state.select = cols; state.ops.push("select"); return chain; },
        eq(col, val) {
          const entry = { col, val };
          state.eq = entry;
          state.eqs.push(entry);
          state.ops.push("eq");
          return chain;
        },
        order(col, opts) {
          const entry = { col, opts };
          state.order = entry;
          state.orders.push(entry);
          state.ops.push("order");
          return chain;
        },
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

function orderIndexes(call) {
  const at = [];
  (call.ops || []).forEach((op, i) => { if (op === "order") at.push(i); });
  return at;
}

function assertFilledThenCreatedBeforeLimit(call) {
  assert.deepEqual(call.orders, [
    { col: "filled_at", opts: { ascending: false, nullsFirst: false } },
    { col: "created_at", opts: { ascending: false } },
  ]);
  const orderAt = orderIndexes(call);
  const limitAt = call.ops.indexOf("limit");
  assert.equal(orderAt.length, 2, "expected .order(filled_at) then .order(created_at)");
  assert.ok(orderAt[0] < orderAt[1], "expected filled_at order before created_at order");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt[1] < limitAt, "expected both .order() calls before .limit()");
}

function hasEq(call, col, val) {
  return (call.eqs || []).some((e) => e.col === col && e.val === val);
}

function assertStatusFilledEq(call) {
  assert.equal(hasEq(call, "status", "filled"), true, "expected .eq('status', 'filled')");
}

function assertNoStatusEq(call) {
  assert.equal((call.eqs || []).some((e) => e.col === "status"), false, "expected no status filter");
}

function assertCreatedAtOnlyBeforeLimit(call) {
  assert.deepEqual(call.orders, [
    { col: "created_at", opts: { ascending: false } },
  ]);
  const orderAt = call.ops.indexOf("order");
  const limitAt = call.ops.indexOf("limit");
  assert.ok(orderAt >= 0, "expected .order()");
  assert.ok(limitAt >= 0, "expected .limit()");
  assert.ok(orderAt < limitAt, "expected .order() before .limit()");
}

// ── Select * scoped to signed-in user_id, status=filled, filled_at desc ──
{
  const rows = [{ id: "1", user_id: "u1", status: "filled", fill_american: -110 }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1", limit: 50 });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls[0].table, UNHEDGED_TABLE);
  assert.equal(client.calls[0].select, "*");
  assert.equal(hasEq(client.calls[0], "user_id", "u1"), true);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(client.calls[0].limit, 50);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
}

// ── No user_id → status=filled only, RLS allows ──
{
  const rows = [{ id: "2", status: "filled", fill_american: 200 }];
  const client = createSequenceClient([{ data: rows, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: null });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(hasEq(client.calls[0], "user_id", "u1"), false);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(client.calls[0].limit, UNHEDGED_LIMIT);
  assert.equal(UNHEDGED_LIMIT, 400);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
}

// ── Seen rows from the wire are dropped even if the query leaked them ──
{
  const mixed = [
    { id: "seen", status: "seen" },
    { id: "started", status: "started" },
    { id: "would", status: "would_quote", our_quote_american: 150 },
    { id: "filled", status: "filled", fill_american: -110 },
  ];
  const client = createSequenceClient([{ data: mixed, error: null }]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assertStatusFilledEq(client.calls[0]);
  assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
}

// ── user_id column missing → retry without the filter, keep status=filled ──
{
  const rows = [{ id: "3", venue: "kalshi", status: "filled", fill_american: 180 }];
  const client = createSequenceClient([
    { data: null, error: { code: "42703", message: 'column unhedged_rfqs.user_id does not exist' } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 2);
  assert.equal(hasEq(client.calls[0], "user_id", "u1"), true);
  assertStatusFilledEq(client.calls[0]);
  assert.equal(hasEq(client.calls[1], "user_id", "u1"), false);
  assertStatusFilledEq(client.calls[1]);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
  assertFilledThenCreatedBeforeLimit(client.calls[1]);
}

// ── filled_at missing (PGRST204) → retry created_at only, same user_id ──
{
  const rows = [{ id: "4", status: "filled", fill_american: -110 }];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'filled_at' column of 'unhedged_rfqs' in the schema cache" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 2);
  assert.equal(hasEq(client.calls[0], "user_id", "u1"), true);
  assert.equal(hasEq(client.calls[1], "user_id", "u1"), true);
  assertStatusFilledEq(client.calls[0]);
  assertStatusFilledEq(client.calls[1]);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
  assertCreatedAtOnlyBeforeLimit(client.calls[1]);
}

// ── filled_at missing then user_id missing → created_at only, unscoped, still filled ──
{
  const rows = [{ id: "5", status: "filled", fill_american: -105 }];
  const client = createSequenceClient([
    { data: null, error: { code: "42703", message: 'column unhedged_rfqs.filled_at does not exist' } },
    { data: null, error: { code: "PGRST204", message: "Could not find the 'user_id' column" } },
    { data: rows, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows, rows);
  assert.equal(client.calls.length, 3);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
  assertCreatedAtOnlyBeforeLimit(client.calls[1]);
  assertCreatedAtOnlyBeforeLimit(client.calls[2]);
  assert.equal(hasEq(client.calls[2], "user_id", "u1"), false);
  assertStatusFilledEq(client.calls[2]);
}

// ── status filter missing → retry without it, client-filter filled ──
{
  const mixed = [
    { id: "seen", status: "seen" },
    { id: "filled", status: "filled", fill_american: 220 },
  ];
  const client = createSequenceClient([
    { data: null, error: { code: "PGRST204", message: "Could not find the 'status' column of 'unhedged_rfqs' in the schema cache" } },
    { data: mixed, error: null },
  ]);
  const result = await fetchUnhedgedRfqs(client, { userId: "u1" });
  assert.equal(result.missingTable, false);
  assert.deepEqual(result.rows.map((r) => r.id), ["filled"]);
  assert.equal(client.calls.length, 2);
  assertStatusFilledEq(client.calls[0]);
  assertNoStatusEq(client.calls[1]);
  assert.equal(hasEq(client.calls[1], "user_id", "u1"), true);
  assertFilledThenCreatedBeforeLimit(client.calls[0]);
  assertFilledThenCreatedBeforeLimit(client.calls[1]);
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
  assert.match(page, />Amount</);
  assert.match(page, /Fill price/);
  assert.match(page, /True \/ fair/);
  assert.match(page, />Would-quote</);
  assert.match(page, /isTickerBlob/);
  assert.match(page, /filled MLB or NFL moneyline/);
  assert.match(page, /We did not take these/);
  assert.match(page, /paper only/);
  assert.match(page, /visibleUnhedgedRows/);
  assert.match(page, /summarizeUnhedgedRows/);
  assert.match(page, /newest fill first/);
  assert.doesNotMatch(page, /Would-quote \/ Fair/);
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
