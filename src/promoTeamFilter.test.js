import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  parseTeamFilterTokens,
  promoLegSearchText,
  legMatchesTeamTokens,
  pickMatchesTeamInclude,
  pickPassesTeamExclude,
  pickPassesTeamFilter,
  filterLegsByTeamExclude,
  filterLegsByTeamInclude,
  filterPicksByTeamName,
  pinTeamIncludeLegs,
  teamFilterSummary,
} from "./promoTeamFilter.js";
import { findTopParlaysChunked, promoScanInputKey } from "./promoParlayScan.js";

const require = createRequire(import.meta.url);
const { calcParlayEV } = require("../lib/promo-ev.js");

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const scanSrc = fs.readFileSync(path.join(dir, "promoParlayScan.js"), "utf8");
const profile = fs.readFileSync(path.join(dir, "userProfile.js"), "utf8");
const share = fs.readFileSync(path.join(dir, "shareCard.js"), "utf8");

const lions = { name: "Detroit Lions ML", market: "ML", game: "Detroit Lions @ Green Bay Packers" };
const commanders = { name: "Washington Commanders ML", market: "ML", game: "Washington Commanders @ New York Giants" };
const chiefs = { name: "Kansas City Chiefs ML", market: "ML", game: "Kansas City Chiefs @ Buffalo Bills" };
const totLions = { name: "Detroit Lions/Green Bay Packers o47.5", market: "TOT", game: "Detroit Lions @ Green Bay Packers" };
const soccer = { name: "Manchester City ML", market: "ML", game: "Manchester City @ Chelsea", sport: "soccer_epl" };

{
  assert.deepEqual(parseTeamFilterTokens("lions"), ["lions"]);
  assert.deepEqual(parseTeamFilterTokens(" Lions , detroit "), ["lions", "detroit"]);
  assert.deepEqual(parseTeamFilterTokens("lions,lions, Lions"), ["lions"]);
  assert.deepEqual(parseTeamFilterTokens(""), []);
  assert.deepEqual(parseTeamFilterTokens("   ,  ,"), []);
  assert.deepEqual(parseTeamFilterTokens(null), []);
}

{
  assert.equal(legMatchesTeamTokens(lions, ["lions"]), true);
  assert.equal(legMatchesTeamTokens(lions, ["detroit"]), true);
  assert.equal(legMatchesTeamTokens(lions, ["LIONS"]), true);
  assert.equal(legMatchesTeamTokens(lions, ["commanders"]), false);
  assert.equal(legMatchesTeamTokens(commanders, ["commanders"]), true);
  assert.equal(legMatchesTeamTokens(totLions, ["lions"]), true);
  assert.equal(legMatchesTeamTokens(soccer, ["manchester city"]), true);
  assert.ok(promoLegSearchText(lions).includes("detroit lions"));
}

{
  const oneLeg = { ev: 28, legs: [lions] };
  const twoLeg = { ev: 20, legs: [chiefs, lions] };
  const noLions = { ev: 15, legs: [chiefs, commanders] };
  const commandOnly = { ev: 10, legs: [commanders] };

  const includeLions = filterPicksByTeamName([oneLeg, twoLeg, noLions, commandOnly], ["lions"], []);
  assert.deepEqual(includeLions.map((p) => p.ev), [28, 20]);

  const includeDetroit = filterPicksByTeamName([oneLeg, twoLeg, noLions], ["detroit"], []);
  assert.deepEqual(includeDetroit.map((p) => p.ev), [28, 20]);

  const excludeCommanders = filterPicksByTeamName([oneLeg, twoLeg, noLions, commandOnly], [], ["commanders"]);
  assert.deepEqual(excludeCommanders.map((p) => p.ev), [28, 20]);

  const both = filterPicksByTeamName([oneLeg, twoLeg, noLions, commandOnly], ["lions"], ["commanders"]);
  assert.deepEqual(both.map((p) => p.ev), [28, 20]);

  const includeOr = filterPicksByTeamName([oneLeg, noLions, commandOnly], ["lions", "chiefs"], []);
  assert.deepEqual(includeOr.map((p) => p.ev), [28, 15]);

  assert.equal(pickMatchesTeamInclude(oneLeg, ["lions"]), true);
  assert.equal(pickMatchesTeamInclude(noLions, ["lions"]), false);
  assert.equal(pickMatchesTeamInclude(twoLeg, ["lions"]), true, "multi-leg include = at least one leg");
  assert.equal(pickPassesTeamExclude(twoLeg, ["commanders"]), true);
  assert.equal(pickPassesTeamExclude(noLions, ["commanders"]), false);
  assert.equal(pickPassesTeamFilter(oneLeg, ["lions"], ["commanders"]), true);
  assert.deepEqual(filterPicksByTeamName([oneLeg], [], []), [oneLeg]);
  assert.deepEqual(filterPicksByTeamName([], ["lions"], []), []);
}

