import assert from "assert";
import { decimalOf, hedgeSummary, activeHedges } from "./sniperHedge.js";
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
// Emanuel Wilson + Woody Marks (prod fill): n 64.75, risk 52.7714; FanDuel +798, $7.21
const f = { n: 64.75, risk: 52.7714, fair: 0.1, baseEv: 2 };
const h = hedgeSummary(f, [{ book: "FanDuel", american: 798, stake: 7.21 }]);
assert.ok(h.locked); near(h.worst, 7.21 * 7.98 - 52.7714); near(h.best, 64.75 - 52.7714 - 7.21);
assert.strictEqual(h.netRisk, 0); near(h.freed, 52.7714); near(h.ev, h.worst);
const p = hedgeSummary(f, [{ american: 798, stake: 3 }]);
assert.ok(!p.locked); near(p.worst, -52.7714 + 23.94); near(p.best, 64.75 - 52.7714 - 3); near(p.ev, 2 + 0.1 * 26.94 - 3);
assert.strictEqual(hedgeSummary(f, [{ american: 798, stake: 7.21, status: "void" }]), null);
assert.strictEqual(hedgeSummary(f, []), null);
assert.strictEqual(activeHedges([{ american: 50, stake: 1 }]).length, 0);
near(decimalOf(-200), 1.5);
console.log("src/sniperHedge.test.js ok");
