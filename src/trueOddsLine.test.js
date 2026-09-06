import assert from "node:assert/strict";
import {
  outcomeSize,
  formatAmericanOdds,
  formatPromoTotalBookOdds,
  formatAvailableDollars,
  formatAvailableSizeClause,
  formatTrueOddsBookLine,
  formatTrueOddsWithBlend,
  formatDepthTrail,
  restLevelsFromLadder,
  blendAskLadderToPayout,
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

// ── depth trail: next 1–2 worse levels; no depth → empty (top line unchanged)
{
  const top = formatTrueOddsBookLine({ odds: 104, bookLabel: "ProphetX", size: 54 });
  assert.equal(top, "+104 on ProphetX · $54 currently available");
  assert.equal(formatDepthTrail(null, { topAmerican: 104 }), "");
  assert.equal(formatDepthTrail([], { topAmerican: 104 }), "");
  assert.equal(formatDepthTrail([{ american: 104, size: 54 }], { topAmerican: 104 }), "", "top-only book → no trail");
  assert.equal(
    formatDepthTrail(
      [{ american: 104, size: 54 }, { american: 100, size: 420 }, { american: -105, size: 1100 }],
      { topAmerican: 104 },
    ),
    "then +100 · $420 · then -105 · $1,100",
  );
  assert.equal(
    formatTrueOddsBookLine({ odds: 104, bookLabel: "ProphetX", size: 54 }),
    "+104 on ProphetX · $54 currently available",
    "adding depth must not change the top line",
  );
  const rest = restLevelsFromLadder(
    [{ american: 104, size: 54 }, { american: 100, size: 420 }, { american: -105, size: 1100 }, { american: -110, size: 9 }],
    { topAmerican: 104, max: 2 },
  );
  assert.equal(rest.length, 2);
  assert.equal(rest[0].american, 100);
  assert.equal(rest[1].american, -105);
  assert.equal(formatDepthTrail([{ american: 100, size: 0 }], { topAmerican: 104 }), "");
  assert.equal(formatDepthTrail([{ american: 110, size: 80 }], { topAmerican: 104 }), "", "better-than-top is not rest");
}

// ── blended $500-profit VWAP on the true-odds line (blended price first; top secondary)
{
  const levels = [
    { american: 200, size: 100 },
    { american: 100, size: 400 },
  ];
  const blend = blendAskLadderToPayout(levels);
  assert.equal(blend.american, 125);
  assert.equal(blend.flag, "blended to $500 payout");
  const line = formatTrueOddsWithBlend({
    odds: 200,
    bookLabel: "Kalshi",
    size: 100,
    levels,
  });
  assert.equal(line.odds, 125);
  assert.notEqual(line.odds, 200, "true-odds line uses VWAP, not thin top");
  assert.equal(line.text, "+125 on Kalshi · blended to $500 payout");
  assert.equal(line.secondary, "top +200 · $100 currently available");
  const short = formatTrueOddsWithBlend({
    odds: 150,
    bookLabel: "Polymarket",
    size: 50,
    levels: [{ american: 150, size: 50 }],
  });
  assert.equal(short.odds, 150);
  assert.equal(
    short.text,
    "+150 on Polymarket · blended · $75 of $500 payout available",
  );
  assert.equal(short.secondary, "top +150 · $50 currently available");
  const empty = formatTrueOddsWithBlend({
    odds: 104,
    bookLabel: "Kalshi",
    size: 54,
    levels: [],
  });
  assert.equal(empty.odds, 104);
  assert.equal(empty.text, "+104 on Kalshi · $54 currently available");
  assert.equal(empty.blend, null);
  const trail = formatDepthTrail(levels, { topAmerican: 200 });
  assert.equal(trail, "then +100 · $400");

  const hedgeLine = formatTrueOddsWithBlend({
    odds: -200,
    bookLabel: "Kalshi",
    size: 100,
    levels: [{ american: -200, size: 100 }, { american: -250, size: 300 }],
    blend: {
      american: -220,
      flag: "blended to $333.33 hedge",
      levelsUsed: 2,
      complete: true,
      lowLiquidity: false,
    },
  });
  assert.equal(hedgeLine.odds, -220);
  assert.match(hedgeLine.text, /blended to \$333\.33 hedge/);
  assert.equal(hedgeLine.secondary, "top -200 · $100 currently available");
  assert.equal(hedgeLine.lowLiquidity, false);

  // Ole Miss: −111 · $1,896 top alone covers $500 profit — no blend tag
  const oleMiss = formatTrueOddsWithBlend({
    odds: -111,
    bookLabel: "Novig",
    size: 1896,
    levels: [{ american: -111, size: 1896 }],
  });
  assert.equal(oleMiss.odds, -111);
  assert.equal(oleMiss.blend.complete, true);
  assert.equal(oleMiss.blend.flag, "");
  assert.equal(oleMiss.text, "-111 on Novig · $1,896 currently available");
  assert.doesNotMatch(oleMiss.text, /blended/);
  assert.equal(oleMiss.secondary, "");

  const topOnlyHedge = formatTrueOddsWithBlend({
    odds: -200,
    bookLabel: "Kalshi",
    size: 400,
    blend: {
      american: -200,
      flag: "blended to $333.33 hedge",
      levelsUsed: 1,
      complete: true,
      lowLiquidity: false,
    },
  });
  assert.equal(topOnlyHedge.text, "-200 on Kalshi · $400 currently available");
  assert.doesNotMatch(topOnlyHedge.text, /blended/);
  assert.equal(topOnlyHedge.secondary, "");
  const shortHedge = formatTrueOddsWithBlend({
    odds: -200,
    bookLabel: "Novig",
    size: 100,
    blend: {
      american: -200,
      flag: "blended · $100 of $333.33 hedge available",
      lowLiquidity: true,
    },
  });
  assert.equal(shortHedge.lowLiquidity, true);
  assert.match(shortHedge.text, /of \$333\.33 hedge available/);
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
