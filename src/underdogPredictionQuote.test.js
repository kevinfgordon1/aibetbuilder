import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  applyUnderdogLobbyPredictions,
  applyUnderdogPhoneQuotes,
  classifyUnderdogLineMarket,
  findUnderdogPhoneGame,
  predictionOnlyBookmakerFromQuotes,
  predictionQuoteFromOption,
  predictionQuotesFromPayload,
  UNDERDOG_PHONE_COMMENCE_WINDOW_MS,
} from "./underdogPredictionQuote.js";

const require = createRequire(import.meta.url);
const cjsQuotes = require("../lib/underdog-prediction-quote.js");

const giantsOption = {
  selection_header: "New York Giants",
  choice_display: "New York Giants",
  american_price: "+252",
  decimal_price: "3.52",
  odds: {
    prediction: { american: "+245", decimal: "3.45", probability: 27 },
    fantasy: { american: "+252", decimal: "3.52", probability: "27" },
  },
};

{
  const quote = predictionQuoteFromOption(giantsOption);
  assert.equal(quote.american, 245, "odds.prediction wins over american_price and odds.fantasy");
  assert.equal(quote.decimal, 3.45);
  assert.equal(quote.probability, 0.27);
  assert.equal(quote.updatedAt, null);
}

{
  const miamiTs = Date.parse("2026-09-13T02:16:09.235Z");
  const cmuTs = Date.parse("2026-09-21T19:35:16.513Z");
  const miami = predictionQuoteFromOption({
    selection_header: "Miami (FL) Hurricanes",
    updated_at: cmuTs,
    odds: { prediction: { american: "-1112", decimal: "1.09", updatedAt: "2026-09-13T02:16:09.235Z" } },
  });
  assert.equal(miami.american, -1112);
  assert.equal(miami.updatedAt, miamiTs, "odds.prediction.updatedAt is the quote clock");
  const cmu = predictionQuoteFromOption({
    selection_header: "Central Michigan Chippewas",
    updated_at: "2026-09-21T19:35:16.513Z",
    odds: { prediction: { american: "+3230", decimal: "33.3" } },
  });
  assert.equal(cmu.updatedAt, cmuTs, "option updated_at is used when prediction has no clock");
  assert.equal(cjsQuotes.predictionQuoteFromOption({
    selection_header: "Miami (FL) Hurricanes",
    odds: { prediction: { american: "-1112", updatedAt: "2026-09-13T02:16:09.235Z" } },
  }).updatedAt, miamiTs);
}

{
  const quote = predictionQuoteFromOption({
    selection_header: "Los Angeles Rams",
    american_price: "-300",
    decimal_price: "1.40",
    odds: { prediction: { decimal: "1.32", probability: "74" }, fantasy: null },
  });
  assert.equal(quote.american, -300, "american_price fills a blank prediction american");
  assert.equal(quote.probability, 0.74);
  const fromDecimal = predictionQuoteFromOption({
    selection_header: "New York Giants",
    odds: { prediction: { decimal: "3.45", probability: "27" } },
  });
  assert.equal(fromDecimal.american, 245);
}

{
  assert.equal(predictionQuoteFromOption({
    selection_header: "Kyren Williams",
    choice: "higher",
    american_price: "-167",
    decimal_price: "1.6",
    odds: { prediction: null, fantasy: { american: "-186", decimal: "1.54", probability: "62" } },
  }), null, "fantasy props are not prediction quotes");
}

