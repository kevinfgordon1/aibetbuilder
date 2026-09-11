import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSoccerPmNos, overlaySoccerPmNos } from "./soccerPmNo.js";
import { soccerPmGameKey } from "./soccerPairing.js";

{
  const data = {
    moneylines: [{
      sport: "soccer_epl",
      away: "Chelsea",
      home: "Arsenal",
      commence_time: "2026-09-12T14:00:00Z",
      best_home_no: -138,
      best_home_no_book: "betfair_ex_eu",
    }],
    run_lines: [],
    totals: [],
  };
  const key = soccerPmGameKey(data.moneylines[0]);
  const overlaid = overlaySoccerPmNos(data, {
    [key]: { home: { best: 155, bestBook: "kalshi", bestSize: 800, count: 1 } },
  });
  assert.equal(overlaid.moneylines[0].best_home_no_book, "kalshi");
  assert.equal(overlaid.moneylines[0].best_home_no, 155);
  assert.equal(overlaySoccerPmNos(data, null), data);
}

{
  const quotes = await fetchSoccerPmNos([], { fetchImpl: async () => { throw new Error("no call"); } });
  assert.deepEqual(quotes, {});
}

{
  const quotes = await fetchSoccerPmNos(
    [{ sport: "soccer_epl", away: "A", home: "B", commence_time: "t" }],
    {
      venues: ["kalshi"],
      fetchImpl: async (url, opts) => {
        assert.equal(url, "/api/soccer-pm-no");
        const body = JSON.parse(opts.body);
        assert.deepEqual(body.venues, ["kalshi"]);
        return {
          ok: true,
          json: async () => ({ quotes: { "soccer_epl|A|B|t": { home: { best: 140, bestBook: "kalshi" } } } }),
        };
      },
    },
  );
  assert.equal(quotes["soccer_epl|A|B|t"].home.bestBook, "kalshi");
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/soccerPmNo\.js"/);
  assert.match(app, /overlaySoccerPmNos\(promoOddsData, soccerPmNoByGame\)/);
}

console.log("soccerPmNo.test.js ok");
