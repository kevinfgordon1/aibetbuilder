import assert from "node:assert/strict";
import {
  applyUnderdogLobbyPredictions,
  classifyUnderdogLineMarket,
  predictionQuoteFromOption,
  predictionQuotesFromPayload,
} from "./underdogPredictionQuote.js";

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
  assert.equal(noBook.bookmakers.length, 1, "prediction-only does not invent an Underdog leg");
}

console.log("underdogPredictionQuote.test.js ok");
