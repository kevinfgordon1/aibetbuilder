import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_SCOPES,
  DEFAULT_MARKET_SCOPE,
  isMoneylineLeg,
  normalizeMarketScope,
  toggleMarketScope,
  isMarketScopeSelected,
  isAllMarketScope,
  scopeIncludesProps,
  scopeHasExplicitProps,
  isPlayerPropLeg,
  scopePromoLegs,
  marketScopeSummary,
} from "./promoMarketScope.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

const legs = [
  { name: "Yankees ML", market: "ML", isAlt: false },
  { name: "Red Sox ML", market: "ML" },
  { name: "Yankees -1.5", market: "SPR", isAlt: false },
  { name: "Yankees -2.5", market: "SPR", isAlt: true },
  { name: "o8.5", market: "TOT", isAlt: false },
  { name: "o9.5", market: "TOT", isAlt: true },
  { name: "Yankees TT o4.5", market: "TT", isAlt: false },
  { name: "Yankees TT o5.5", market: "TT", isAlt: true },
  { name: "Travis Kelce 1+ TD", market: "TD", playerTd: true, isAlt: false },
];

{
  assert.deepEqual(MARKET_SCOPES.map((o) => o.val), ["all", "main", "ml", "alt", "props"]);
  assert.equal(MARKET_SCOPES.find((o) => o.val === "ml").label, "Moneylines");
  assert.equal(MARKET_SCOPES.find((o) => o.val === "main").label, "Main");
  assert.equal(MARKET_SCOPES.find((o) => o.val === "props").label, "Player Props");
}

{
  assert.equal(isMoneylineLeg({ market: "ML" }), true);
  assert.equal(isMoneylineLeg({ market: "SPR" }), false);
  assert.equal(isMoneylineLeg({ market: "TOT" }), false);
  assert.equal(isMoneylineLeg({ market: "TT" }), false);
  assert.equal(isMoneylineLeg({ name: "Yankees ML", market: "SPR" }), false);
  assert.equal(isMoneylineLeg(null), false);
  assert.equal(isPlayerPropLeg({ market: "TD", playerTd: true }), true);
  assert.equal(isPlayerPropLeg({ market: "TD" }), true);
  assert.equal(isPlayerPropLeg({ market: "ML" }), false);
  assert.equal(isPlayerPropLeg({ market: "SPR" }), false);
  assert.equal(isPlayerPropLeg(null), false);
}

{
  const all = scopePromoLegs(legs, "all");
  assert.equal(all.length, legs.length);

  const main = scopePromoLegs(legs, "main");
  assert.deepEqual(main.map((l) => l.name), [
    "Yankees ML",
    "Red Sox ML",
    "Yankees -1.5",
    "o8.5",
    "Yankees TT o4.5",
  ]);
  assert.ok(main.every((l) => !l.isAlt));
  // Main no longer includes player TD legs.
  assert.ok(!main.some(isPlayerPropLeg));

  const alt = scopePromoLegs(legs, "alt");
  assert.deepEqual(alt.map((l) => l.name), [
    "Yankees -2.5",
    "o9.5",
    "Yankees TT o5.5",
  ]);
  assert.ok(alt.every((l) => l.isAlt));

  const ml = scopePromoLegs(legs, "ml");
  assert.deepEqual(ml.map((l) => l.name), ["Yankees ML", "Red Sox ML"]);
  assert.ok(ml.every((l) => l.market === "ML"));
  assert.ok(!ml.some((l) => l.market === "SPR" || l.market === "TOT" || l.market === "TT"));

  const props = scopePromoLegs(legs, "props");
  assert.deepEqual(props.map((l) => l.name), ["Travis Kelce 1+ TD"]);
  assert.ok(props.every(isPlayerPropLeg));
}

{
  assert.deepEqual(scopePromoLegs(null, "ml"), []);
  assert.deepEqual(scopePromoLegs(undefined, "main"), []);
  assert.equal(scopePromoLegs(legs, "unknown"), legs);
  assert.equal(scopePromoLegs(legs, ["all"]), legs);
  assert.equal(scopePromoLegs(legs, []), legs);
}

// ── Multi-select union
{
  const names = (scope) => scopePromoLegs(legs, scope).map((l) => l.name);
  assert.deepEqual(names(["main", "props"]), [
    "Yankees ML",
    "Red Sox ML",
    "Yankees -1.5",
    "o8.5",
    "Yankees TT o4.5",
    "Travis Kelce 1+ TD",
  ]);
  const mainProps = scopePromoLegs(legs, ["main", "props"]);
  assert.ok(mainProps.some(isPlayerPropLeg));
  assert.ok(mainProps.some((l) => !isPlayerPropLeg(l)));
  assert.ok(!mainProps.some((l) => l.isAlt));
  assert.deepEqual(names(["ml", "props"]), ["Yankees ML", "Red Sox ML", "Travis Kelce 1+ TD"]);
  assert.deepEqual(names(["alt", "props"]), ["Yankees -2.5", "o9.5", "Yankees TT o5.5", "Travis Kelce 1+ TD"]);
  // Union, no duplicates: Main already contains the MLs.
  assert.deepEqual(names(["main", "ml"]), names(["main"]));
  assert.equal(scopePromoLegs(legs, ["main", "alt", "props"]).length, legs.length);
  // Array form matches the legacy single-string form.
  for (const v of ["main", "ml", "alt", "props"]) assert.deepEqual(names([v]), names(v));
}

