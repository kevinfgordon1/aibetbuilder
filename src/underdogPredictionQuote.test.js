import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  applyUnderdogLobbyPredictions,
  applyUnderdogPhoneQuotes,
  classifyUnderdogLineMarket,
  predictionOnlyBookmakerFromQuotes,
  predictionQuoteFromOption,
  predictionQuotesFromPayload,
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

console.log("underdogPredictionQuote.test.js ok");
