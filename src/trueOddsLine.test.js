import assert from "node:assert/strict";
import {
  outcomeSize,
  formatAmericanOdds,
  formatPromoTotalBookOdds,
  formatAvailableDollars,
  formatAvailableSizeClause,
  formatTrueOddsBookLine,
} from "./trueOddsLine.js";
import { transformOddsData, transformEventOddsData } from "./oddsTransform.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ALL_BOOKS, TRUSTED_BOOK_KEYS, buildAllLegsForBook } = require("../lib/promo-ev.js");

// ── outcomeSize: real fields only, never invent
{
  assert.equal(outcomeSize({ size: 1250 }), 1250);
  assert.equal(outcomeSize({ bet_limit: 80 }), 80);
  assert.equal(outcomeSize({ size: "1250.4" }), 1250.4);
  assert.equal(outcomeSize({ size: 1250, bet_limit: 9 }), 1250, "prefer size over bet_limit");
  assert.equal(outcomeSize({ bet_limit: "2500" }), 2500);
  assert.equal(outcomeSize({}), null);
  assert.equal(outcomeSize(null), null);
  assert.equal(outcomeSize({ size: 0 }), null);
  assert.equal(outcomeSize({ bet_limit: -10 }), null);
  assert.equal(outcomeSize({ size: "nope" }), null);
  assert.equal(outcomeSize({ size: Infinity }), null);
}

// ── dollar + clause: commas, no $ when unknown
{
  assert.equal(formatAvailableDollars(1250), "$1,250");
  assert.equal(formatAvailableDollars(80), "$80");
  assert.equal(formatAvailableDollars(1000000), "$1,000,000");
  assert.equal(formatAvailableDollars(1250.4), "$1,250");
  assert.equal(formatAvailableDollars(null), null);
  assert.equal(formatAvailableDollars(0), null);
  assert.equal(formatAvailableDollars(undefined), null);
  assert.equal(formatAvailableSizeClause(1250), " · $1,250 currently available");
  assert.equal(formatAvailableSizeClause(null), "");
  assert.equal(formatAvailableSizeClause(0), "");
}

// ── book line: size present vs missing
{
  assert.equal(
    formatTrueOddsBookLine({ odds: -120, bookLabel: "Novig", size: 1250 }),
    "-120 on Novig · $1,250 currently available"
  );
  assert.equal(
    formatTrueOddsBookLine({ odds: 105, bookLabel: "ProphetX", size: 80 }),
    "+105 on ProphetX · $80 currently available"
  );
  assert.equal(
    formatTrueOddsBookLine({ odds: -120, bookLabel: "Novig" }),
    "-120 on Novig"
  );
  assert.equal(
    formatTrueOddsBookLine({ odds: -120, bookLabel: "Novig", size: null }),
    "-120 on Novig"
  );
  assert.equal(
    formatTrueOddsBookLine({ odds: -110, bookLabel: "FanDuel", size: 0 }),
    "-110 on FanDuel"
  );
  assert.equal(formatAmericanOdds(120), "+120");
  assert.equal(formatAmericanOdds(-120), "-120");
}

// ── American odds: +plus / −minus, never "+-105"
{
  assert.equal(formatAmericanOdds(120), "+120");
  assert.equal(formatAmericanOdds(-105), "-105");
  assert.equal(formatAmericanOdds(-101), "-101");
  assert.equal(formatAmericanOdds("+120"), "+120");
  assert.equal(formatAmericanOdds("-105"), "-105");
  assert.equal(formatAmericanOdds("+-105"), "-105");
  assert.equal(formatAmericanOdds(null), "—");
  assert.equal(formatAmericanOdds(0), "—");
  for (const sample of [120, -105, -101, "+120", "-101", "+-105"]) {
    assert.ok(!formatAmericanOdds(sample).includes("+-"), `no +- prefix for ${sample}`);
  }
}