{
  const kept = filterLegsByTeamExclude([lions, commanders, chiefs], ["commanders"]);
  assert.deepEqual(kept.map((l) => l.name), ["Detroit Lions ML", "Kansas City Chiefs ML"]);
  assert.deepEqual(filterLegsByTeamInclude([lions, commanders, chiefs], ["lions"]).map((l) => l.name), ["Detroit Lions ML"]);
  assert.deepEqual(filterLegsByTeamExclude([lions], []), [lions]);
}

{
  const lowEvLions = { ...lions, evHint: 1 };
  const highOthers = Array.from({ length: 5 }, (_, i) => ({
    name: `Other ${i} ML`,
    game: `Away${i} @ Home${i}`,
  }));
  const pinned = pinTeamIncludeLegs([...highOthers, lowEvLions], ["lions"], 5);
  assert.equal(pinned.length, 5);
  assert.ok(pinned.some((l) => l.name === "Detroit Lions ML"), "include legs survive the scan cap");
  assert.deepEqual(pinTeamIncludeLegs(highOthers, [], 3).map((l) => l.name), ["Other 0 ML", "Other 1 ML", "Other 2 ML"]);
}

{
  assert.equal(teamFilterSummary(["lions"], []), "include lions");
  assert.equal(teamFilterSummary([], ["commanders"]), "exclude commanders");
  assert.equal(teamFilterSummary(["lions", "detroit"], ["commanders"]), "include lions, detroit · exclude commanders");
  assert.equal(teamFilterSummary([], []), "");
}

{
  const calc = (ls) => calcParlayEV(ls, 50, 100);
  const mk = (name, game, dk, opp) => ({ name, game, market: "ML", dk, bestOpp: opp });
  const lionLeg = mk("Detroit Lions ML", "Detroit Lions @ Packers", 185, -194);
  const cheap = mk("Cheap ML", "A @ B", -110, 100);
  const other = mk("Other ML", "C @ D", -105, -105);
  const cmd = mk("Washington Commanders ML", "Commanders @ Giants", 150, -160);

  const singles = await findTopParlaysChunked(
    [cheap, other, lionLeg],
    1,
    calc,
    { maxResults: 2, yieldMs: 0, acceptCombo: (legs) => pickMatchesTeamInclude(legs, ["lions"]) },
  );
  assert.equal(singles.length, 1);
  assert.equal(singles[0].legs[0].name, "Detroit Lions ML");

  const parlays = await findTopParlaysChunked(
    [cheap, other, lionLeg, cmd],
    2,
    calc,
    { maxResults: 10, yieldMs: 0, acceptCombo: (legs) => pickPassesTeamFilter(legs, ["lions"], ["commanders"]) },
  );
  assert.ok(parlays.length > 0);
  assert.ok(parlays.every((p) => p.legs.some((l) => /lions/i.test(l.name + l.game))));
  assert.ok(parlays.every((p) => !p.legs.some((l) => /commanders/i.test(l.name + l.game))));

  const keyBase = {
    promoType: "boost", numLegs: 1, scanBoostPct: 50,
    parsedMinFinal: null, parsedMaxFinal: null, refundPct: 100, creditConversionPct: 70,
    pool: [lionLeg],
  };
  assert.notEqual(
    promoScanInputKey({ ...keyBase, includeTeam: "lions" }),
    promoScanInputKey({ ...keyBase, includeTeam: "" }),
  );
}

