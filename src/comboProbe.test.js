import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  formatAmerican,
  formatNoBid,
  fillBeatsMarket,
  probeDisabled,
  formatProbeNote,
} from "./comboProbe.js";

assert.equal(formatAmerican(1200), "+1200");
assert.equal(formatAmerican(-110), "-110");
assert.equal(formatAmerican(null), "—");
assert.equal(formatNoBid(0.92), "$0.92");

assert.equal(fillBeatsMarket(1300, 1200), true);
assert.equal(fillBeatsMarket(1200, 1200), false);
assert.equal(fillBeatsMarket(1100, 1200), false);
assert.equal(fillBeatsMarket(null, 1200), null);

assert.equal(probeDisabled({ probing: false, legCount: 2, contracts: 750 }), false);
assert.equal(probeDisabled({ probing: true, legCount: 2, contracts: 750 }), true);
assert.equal(probeDisabled({ probing: false, legCount: 1, contracts: 750 }), true);
assert.equal(probeDisabled({ probing: false, legCount: 2, contracts: 0 }), true);

assert.match(
  formatProbeNote({
    ok: true,
    bestAmerican: 1184,
    bestNoBid: 0.92,
    quoteCount: 3,
    contracts: 750,
    waitedMs: 4000,
    suggestFillAmerican: 1329,
  }, 1000),
  /Best market \+1184 \(NO \$0\.92\) from 3 quotes at 750 contracts/,
);
assert.match(
  formatProbeNote({
    ok: true,
    bestAmerican: 1184,
    bestNoBid: 0.92,
    quoteCount: 3,
    suggestFillAmerican: 1329,
  }, 1000),
  /does not beat it.*Suggested fill \+1329/,
);
assert.match(
  formatProbeNote({
    ok: true,
    bestAmerican: 1184,
    bestNoBid: 0.92,
    quoteCount: 1,
  }, 1400),
  /beats it/,
);
assert.match(
  formatProbeNote({ ok: true, quoteCount: 0, waitedMs: 4001, contracts: 583, rfqId: "rfq-abc" }, 414),
  /0 quotes returned from Kalshi in 4001ms at 583 contracts\. RFQ rfq-abc\./,
);
assert.match(
  formatProbeNote({
    ok: true,
    quoteCount: 3,
    usableQuoteCount: 0,
    bestAmerican: null,
    waitedMs: 4001,
    contracts: 583,
    rfqId: "rfq-abc",
  }, 414),
  /3 quotes from Kalshi but no usable NO bid in 4001ms at 583 contracts\. RFQ rfq-abc\./,
);
assert.match(
  formatProbeNote({ ok: true, quoteCount: 0, waitedMs: 2100, listError: "must provide user filter" }, 414),
  /Kalshi quote list failed in 2100ms: must provide user filter/,
);
assert.equal(formatProbeNote({ ok: false, error: "Sign in required" }), "Sign in required");

{
  const src = fs.readFileSync(path.join(__dirname, "ComboLocks.jsx"), "utf8");
  assert.match(src, /\{probing \? "Probing…" : "Probe"\}/);
  assert.match(src, /Find the current best odds on the market for this combo size/);
  assert.match(src, /Finds the current best odds available on the market right now \(for this combo size\)/);
  assert.match(src, /\/api\/combo-probe/);
  assert.match(src, /authorization: "Bearer "/);
  assert.match(src, /waitMs:\s*8000/);
}

console.log("comboProbe ui tests passed");
