import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playerPropEmptyDetail, playerPropHiddenCounts } from "./promoPlayerPropHint.js";

assert.deepEqual(playerPropHiddenCounts({ unfiltered: 10, matched: 7, liquid: 2 }), { matching: 3, liquidity: 5 });
assert.deepEqual(playerPropHiddenCounts({ unfiltered: [1, 2], matched: [1, 2], liquid: [1, 2] }), { matching: 0, liquidity: 0 });

assert.equal(playerPropEmptyDetail({ marketScope: "all", resultCount: 0, hidden: { liquidity: 5 } }), null);
assert.equal(playerPropEmptyDetail({ marketScope: "props", resultCount: 3, hidden: { liquidity: 5 } }), null);
assert.equal(playerPropEmptyDetail({ marketScope: "props", resultCount: 0, hidden: { liquidity: 0, matching: 0 } }), null);
assert.equal(playerPropEmptyDetail({ marketScope: "props", resultCount: 0, hidden: null }), null);

const liq = playerPropEmptyDetail({ marketScope: "props", resultCount: 0, hidden: { liquidity: 372, matching: 0 } });
assert.match(liq, /^372 player-prop legs are hidden by Hide low liquidity/);
assert.match(liq, /Set Liquidity to All/);
const one = playerPropEmptyDetail({ marketScope: "props", resultCount: 0, hidden: { liquidity: 1 } });
assert.match(one, /^1 player-prop leg is hidden/);
const both = playerPropEmptyDetail({ marketScope: "props", resultCount: 0, hidden: { liquidity: 4, matching: 12 } });
assert.match(both, /4 player-prop legs are hidden by Hide low liquidity/);
assert.match(both, /12 player-prop legs are hidden because their only fair price comes from a book unchecked in Matching books/);

// Wired next to the soccer hint on every promo empty state.
const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"), "utf8");
assert.match(app, /\}\) \|\| playerPropEmptyDetail\(\{\s*marketScope: scanMarketScope,\s*resultCount: promoRankedCount,\s*hidden: playerPropHidden,/);
assert.match(app, /const playerPropHidden = useMemo\(/);

console.log("promoPlayerPropHint.test.js ok");