// ── App.jsx Extra Filters: two inputs + pool + ranked list use shared helper
{
  assert.match(app, /import \{\s*parseTeamFilterTokens,\s*filterLegsByTeamExclude,\s*filterLegsByTeamInclude,\s*filterPicksByTeamName,\s*pinTeamIncludeLegs,\s*pickMatchesTeamInclude,\s*teamFilterSummary,\s*\} from "\.\/promoTeamFilter\.js"/);
  assert.match(app, /const \[promoTeamInclude, setPromoTeamInclude\] = useState\(""\)/);
  assert.match(app, /const \[promoTeamExclude, setPromoTeamExclude\] = useState\(""\)/);
  assert.match(app, /useDebouncedValue\(promoTeamInclude/);
  assert.match(app, /useDebouncedValue\(promoTeamExclude/);
  assert.match(app, /parseTeamFilterTokens\(/);
  assert.match(app, /filterLegsByTeamExclude\(/);
  assert.match(app, /filterLegsByTeamInclude\(/);
  assert.match(app, /filterPicksByTeamName\(/);
  assert.match(app, /pinTeamIncludeLegs\(/);
  assert.match(app, /teamFilterSummary\(/);
  assert.match(app, /<label style=\{labelStyle\}>Must include<\/label>/);
  assert.match(app, /<label style=\{labelStyle\}>Must exclude<\/label>/);
  assert.match(app, /placeholder="e\.g\. Lions"/);
  assert.match(app, /placeholder="e\.g\. Commanders"/);
  const extraStart = app.indexOf("{promoFiltersOpen && (");
  const extraEnd = app.indexOf("recalculating…");
  assert.ok(extraStart >= 0 && extraEnd > extraStart, "promo extra-filters block");
  const extra = app.slice(extraStart, extraEnd);
  const extraFilterOrder = [
    "Sports",
    "Date",
    "Markets",
    "Liquidity",
    "Matching books",
    "Min Final Odds",
    "Max Final Odds",
    "Min Leg Odds",
    "Max Leg Odds",
    "Must include",
    "Must exclude",
  ].map((label) => extra.indexOf(`<label style={labelStyle}>${label}</label>`));
  assert.ok(extraFilterOrder.every((i) => i >= 0), "Extra Filter labels present");
  assert.deepEqual(extraFilterOrder, [...extraFilterOrder].sort((a, b) => a - b), "team filters after min/max odds");
  assert.match(scanSrc, /acceptCombo/);
  assert.match(scanSrc, /includeTeam/);

  const resetDeps = app.match(/setExpandedFreeBet\(null\);[\s\S]*?\}, \[([^\]]+)\]/);
  assert.ok(resetDeps, "promo page reset effect");
  assert.match(resetDeps[1], /promoTeamInclude/);
  assert.match(resetDeps[1], /promoTeamExclude/);
  assert.doesNotMatch(resetDeps[1], /\bstake\b/);
  assert.doesNotMatch(resetDeps[1], /\bboostPct\b/);

  assert.doesNotMatch(app, /localStorage[\s\S]{0,80}promoTeamInclude/);
  assert.doesNotMatch(app, /saveProfilePrefs[\s\S]{0,200}promoTeamInclude/);
  assert.doesNotMatch(profile, /promoTeamInclude|promoTeamExclude|teamInclude|teamExclude/);
  assert.doesNotMatch(share, /promoTeamInclude|promoTeamExclude/);
  const hashWrites = [...app.matchAll(/serializeAppHash\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
  assert.ok(hashWrites.length);
  for (const call of hashWrites) {
    assert.doesNotMatch(call, /promoTeamInclude|promoTeamExclude|includeTeamTokens/);
  }

  const combo = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.doesNotMatch(combo, /promoTeamInclude|filterPicksByTeamName/);
  const worker = fs.readFileSync(path.join(dir, "../worker/ev-parlay-alerts.js"), "utf8");
  assert.doesNotMatch(worker, /promoTeamFilter|promoTeamInclude/);
}

console.log("promoTeamFilter.test.js: ok");
