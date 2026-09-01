import assert from "node:assert/strict";
import {
  identifyTeam,
  parsePromoTotal,
  parsePromoSpread,
  mapPromoLegsToKalshi,
  encVal,
  toDatetimeLocalValue,
  earliestCommence,
  fairAmericanFromProb,
  recommendedFillFromFair,
  recommendedFillFromProb,
  flattenComboGames,
  formatGameOption,
  comboGameId,
} from "./comboPrefill.js";

const gSide = (tk, label) => ({ ticker: tk, side: "yes", label });
const gTot = (tk, line) => [
  { ticker: tk, side: "yes", label: `Over ${line}` },
  { ticker: tk, side: "no", label: `Under ${line}` },
];
const gSpr = (tk, fav, dog, line) => [
  { ticker: tk, side: "yes", label: `${fav} \u2212${line}` },
  { ticker: tk, side: "no", label: `${dog} +${line}` },
];
const sampleGame = (key, ka, kb, A, B) => ({
  key,
  title: `${A} vs ${B}`,
  date: `${ka} vs ${kb}`,
  markets: {
    side: [gSide(`KXMLBGAME-${key}-${ka}`, A), gSide(`KXMLBGAME-${key}-${kb}`, B)],
    spread: [
      ...gSpr(`KXMLBSPREAD-${key}-${ka}2`, A, B, "1.5"),
      ...gSpr(`KXMLBSPREAD-${key}-${ka}3`, A, B, "2.5"),
      ...gSpr(`KXMLBSPREAD-${key}-${kb}2`, B, A, "1.5"),
    ],
    total: [
      ...gTot(`KXMLBTOTAL-${key}-7`, "6.5"),
      ...gTot(`KXMLBTOTAL-${key}-8`, "7.5"),
      ...gTot(`KXMLBTOTAL-${key}-9`, "8.5"),
      ...gTot(`KXMLBTOTAL-${key}-10`, "9.5"),
    ],
  },
});

const MLB = [
  sampleGame("26AUG071905PHIATL", "PHI", "ATL", "Philadelphia", "Atlanta"),
  sampleGame("26AUG071905NYMWSH", "NYM", "WSH", "New York M", "Washington"),
  sampleGame("26AUG071905NYYBOS", "NYY", "BOS", "New York Y", "Boston"),
  sampleGame("26AUG071905LAALAD", "LAA", "LAD", "Los Angeles A", "Los Angeles D"),
  sampleGame("26AUG071905CHCCWS", "CHC", "CWS", "Chicago Cubs", "Chicago WS"),
];

assert.equal(identifyTeam("Los Angeles Angels ML"), "LAA");
assert.equal(identifyTeam("Los Angeles Dodgers"), "LAD");
assert.equal(identifyTeam("New York Mets"), "NYM");
assert.equal(identifyTeam("New York Yankees"), "NYY");
assert.equal(identifyTeam("New York Y"), "NYY");
assert.equal(identifyTeam("New York M"), "NYM");
assert.equal(identifyTeam("Philadelphia Phillies"), "PHI");
assert.equal(identifyTeam("Philadelphia"), "PHI");
assert.equal(identifyTeam("Chicago Cubs"), "CHC");
assert.equal(identifyTeam("Chicago White Sox"), "CWS");
assert.equal(identifyTeam("Guardians"), "CLE");
assert.equal(identifyTeam("Washington Nationals"), "WSH");
assert.equal(identifyTeam("Kansas City Chiefs", "nfl"), "KC");
assert.equal(identifyTeam("New England Patriots", "nfl"), "NE");
assert.equal(identifyTeam("Seattle Seahawks", "nfl"), "SEA");
assert.equal(identifyTeam("Los Angeles R", "nfl"), "LAR");
assert.equal(identifyTeam("New York J", "nfl"), "NYJ");
assert.equal(identifyTeam("Kansas City Royals"), "KC");

assert.deepEqual(parsePromoTotal("Los Angeles Angels/Atlanta Braves o8.5"), { ou: "over", line: "8.5" });
assert.deepEqual(parsePromoTotal("Guardians/Tigers u8.5"), { ou: "under", line: "8.5" });
assert.deepEqual(parsePromoTotal("Over 8.5"), { ou: "over", line: "8.5" });

assert.deepEqual(parsePromoSpread("Cleveland Guardians -1.5"), { team: "Cleveland Guardians", sign: "-", line: "1.5" });
assert.deepEqual(parsePromoSpread("Tigers +1.5"), { team: "Tigers", sign: "+", line: "1.5" });

