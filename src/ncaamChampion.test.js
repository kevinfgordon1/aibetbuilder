import assert from "node:assert/strict";
import { ncaamChampionRows, impliedProb, probToAmerican, fmtProfit, NCAAM_CHAMP_KEY, OPPOSING_VENUES } from "./ncaamChampion.js";

assert.equal(NCAAM_CHAMP_KEY, "basketball_ncaab_championship_winner");
assert.deepEqual([...OPPOSING_VENUES], ["kalshi", "polymarket"]);

const teams = [
  { name: "Duke Blue Devils",
    books: { fanduel: 450, draftkings: 500, kalshi: 573, polymarket: 540 },
    noBooks: { kalshi: -700, polymarket: -650, prophetx: -400 }, // prophetx is not an opposing venue here
    bookProfits: { kalshi: 11462.8, polymarket: 4656.8 }, noBookProfits: { kalshi: 1264.9, polymarket: 42.9 } },
  { name: "Florida Gators", books: { fanduel: 700 }, noBooks: {}, bookProfits: {}, noBookProfits: {} },
  { name: "Nowhere", books: {}, noBooks: {} },
];
const rows = ncaamChampionRows(teams);
assert.equal(rows.length, 2);
const duke = rows[0];
assert.equal(duke.name, "Duke Blue Devils");
assert.equal(duke.yes, 573);
assert.deepEqual(duke.yesBooks, ["kalshi"]);
assert.equal(duke.yesProfit, 11462.8);
assert.equal(duke.no, -650, "best opposing across Kalshi/Polymarket only");
assert.deepEqual(duke.noBooks, ["polymarket"]);
assert.equal(duke.noProfit, 42.9);
// Inverse bet: fair = 1 - 650/750
const fair = 1 - 650 / 750;
assert.ok(Math.abs(duke.fairProb - fair) < 1e-12);
assert.equal(duke.fairAmerican, probToAmerican(fair));
assert.equal(duke.evPct, Math.round((fair * 6.73 - 1) * 1000) / 10);
// Florida: no opposing price -> no fair / EV, never invented.
assert.equal(rows[1].no, null);
assert.equal(rows[1].evPct, null);
assert.equal(rows[1].yesProfit, null);

// Selected books narrow both sides; search filters by name.
const onlyBooks = ncaamChampionRows(teams, { selected: new Set(["fanduel", "draftkings"]) });
assert.equal(onlyBooks[0].yes, 500);
assert.equal(onlyBooks[0].no, null);
assert.deepEqual(ncaamChampionRows(teams, { search: "flor" }).map((r) => r.name), ["Florida Gators"]);

assert.equal(impliedProb(-650).toFixed(4), (650 / 750).toFixed(4));
assert.equal(fmtProfit(42.9), "$43");
assert.equal(fmtProfit(4656.8), "$4.7k");
assert.equal(fmtProfit(11462.8), "$11k");
assert.equal(fmtProfit(null), "—");
console.log("ncaamChampion: ok");
