// Free Bet single-leg conversion cards show the game start (ET) on both the
// FREE BET ON leg and the HEDGE WITH CASH leg, like parlay leg chips do.
// (Kevin, 2026-10-28: dates were missing on single legs. The date lived only
// in the old expanded "How to lock in" section removed in #285.)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const start = app.indexOf(">Free Bet On</div>");
const end = app.indexOf("hedge stake</div>", start);
assert.ok(start > 0 && end > start, "Free Bet conversion card not found");
const card = app.slice(start, end);
const hedgeAt = card.indexOf(">Hedge With Cash</div>");
assert.ok(hedgeAt > 0);
assert.match(card.slice(0, hedgeAt), /<PromoLegStartTime commence_time=\{leg\?\.commence_time\} \/>/, "free-bet leg shows its start time");
assert.match(card.slice(hedgeAt), /<PromoLegStartTime commence_time=\{leg\?\.commence_time\} \/>/, "hedge leg shows its start time");
// Guaranteed Profit dropdown: Step 2 (hedge) shows the start time too.
const step2 = app.slice(app.indexOf("Step 2 — Hedge with cash on {hedgeBookLabel}"), app.indexOf("cash hedge</div>"));
assert.match(step2, /formatET\(leg\.commence_time\)/);
// PromoLegStartTime prints the same "Oct 28, 7:10 PM ET" line as parlay chips.
assert.match(app, /function PromoLegStartTime\(\{ commence_time \}\) \{[\s\S]{0,200}\{formatET\(commence_time\)\}/);
console.log("promoFreeBetLegDate.test.js ok");