const phiMl = {
  name: "Philadelphia Phillies ML",
  market: "ML",
  game: "Philadelphia Phillies @ Atlanta Braves",
  sport: "baseball_mlb",
  commence_time: "2026-08-07T23:05:00Z",
};
const atlSpr = {
  name: "Atlanta Braves +1.5",
  market: "SPR",
  game: "Philadelphia Phillies @ Atlanta Braves",
  sport: "baseball_mlb",
};
const totOver = {
  name: "Philadelphia Phillies/Atlanta Braves o8.5",
  market: "TOT",
  game: "Philadelphia Phillies @ Atlanta Braves",
  sport: "baseball_mlb",
};
const phiSpr = {
  name: "Philadelphia Phillies -1.5",
  market: "SPR",
  game: "Philadelphia Phillies @ Atlanta Braves",
  sport: "baseball_mlb",
};

const mapped = mapPromoLegsToKalshi([phiMl, totOver, atlSpr], MLB);
assert.equal(mapped.unmatched.length, 0, JSON.stringify(mapped.unmatched));
assert.equal(mapped.rows.length, 3);
assert.equal(mapped.rows[0].gameKey, "26AUG071905PHIATL");
assert.equal(mapped.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905PHIATL-PHI", "yes"));
assert.equal(mapped.rows[1].marketVal, encVal("KXMLBTOTAL-26AUG071905PHIATL-9", "yes"));
assert.equal(mapped.rows[2].marketVal, encVal("KXMLBSPREAD-26AUG071905PHIATL-PHI2", "no"));

const sprFav = mapPromoLegsToKalshi([phiSpr], MLB);
assert.equal(sprFav.rows[0].marketVal, encVal("KXMLBSPREAD-26AUG071905PHIATL-PHI2", "yes"));

const mets = mapPromoLegsToKalshi([{
  name: "New York Mets ML", market: "ML",
  game: "New York Mets @ Washington Nationals", sport: "baseball_mlb",
}], MLB);
assert.equal(mets.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905NYMWSH-NYM", "yes"));

const yanks = mapPromoLegsToKalshi([{
  name: "New York Yankees ML", market: "ML",
  game: "New York Yankees @ Boston Red Sox", sport: "baseball_mlb",
}], MLB);
assert.equal(yanks.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905NYYBOS-NYY", "yes"));

const angels = mapPromoLegsToKalshi([{
  name: "Los Angeles Angels ML", market: "ML",
  game: "Los Angeles Angels @ Los Angeles Dodgers", sport: "baseball_mlb",
}], MLB);
assert.equal(angels.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905LAALAD-LAA", "yes"));

const dodgers = mapPromoLegsToKalshi([{
  name: "Los Angeles Dodgers ML", market: "ML",
  game: "Los Angeles Angels @ Los Angeles Dodgers", sport: "baseball_mlb",
}], MLB);
assert.equal(dodgers.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905LAALAD-LAD", "yes"));

const cubs = mapPromoLegsToKalshi([{
  name: "Chicago Cubs ML", market: "ML",
  game: "Chicago Cubs @ Chicago White Sox", sport: "baseball_mlb",
}], MLB);
assert.equal(cubs.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905CHCCWS-CHC", "yes"));

const nfl = mapPromoLegsToKalshi([{
  name: "Kansas City Chiefs ML", market: "ML",
  game: "Kansas City Chiefs @ Buffalo Bills", sport: "americanfootball_nfl",
}, phiMl], MLB);
assert.equal(nfl.unmatched.length, 1);
assert.match(nfl.unmatched[0].reason, /no matching Kalshi NFL/);
assert.equal(nfl.rows[0].marketVal, "");
assert.ok(nfl.rows[1].marketVal);

const tt = mapPromoLegsToKalshi([{
  name: "Philadelphia Phillies TT o4.5", market: "TT",
  game: "Philadelphia Phillies @ Atlanta Braves", sport: "baseball_mlb",
}], MLB);
assert.equal(tt.unmatched.length, 1);
assert.match(tt.unmatched[0].reason, /team totals/i);

const missing = mapPromoLegsToKalshi([{
  name: "Seattle Mariners ML", market: "ML",
  game: "Seattle Mariners @ Houston Astros", sport: "baseball_mlb",
}], MLB);
assert.equal(missing.unmatched.length, 1);
assert.match(missing.unmatched[0].reason, /no matching Kalshi/);

const totUnder = mapPromoLegsToKalshi([{
  name: "Philadelphia Phillies/Atlanta Braves u8.5", market: "TOT",
  game: "Philadelphia Phillies @ Atlanta Braves", sport: "baseball_mlb",
}], MLB);
assert.equal(totUnder.rows[0].marketVal, encVal("KXMLBTOTAL-26AUG071905PHIATL-9", "no"));

const kcGame = sampleGame("26AUG071905KCNYY", "KC", "NYY", "Kansas City", "New York Y");
const kcMap = mapPromoLegsToKalshi([{
  name: "Kansas City Royals ML", market: "ML",
  game: "Kansas City Royals @ New York Yankees", sport: "baseball_mlb",
}], [kcGame]);
assert.equal(kcMap.rows[0].gameKey, "26AUG071905KCNYY");
assert.equal(kcMap.rows[0].marketVal, encVal("KXMLBGAME-26AUG071905KCNYY-KC", "yes"));

const totMissingLine = mapPromoLegsToKalshi([{
  name: "Philadelphia Phillies/Atlanta Braves o12.5", market: "TOT",
  game: "Philadelphia Phillies @ Atlanta Braves", sport: "baseball_mlb",
}], MLB);
assert.equal(totMissingLine.unmatched.length, 1);
assert.equal(totMissingLine.rows[0].gameKey, "26AUG071905PHIATL");
assert.equal(totMissingLine.rows[0].marketVal, "");

const fiveLeg = mapPromoLegsToKalshi([
  phiMl,
  {
    name: "New York Mets ML", market: "ML",
    game: "New York Mets @ Washington Nationals", sport: "baseball_mlb",
    commence_time: "2026-08-07T23:05:00Z",
  },
  {
    name: "New York Yankees ML", market: "ML",
    game: "New York Yankees @ Boston Red Sox", sport: "baseball_mlb",
    commence_time: "2026-08-07T23:10:00Z",
  },
  {
    name: "Los Angeles Angels ML", market: "ML",
    game: "Los Angeles Angels @ Los Angeles Dodgers", sport: "baseball_mlb",
    commence_time: "2026-08-08T02:00:00Z",
  },
  {
    name: "Chicago Cubs ML", market: "ML",
    game: "Chicago Cubs @ Chicago White Sox", sport: "baseball_mlb",
    commence_time: "2026-08-08T00:00:00Z",
  },
], MLB);
assert.equal(fiveLeg.unmatched.length, 0, JSON.stringify(fiveLeg.unmatched));
assert.equal(fiveLeg.rows.length, 5, "Send-to-Combo-Locks must map every grown leg");
assert.ok(fiveLeg.rows.every((r) => r.gameKey && r.marketVal));

const nflGame = {
  key: "26SEP09NESEA",
  sport: "nfl",
  title: "New England vs Seattle",
  date: "NE vs SEA (Sep 9)",
  startTime: "2026-09-10T03:20:00Z",
  markets: {
    side: [
      { ticker: "KXNFLGAME-26SEP09NESEA-NE", side: "yes", label: "New England" },
      { ticker: "KXNFLGAME-26SEP09NESEA-SEA", side: "yes", label: "Seattle" },
    ],
    spread: [
      { ticker: "KXNFLSPREAD-26SEP09NESEA-SEA7", side: "yes", label: "Seattle \u22126.5" },
      { ticker: "KXNFLSPREAD-26SEP09NESEA-SEA7", side: "no", label: "New England +6.5" },
    ],
    total: [
      { ticker: "KXNFLTOTAL-26SEP09NESEA-43", side: "yes", label: "Over 42.5" },
      { ticker: "KXNFLTOTAL-26SEP09NESEA-43", side: "no", label: "Under 42.5" },
    ],
  },
};
const ncaafGame = {
  key: "26SEP03MASSRUTG",
  sport: "ncaaf",
  title: "UMass vs Rutgers",
  date: "MASS vs RUTG (Sep 3)",
  startTime: "2026-09-04T01:00:00Z",
  markets: {
    side: [
      { ticker: "KXNCAAFGAME-26SEP03MASSRUTG-MASS", side: "yes", label: "UMass" },
      { ticker: "KXNCAAFGAME-26SEP03MASSRUTG-RUTG", side: "yes", label: "Rutgers" },
    ],
    spread: [
      { ticker: "KXNCAAFSPREAD-26SEP03MASSRUTG-RUTG36", side: "yes", label: "Rutgers \u221235.5" },
      { ticker: "KXNCAAFSPREAD-26SEP03MASSRUTG-RUTG36", side: "no", label: "UMass +35.5" },
    ],
    total: [
      { ticker: "KXNCAAFTOTAL-26SEP03MASSRUTG-50", side: "yes", label: "Over 49.5" },
      { ticker: "KXNCAAFTOTAL-26SEP03MASSRUTG-50", side: "no", label: "Under 49.5" },
    ],
  },
};
const SPORTS = { mlb: MLB, nfl: [nflGame], ncaaf: [ncaafGame] };

const nflHit = mapPromoLegsToKalshi([{
  name: "New England Patriots ML", market: "ML",
  game: "New England Patriots @ Seattle Seahawks", sport: "americanfootball_nfl",
  commence_time: "2026-09-10T00:20:00Z",
}], SPORTS);
assert.equal(nflHit.unmatched.length, 0, JSON.stringify(nflHit.unmatched));
assert.equal(nflHit.rows[0].gameKey, "26SEP09NESEA");
assert.equal(nflHit.rows[0].marketVal, encVal("KXNFLGAME-26SEP09NESEA-NE", "yes"));

const nflSpreadHit = mapPromoLegsToKalshi([{
  name: "Seattle Seahawks -6.5", market: "SPR",
  game: "New England Patriots @ Seattle Seahawks", sport: "americanfootball_nfl",
}], SPORTS);
assert.equal(nflSpreadHit.rows[0].marketVal, encVal("KXNFLSPREAD-26SEP09NESEA-SEA7", "yes"));

const ncaafHit = mapPromoLegsToKalshi([{
  name: "Rutgers Scarlet Knights ML", market: "ML",
  game: "UMass Minutemen @ Rutgers Scarlet Knights", sport: "americanfootball_ncaaf",
}], SPORTS);
assert.equal(ncaafHit.unmatched.length, 0, JSON.stringify(ncaafHit.unmatched));
assert.equal(ncaafHit.rows[0].gameKey, "26SEP03MASSRUTG");
assert.equal(ncaafHit.rows[0].marketVal, encVal("KXNCAAFGAME-26SEP03MASSRUTG-RUTG", "yes"));

const mixed = mapPromoLegsToKalshi([phiMl, {
  name: "Seattle Seahawks ML", market: "ML",
  game: "New England Patriots @ Seattle Seahawks", sport: "americanfootball_nfl",
}], SPORTS);
assert.equal(mixed.unmatched.length, 0, JSON.stringify(mixed.unmatched));
assert.equal(mixed.rows[0].gameKey, "26AUG071905PHIATL");
assert.equal(mixed.rows[1].marketVal, encVal("KXNFLGAME-26SEP09NESEA-SEA", "yes"));

const flat = flattenComboGames(SPORTS);
assert.ok(flat.some((g) => g.sport === "nfl" && g.key === "26SEP09NESEA"));
assert.ok(flat.some((g) => g.sport === "ncaaf" && g.key === "26SEP03MASSRUTG"));
assert.ok(flat.some((g) => g.sport === "mlb" && g.key === "26AUG071905PHIATL"));
assert.equal(formatGameOption(flat.find((g) => g.key === "26SEP09NESEA")), "NFL · New England vs Seattle · NE vs SEA (Sep 9)");
assert.equal(formatGameOption(flat.find((g) => g.key === "26SEP03MASSRUTG")), "NCAAF · UMass vs Rutgers · MASS vs RUTG (Sep 3)");
assert.equal(comboGameId(flat.find((g) => g.key === "26SEP09NESEA")), "nfl:26SEP09NESEA");

assert.equal(earliestCommence([
  { commence_time: "2026-08-08T01:00:00Z" },
  { commence_time: "2026-08-07T23:05:00Z" },
]), "2026-08-07T23:05:00.000Z");

const local = toDatetimeLocalValue("2026-08-07T23:05:00Z");
assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

// Recommended fill = fair (true parlay American). Initial value only — Combo Locks
// formFromPrefill copies prefill.fill and the fill input stays editable (no lock).
const fairFrom08 = fairAmericanFromProb(0.08);
assert.ok(Number.isFinite(fairFrom08) && fairFrom08 > 0, "0.08 is plus-money fair");
assert.equal(recommendedFillFromProb(0.08), fairFrom08);
assert.equal(recommendedFillFromFair(fairFrom08), fairFrom08);
assert.equal(recommendedFillFromFair(""), "");
for (const bad of [undefined, null, 0, 1, NaN, "", Infinity, -Infinity]) {
  assert.equal(fairAmericanFromProb(bad), "");
  assert.equal(recommendedFillFromProb(bad), "");
}
for (const emptyFair of [undefined, null, "", NaN, Infinity, -Infinity]) {
  assert.equal(recommendedFillFromFair(emptyFair), "");
}

console.log("comboPrefill tests passed");
