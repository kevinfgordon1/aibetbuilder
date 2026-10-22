import assert from "node:assert/strict";
import { gamesFromEspn, legInfo, gameLabel, espnDates } from "./sniperLegLabels.js";
const espn = { events: [
  { date: "2026-10-23T00:15Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "CHI", shortDisplayName: "Bears" } }, { homeAway: "away", team: { abbreviation: "NE", shortDisplayName: "Patriots" } }] }] },
  { date: "2026-10-25T17:00Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "TEN", shortDisplayName: "Titans" } }, { homeAway: "away", team: { abbreviation: "IND", shortDisplayName: "Colts" } }] }] },
] };
const g = gamesFromEspn(espn);
assert.ok(g["26OCT22NECHI"], "ET date code for a Thursday night game");
assert.equal(legInfo("KXNFLGAME-26OCT22NECHI-NE:yes", g).text, "Patriots ML · NE @ CHI · Thu 8:15 PM");
assert.equal(legInfo("KXNFLTD-26OCT25INDTEN-INDDOGLETREE85-1:no", g, { "KXNFLTD-26OCT25INDTEN-INDDOGLETREE85-1": "Drew Ogletree: Anytime TD" }).text, "Drew Ogletree anytime TD (No) · IND @ TEN · Sun 1:00 PM");
assert.equal(legInfo("KXNFLTD-26OCT25INDTEN-INDDOGLETREE85-1:yes", g).bet, "D. Ogletree anytime TD");
assert.equal(gameLabel("KXNFLGAME-26OCT22NECHI", g), "NE @ CHI · Thu 8:15 PM");
assert.equal(gameLabel("26OCT22NECHI", g), "NE @ CHI · Thu 8:15 PM");
assert.equal(gameLabel("26OCT30XXYY", g), "XXYY");
assert.deepEqual(espnDates(["KXNFLGAME-26OCT22NECHI-NE:yes", "26OCT25INDTEN"]), ["20261022", "20261025"]);
console.log("sniperLegLabels ok");