// ── normalize / migrate old single string values
{
  assert.deepEqual([...DEFAULT_MARKET_SCOPE], ["all"]);
  assert.deepEqual(normalizeMarketScope("all"), ["all"]);
  assert.deepEqual(normalizeMarketScope("main"), ["main"]);
  assert.deepEqual(normalizeMarketScope("props"), ["props"]);
  assert.deepEqual(normalizeMarketScope(""), ["all"]);
  assert.deepEqual(normalizeMarketScope(undefined), ["all"]);
  assert.deepEqual(normalizeMarketScope(null), ["all"]);
  assert.deepEqual(normalizeMarketScope("bogus"), ["all"]);
  assert.deepEqual(normalizeMarketScope([]), ["all"]);
  assert.deepEqual(normalizeMarketScope(["props", "main", "main", "bogus"]), ["main", "props"]);
  assert.deepEqual(normalizeMarketScope(["all", "main"]), ["all"]);
  assert.equal(isAllMarketScope("all"), true);
  assert.equal(isAllMarketScope(["main"]), false);
}

// ── chip toggles
{
  let s = ["all"];
  s = toggleMarketScope(s, "main");
  assert.deepEqual(s, ["main"]); // specific pick turns All off
  s = toggleMarketScope(s, "props");
  assert.deepEqual(s, ["main", "props"]);
  assert.equal(isMarketScopeSelected(s, "main"), true);
  assert.equal(isMarketScopeSelected(s, "props"), true);
  assert.equal(isMarketScopeSelected(s, "all"), false);
  s = toggleMarketScope(s, "main");
  assert.deepEqual(s, ["props"]);
  s = toggleMarketScope(s, "props");
  assert.deepEqual(s, ["all"]); // deselecting everything falls back to All
  assert.deepEqual(toggleMarketScope(["main", "alt", "props"], "all"), ["all"]); // All clears the others
  assert.deepEqual(toggleMarketScope(["all"], "all"), ["all"]);
  assert.deepEqual(toggleMarketScope("main", "props"), ["main", "props"]); // legacy string input
  assert.deepEqual(toggleMarketScope(["main"], "bogus"), ["main"]);
}

// ── props checks
{
  assert.equal(scopeHasExplicitProps(["main", "props"]), true);
  assert.equal(scopeHasExplicitProps("props"), true);
  assert.equal(scopeHasExplicitProps(["all"]), false);
  assert.equal(scopeHasExplicitProps(["main"]), false);
  assert.equal(scopeIncludesProps(["all"]), true);
  assert.equal(scopeIncludesProps(["main", "props"]), true);
  assert.equal(scopeIncludesProps(["main", "alt"]), false);
}

{
  assert.equal(marketScopeSummary("main"), "mains");
  assert.equal(marketScopeSummary("alt"), "alts");
  assert.equal(marketScopeSummary("ml"), "moneylines");
  assert.equal(marketScopeSummary("props"), "player props");
  assert.equal(marketScopeSummary("all"), "all");
  assert.equal(marketScopeSummary(""), "all");
  assert.equal(marketScopeSummary(["all"]), "all");
  assert.equal(marketScopeSummary(["main", "props"]), "mains + player props");
  assert.equal(marketScopeSummary(["props", "main"]), "mains + player props");
  assert.equal(marketScopeSummary(["ml", "alt"]), "moneylines + alts");
  assert.equal(marketScopeSummary([]), "all");
}

// ── App.jsx Extra Filters: chip row + scan pool uses shared helper
{
  assert.match(app, /import \{\s*MARKET_SCOPES,[^}]*scopePromoLegs,[^}]*marketScopeSummary,[^}]*toggleMarketScope,[^}]*\} from "\.\/promoMarketScope\.js"/);
  assert.match(app, /const \[marketScopeRaw, setMarketScope\] = useState\(\(\) => \[\.\.\.DEFAULT_MARKET_SCOPE\]\)/);
  assert.match(app, /normalizeMarketScope\(marketScopeRaw\)/);
  assert.match(app, /setMarketScope\(prev => toggleMarketScope\(prev, opt\.val\)\)/);
  assert.match(app, /scopeHasExplicitProps\(scanMarketScope\)/);
  assert.doesNotMatch(app, /scanMarketScope [!=]== "props"/);
  assert.match(app, /scopePromoLegs\(promoLegsAll, scanMarketScope\)/);
  assert.match(app, /marketScopeSummary\(marketScope\)/);
  assert.match(app, /MARKET_SCOPES\.map\(opt =>/);
  assert.match(app, /<label style=\{labelStyle\}>Markets<\/label>/);
  assert.doesNotMatch(app, /const MARKET_SCOPES = \[/);
}

console.log("promoMarketScope.test.js: ok");