{
  const payload = {
    match_grouped_lines: [
      {
        title: "Moneyline",
        options: [
          giantsOption,
          {
            selection_header: "Los Angeles Rams",
            american_price: "-313",
            decimal_price: "1.32",
            odds: { prediction: { american: "-313", decimal: "1.32", probability: "74" } },
          },
        ],
      },
      {
        title: "2026/27 NFC Champion",
        over_under: { category: "future", title: "2026/27 NFC Champion" },
        options: [{
          selection_header: "New York Giants",
          american_price: "+1500",
          odds: { prediction: { american: "+1500", decimal: "16", probability: "6" } },
        }],
      },
    ],
    over_under_lines: [{
      over_under: { title: "Kyren Williams Rush Yards O/U", category: "player_prop" },
      options: [{
        choice: "higher",
        selection_header: "Kyren Williams",
        american_price: "-167",
        odds: { prediction: null, fantasy: { american: "-186" } },
      }],
    }],
  };
  const quotes = predictionQuotesFromPayload(payload);
  assert.deepEqual(cjsQuotes.predictionQuotesFromPayload(payload), quotes, "CJS server parser matches the ESM phone parser");
  const giants = quotes.filter((q) => q.name === "New York Giants");
  assert.equal(giants.length, 2);
  assert.ok(giants.some((q) => q.market === "h2h" && q.american === 245));
  assert.ok(giants.some((q) => q.market === "future" && q.american === 1500));
  assert.equal(classifyUnderdogLineMarket({ title: "Moneyline" }), "h2h");
  assert.equal(quotes.some((q) => q.name === "Kyren Williams"), false);

  const game = applyUnderdogLobbyPredictions({
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
    bookmakers: [{
      key: "underdog_predict",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "New York Giants", price: 252 },
          { name: "Los Angeles Rams", price: -256 },
        ],
      }],
    }, {
      key: "draftkings",
      markets: [{ key: "h2h", outcomes: [{ name: "New York Giants", price: 240 }] }],
    }],
  }, payload);
  const udp = game.bookmakers.find((b) => b.key === "underdog_predict").markets[0].outcomes;
  assert.equal(udp[0].price, 252);
  assert.equal(udp[0].predictionAmerican, 245);
  assert.equal(udp[1].predictionAmerican, -313);
  assert.equal(game.bookmakers.find((b) => b.key === "draftkings").markets[0].outcomes[0].predictionAmerican, undefined);
  const noBook = applyUnderdogLobbyPredictions({
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
    bookmakers: [{ key: "draftkings", markets: [] }],
  }, payload);
  assert.equal(noBook.bookmakers.length, 1, "attach does not invent a bookmaker");
  const synthesized = predictionOnlyBookmakerFromQuotes({
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
  }, payload);
  assert.equal(synthesized.key, "underdog_predict");
  const synth = synthesized.markets.find((m) => m.key === "h2h").outcomes;
  const giantsPhone = synth.find((o) => o.name === "New York Giants");
  assert.equal(giantsPhone.price, 245, "prediction-only leg uses the phone American");
  assert.equal(giantsPhone.predictionAmerican, 245);
  assert.equal(giantsPhone.contractProbability, 0.27);
  assert.equal(synth.find((o) => o.name === "Los Angeles Rams").price, -313);
  assert.equal(synthesized.markets.some((m) => (m.outcomes || []).some((o) => o.price === 1500)), false, "futures are not game legs");
}

{
  const board = applyUnderdogPhoneQuotes([{
    away: "New York Giants",
    home: "Los Angeles Rams",
    bookOdds: { underdog_predict: { ml_away: 240, ml_home: -303 } },
  }], {
    games: [{
      away: "New York Giants",
      home: "Los Angeles Rams",
      lines: [
        { market: "h2h", name: "New York Giants", american: 245, updatedAt: 111 },
        { market: "h2h", name: "Los Angeles Rams", american: -313, updatedAt: 222 },
      ],
    }],
  });
  assert.equal(board[0].bookOdds.underdog_predict.ml_away, 245);
  assert.equal(board[0].bookOdds.underdog_predict.ml_home, -313);
  assert.equal(board[0].bookLineUpdatedAt.underdog_predict.ml_away, 111);
  assert.notEqual(board[0].bookOdds.underdog_predict.ml_away, 240);
  const cleared = applyUnderdogPhoneQuotes(board, { games: [] });
  assert.equal(cleared[0].bookOdds.underdog_predict.ml_away, null);
  assert.equal(applyUnderdogPhoneQuotes(board, null)[0].bookOdds.underdog_predict.ml_away, 245);
}

