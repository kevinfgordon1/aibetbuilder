// Structure guard for the locked-pick card: one Guaranteed Profit dropdown
// holds STEP 1 / STEP 2, one outcome table, the bottom line, and a collapsed
// "Show the math". No separate "How to lock in" section or outcome matrix.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const start = app.indexOf("function GuaranteedBadge(");
const end = app.indexOf("function transformOddsData(");
assert.ok(start > 0 && end > start);
const badge = app.slice(start, end);

assert.match(badge, /Step 1 — Use your free bet on/);
assert.match(badge, /Step 1 — Place your no-sweat cash bet on/);
assert.match(badge, /Step 2 — Hedge with cash on/);
assert.match(badge, /data-lock-outcomes/);
assert.match(badge, /Bottom line:/);
assert.match(badge, /Show the math/);
assert.match(badge, /useState\(false\);\s*\n\s*const \[mathOpen, setMathOpen\] = useState\(false\)/);

assert.doesNotMatch(app, /How to lock in/);
assert.doesNotMatch(app, /Outcome matrix/);
assert.doesNotMatch(app, /LockMathRow/);
// Free Bet and No Sweat cards: tapping the card opens the dropdown.
assert.match(app, /onToggle=\{\(next\) => setExpandedFreeBet\(next \? promoId : null\)\}/);
assert.match(app, /onToggle=\{\(next\) => setExpandedPromo\(next \? promoId : null\)\}/);
assert.match(app, /isExpanded && !showLock && \(/);
assert.match(app, /isExpanded && !p\.isGuaranteed && \(/);

console.log("promoLockCard.test.js ok");
