import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_SCOPES,
  isMoneylineLeg,
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
];

{
  assert.deepEqual(MARKET_SCOPES.map((o) => o.val), ["all", "main", "ml", "alt"]);
  assert.equal(MARKET_SCOPES.find((o) => o.val === "ml").label, "Moneylines");
  assert.equal(MARKET_SCOPES.find((o) => o.val === "main").label, "Main");
}

{
  assert.equal(isMoneylineLeg({ market: "ML" }), true);
  assert.equal(isMoneylineLeg({ market: "SPR" }), false);
  assert.equal(isMoneylineLeg({ market: "TOT" }), false);
  assert.equal(isMoneylineLeg({ market: "TT" }), false);
  assert.equal(isMoneylineLeg({ name: "Yankees ML", market: "SPR" }), false);
  assert.equal(isMoneylineLeg(null), false);
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
}

{
  assert.deepEqual(scopePromoLegs(null, "ml"), []);
  assert.deepEqual(scopePromoLegs(undefined, "main"), []);
  assert.equal(scopePromoLegs(legs, "unknown"), legs);
}

{
  assert.equal(marketScopeSummary("main"), "mains");
  assert.equal(marketScopeSummary("alt"), "alts");
  assert.equal(marketScopeSummary("ml"), "moneylines");
  assert.equal(marketScopeSummary("all"), "all");
  assert.equal(marketScopeSummary(""), "all");
}

// ── App.jsx Extra Filters: chip row + scan pool uses shared helper
{
  assert.match(app, /import \{\s*MARKET_SCOPES,\s*scopePromoLegs,\s*marketScopeSummary,\s*\} from "\.\/promoMarketScope\.js"/);
  assert.match(app, /const \[marketScope, setMarketScope\] = useState\("all"\)/);
  assert.match(app, /scopePromoLegs\(promoLegsAll, marketScope\)/);
  assert.match(app, /marketScopeSummary\(marketScope\)/);
  assert.match(app, /MARKET_SCOPES\.map\(opt =>/);
  assert.match(app, /<label style=\{labelStyle\}>Markets<\/label>/);
  assert.doesNotMatch(app, /const MARKET_SCOPES = \[/);
}

console.log("promoMarketScope.test.js: ok");