{
  // Marlins @ Cubs, 2026-09-22..24. Odds API has Sep 22 23:40Z and Sep 23
  // 23:41Z. The phone lobby lists three games. Team-only .find() painted
  // today's Marlins +170 onto tomorrow's card.
  assert.equal(UNDERDOG_PHONE_COMMENCE_WINDOW_MS, 4 * 60 * 60 * 1000);
  const today = "2026-09-22T23:40:00Z";
  const tomorrowOdds = "2026-09-23T23:41:00Z";
  const tomorrowPhone = "2026-09-23T23:40:00Z";
  const dayAfter = "2026-09-24T18:20:00Z";
  const slate = {
    games: [
      {
        away: "Miami Marlins",
        home: "Chicago Cubs",
        scheduledAt: today,
        lines: [
          { market: "h2h", name: "Miami Marlins", american: 170 },
          { market: "h2h", name: "Chicago Cubs", american: -210 },
        ],
      },
      {
        away: "Miami Marlins",
        home: "Chicago Cubs",
        scheduledAt: tomorrowPhone,
        lines: [
          { market: "h2h", name: "Miami Marlins", american: 150 },
          { market: "h2h", name: "Chicago Cubs", american: -180 },
        ],
      },
      {
        away: "Miami Marlins",
        home: "Chicago Cubs",
        scheduled_at: dayAfter,
        lines: [
          { market: "h2h", name: "Miami Marlins", american: 163 },
          { market: "h2h", name: "Chicago Cubs", american: -195 },
        ],
      },
    ],
  };
  const todayHit = findUnderdogPhoneGame(slate, "Miami Marlins", "Chicago Cubs", today);
  const tomorrowHit = findUnderdogPhoneGame(slate, "Miami Marlins", "Chicago Cubs", tomorrowOdds);
  const dayAfterHit = findUnderdogPhoneGame(slate, "Chicago Cubs", "Miami Marlins", dayAfter);
  assert.equal(todayHit.lines.find((l) => l.name === "Miami Marlins").american, 170);
  assert.equal(tomorrowHit.lines.find((l) => l.name === "Miami Marlins").american, 150, "tomorrow uses +150, not today's +170");
  assert.equal(dayAfterHit.lines.find((l) => l.name === "Miami Marlins").american, 163);
  const orphan = new Date(Date.parse(dayAfter) + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(findUnderdogPhoneGame(slate, "Miami Marlins", "Chicago Cubs", orphan), null, "no Underdog row inside the window");
  const fiveHours = new Date(Date.parse(today) + 5 * 60 * 60 * 1000).toISOString();
  assert.equal(
    findUnderdogPhoneGame({ games: [slate.games[0]] }, "Miami Marlins", "Chicago Cubs", fiveHours),
    null,
    "the only same-team row still does not attach from the next session",
  );

  // Two games inside the window: closest kickoff, not the first row.
  const early = today;
  const late = new Date(Date.parse(today) + 3 * 60 * 60 * 1000).toISOString();
  const nearLate = new Date(Date.parse(late) + 10 * 60 * 1000).toISOString();
  const dh = findUnderdogPhoneGame({
    games: [
      { away: "Miami Marlins", home: "Chicago Cubs", scheduledAt: early, lines: [{ market: "h2h", name: "Miami Marlins", american: 170 }] },
      { away: "Miami Marlins", home: "Chicago Cubs", scheduledAt: late, lines: [{ market: "h2h", name: "Miami Marlins", american: 150 }] },
    ],
  }, "Miami Marlins", "Chicago Cubs", nearLate);
  assert.equal(dh.lines[0].american, 150);

  const board = applyUnderdogPhoneQuotes([
    { away: "Miami Marlins", home: "Chicago Cubs", commence_time: today, bookOdds: { underdog_predict: { ml_away: 999 } } },
    { away: "Miami Marlins", home: "Chicago Cubs", commence_time: tomorrowOdds, bookOdds: { underdog_predict: { ml_away: 999 } } },
    { away: "Miami Marlins", home: "Chicago Cubs", commence_time: orphan, bookOdds: { underdog_predict: { ml_away: 999 } } },
  ], slate);
  assert.equal(board[0].bookOdds.underdog_predict.ml_away, 170);
  assert.equal(board[0].bookOdds.underdog_predict.ml_home, -210);
  assert.equal(board[1].bookOdds.underdog_predict.ml_away, 150, "board tomorrow does not inherit today's +170");
  assert.equal(board[1].bookOdds.underdog_predict.ml_home, -180);
  assert.equal(board[2].bookOdds.underdog_predict.ml_away, null, "out-of-window board game drops Underdog");
  assert.notEqual(board[2].bookOdds.underdog_predict.ml_away, 170);
  assert.notEqual(board[2].bookOdds.underdog_predict.ml_away, 163);
}

{
  // Padres @ Dodgers, live 2026-09-24. Odds API Sep 23 10:11 PM ET is
  // 2026-09-24T02:11Z. Phone: that night Dodgers -1.5 -109 (match 143677,
  // scheduled 02:10Z); next night Dodgers -1.5 +122 (match 143943, 02:10Z
  // on Sep 25). Team-only attach painted +122 onto the Sep 23 card.
  const tonight = "2026-09-24T02:11:00Z";
  const tonightPhone = "2026-09-24T02:10:00Z";
  const tomorrow = "2026-09-25T02:11:00Z";
  const tomorrowPhone = "2026-09-25T02:10:00Z";
  const ladSd = {
    games: [
      {
        away: "San Diego Padres",
        home: "Los Angeles Dodgers",
        scheduledAt: tonightPhone,
        lines: [
          { market: "h2h", name: "San Diego Padres", american: 180 },
          { market: "h2h", name: "Los Angeles Dodgers", american: -223 },
          { market: "spreads", name: "San Diego Padres", point: 1.5, american: -113 },
          { market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: -109 },
          { market: "totals", name: "Over", point: 8.5, american: 104, choice: "over" },
          { market: "totals", name: "Under", point: 8.5, american: -127, choice: "under" },
        ],
      },
      {
        away: "San Diego Padres",
        home: "Los Angeles Dodgers",
        scheduledAt: tomorrowPhone,
        lines: [
          { market: "h2h", name: "San Diego Padres", american: 144 },
          { market: "h2h", name: "Los Angeles Dodgers", american: -179 },
          { market: "spreads", name: "San Diego Padres", point: 1.5, american: -157 },
          { market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: 122 },
          { market: "totals", name: "Over", point: 8.5, american: -110, choice: "over" },
          { market: "totals", name: "Under", point: 8.5, american: -110, choice: "under" },
        ],
      },
    ],
  };
  const dodgersSpread = (game) => (game && game.lines || []).find((l) => l.market === "spreads" && l.name === "Los Angeles Dodgers");
  const tonightHit = findUnderdogPhoneGame(ladSd, "San Diego Padres", "Los Angeles Dodgers", tonight);
  const tomorrowHit = findUnderdogPhoneGame(ladSd, "Los Angeles Dodgers", "San Diego Padres", tomorrow);
  assert.equal(dodgersSpread(tonightHit).american, -109, "Sep 23 card keeps Dodgers -1.5 -109");
  assert.notEqual(dodgersSpread(tonightHit).american, 122);
  assert.equal(dodgersSpread(tomorrowHit).american, 122, "Sep 24 card keeps Dodgers -1.5 +122");
  assert.equal(
    findUnderdogPhoneGame({ games: [ladSd.games[1]] }, "San Diego Padres", "Los Angeles Dodgers", tonight),
    null,
    "tomorrow is the only phone row and still does not attach to tonight",
  );
  assert.equal(
    findUnderdogPhoneGame({
      games: [{ away: "San Diego Padres", home: "Los Angeles Dodgers", lines: [{ market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: 122 }] }],
    }, "San Diego Padres", "Los Angeles Dodgers", tonight),
    null,
    "a phone row with no kickoff does not attach to a timed event",
  );

  // 11:30 PM ET and 2:00 AM ET are 2.5h apart but different New York dates.
  const lateNight = "2026-09-24T03:30:00Z";
  const afterMidnight = "2026-09-24T06:00:00Z";
  const crossMidnight = findUnderdogPhoneGame({
    games: [
      { away: "San Diego Padres", home: "Los Angeles Dodgers", scheduledAt: "2026-09-24T03:40:00Z", lines: [{ market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: -109 }] },
      { away: "San Diego Padres", home: "Los Angeles Dodgers", scheduledAt: afterMidnight, lines: [{ market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: 122 }] },
    ],
  }, "San Diego Padres", "Los Angeles Dodgers", lateNight);
  assert.equal(dodgersSpread(crossMidnight).american, -109, "same New York date wins inside the 4h window");
  assert.equal(
    findUnderdogPhoneGame({
      games: [{ away: "San Diego Padres", home: "Los Angeles Dodgers", scheduledAt: afterMidnight, lines: [{ market: "spreads", name: "Los Angeles Dodgers", point: -1.5, american: 122 }] }],
    }, "San Diego Padres", "Los Angeles Dodgers", lateNight),
    null,
    "next New York date inside 4h does not attach",
  );

  const board = applyUnderdogPhoneQuotes([
    { away: "San Diego Padres", home: "Los Angeles Dodgers", commence_time: tonight },
    { away: "San Diego Padres", home: "Los Angeles Dodgers", commence_time: tomorrow },
  ], ladSd);
  assert.equal(board[0].bookOdds.underdog_predict.spr_home, -109);
  assert.equal(board[0].bookOdds.underdog_predict.spr_home_line, -1.5);
  assert.equal(board[0].bookOdds.underdog_predict.ml_home, -223);
  assert.equal(board[0].bookOdds.underdog_predict.tot_over, 104);
  assert.equal(board[0].bookOdds.underdog_predict.tot_line, 8.5);
  assert.equal(board[1].bookOdds.underdog_predict.spr_home, 122);
  assert.notEqual(board[0].bookOdds.underdog_predict.spr_home, 122);
  assert.notEqual(board[0].bookOdds.underdog_predict.ml_home, -179);
  assert.notEqual(board[0].bookOdds.underdog_predict.tot_over, -110);
}

console.log("underdogPredictionQuote.test.js ok");