// ── Promo Total sportsbook cell: boosted finals, screenshot Pinnacle -105 → -101
{
  assert.equal(formatPromoTotalBookOdds(-101), "-101");
  assert.equal(formatPromoTotalBookOdds(150), "+150");
  assert.notEqual(formatPromoTotalBookOdds(-101), "+-105");
  assert.notEqual(formatPromoTotalBookOdds(-101), "-105");
  assert.ok(!formatPromoTotalBookOdds(-101).includes("+-"));
}

// ── transformOddsData: Novig bet_limit rides through as bestOppSize
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "pinnacle",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -115 }, { name: "Red Sox", price: 105 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: -110, point: -1.5 }, { name: "Red Sox", price: -110, point: 1.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -105, point: 8.5 }, { name: "Under", price: -115, point: 8.5 }] },
        ],
      },
      {
        key: "novig",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Yankees", price: -118, bet_limit: 400 },
              { name: "Red Sox", price: 120, bet_limit: 1250 },
            ],
          },
          {
            key: "spreads",
            outcomes: [
              { name: "Yankees", price: -105, point: -1.5, size: 900 },
              { name: "Red Sox", price: -105, point: 1.5, size: 300 },
            ],
          },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: 100, point: 8.5, bet_limit: 50 },
              { name: "Under", price: -120, point: 8.5 },
            ],
          },
        ],
      },
    ],
  }];
  const data = transformOddsData(games, "baseball_mlb", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const pinLegs = buildAllLegsForBook(data, "pinnacle");
  const yankeesMl = pinLegs.find(l => l.name === "Yankees ML");
  assert.ok(yankeesMl);
  assert.equal(yankeesMl.bestOpp, 120);
  assert.equal(yankeesMl.bestOppBook, "novig");
  assert.equal(yankeesMl.bestOppSize, 1250);

  const soxMl = pinLegs.find(l => l.name === "Red Sox ML");
  assert.equal(soxMl.bestOppBook, "pinnacle");
  assert.equal(soxMl.bestOppSize, null, "Pinnacle has no size — do not invent");

  const yankeesSpr = pinLegs.find(l => l.name === "Yankees -1.5");
  assert.equal(yankeesSpr.bestOppBook, "novig");
  assert.equal(yankeesSpr.bestOpp, -105);
  assert.equal(yankeesSpr.bestOppSize, 300);

  const over = pinLegs.find(l => l.name === "Yankees/Red Sox o8.5");
  assert.equal(over.bestOppBook, "pinnacle");
  assert.equal(over.bestOppSize, null, "best opp Under is Pinnacle with no size");

  const under = pinLegs.find(l => l.name === "Yankees/Red Sox u8.5");
  assert.equal(under.bestOppBook, "novig");
  assert.equal(under.bestOppSize, 50);
}

// ── alt-line event odds: size on the winning opp outcome only
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const game = {
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          {
            key: "alternate_spreads",
            outcomes: [
              { name: "Yankees", price: 120, point: -2.5 },
              { name: "Red Sox", price: -140, point: 2.5 },
            ],
          },
        ],
      },
      {
        key: "prophetx",
        markets: [
          {
            key: "alternate_spreads",
            outcomes: [
              { name: "Yankees", price: 110, point: -2.5, bet_limit: 75 },
              { name: "Red Sox", price: -130, point: 2.5, bet_limit: 2100 },
            ],
          },
        ],
      },
    ],
  };
  const data = transformEventOddsData(game, "baseball_mlb", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const dkLegs = buildAllLegsForBook(data, "draftkings");
  const yankees = dkLegs.find(l => l.name === "Yankees -2.5");
  assert.ok(yankees);
  assert.equal(yankees.bestOppBook, "prophetx");
  assert.equal(yankees.bestOpp, -130);
  assert.equal(yankees.bestOppSize, 2100);
}

console.log("trueOddsLine.test.js ok");
