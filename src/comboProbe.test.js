import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  formatAmerican,
  fillBeatsMarket,
  probeDisabled,
  formatProbeNote,
  probeUiState,
  CONNECT_KALSHI_LABEL,
} from "./comboProbe.js";

assert.equal(formatAmerican(1200), "+1200");
assert.equal(formatAmerican(-110), "-110");
assert.equal(formatAmerican(null), "—");

assert.equal(fillBeatsMarket(1300, 1200), true);
assert.equal(fillBeatsMarket(1200, 1200), false);
assert.equal(fillBeatsMarket(1100, 1200), false);
assert.equal(fillBeatsMarket(null, 1200), null);

assert.equal(probeDisabled({ probing: false, legCount: 2, contracts: 750 }), false);
assert.equal(probeDisabled({ probing: true, legCount: 2, contracts: 750 }), true);
assert.equal(probeDisabled({ probing: false, legCount: 1, contracts: 750 }), true);
assert.equal(probeDisabled({ probing: false, legCount: 2, contracts: 0 }), true);

// Plain words, American odds only: no NO cents, no request ids.
assert.equal(
  formatProbeNote({ ok: true, bestAmerican: 2577, bestNoBid: 0.96, quoteCount: 14, contracts: 2811, waitedMs: 8000, suggestFillAmerican: 3291, rfqId: "f3df1234" }, 2571),
  "Best price traders are paying right now: +2577 (14 quotes, 2,811 contracts). Your +2571 doesn't beat it. Try +3291 or better.",
);
assert.equal(
  formatProbeNote({ ok: true, bestAmerican: 1184, bestNoBid: 0.92, quoteCount: 1 }, 1400),
  "Best price traders are paying right now: +1184 (1 quote). Your +1400 beats it, so it should get taken.",
);
assert.equal(
  formatProbeNote({ ok: true, bestAmerican: 1184, quoteCount: 3, contracts: 750 }, null),
  "Best price traders are paying right now: +1184 (3 quotes, 750 contracts).",
);
assert.equal(
  formatProbeNote({ ok: true, quoteCount: 0, waitedMs: 4001, contracts: 583, rfqId: "rfq-abc" }, 414),
  "No trader quoted this parlay in 4 seconds (583 contracts). Try again closer to game time.",
);
assert.equal(
  formatProbeNote({ ok: true, quoteCount: 3, usableQuoteCount: 0, bestAmerican: null, waitedMs: 4001, contracts: 583, rfqId: "rfq-abc" }, 414),
  "3 traders answered but none with a usable price (583 contracts). Try again closer to game time.",
);
assert.equal(
  formatProbeNote({ ok: true, quoteCount: 0, waitedMs: 2100, listError: "must provide user filter" }, 414),
  "Couldn't read the market's quotes. Try again in a minute.",
);
assert.equal(formatProbeNote({ ok: false, error: "Sign in required" }), "Sign in required");
for (const r of [
  { ok: true, bestAmerican: 2577, bestNoBid: 0.96, quoteCount: 14, contracts: 2811, suggestFillAmerican: 3291, rfqId: "f3df1234" },
  { ok: true, quoteCount: 0, rfqId: "rfq-abc" },
]) {
  const t = formatProbeNote(r, 2571);
  assert.doesNotMatch(t, /NO \$|¢|\$0\.|rfq|RFQ|request [0-9a-f]|f3df/);
}


// Testers see the button when Kalshi is connected; otherwise Connect Kalshi copy.
{
  const owner = probeUiState({ canSeeCombo: true, isOwner: true, kalshiConnected: false, probing: false, legCount: 2, contracts: 10 });
  assert.equal(owner.show, true);
  assert.equal(owner.kind, "ready");
  assert.equal(owner.label, "Check market price");
  const need = probeUiState({ canSeeCombo: true, isOwner: false, kalshiConnected: false, probing: false, legCount: 2, contracts: 10 });
  assert.equal(need.kind, "need-key");
  assert.equal(need.disabled, true);
  assert.equal(need.label, CONNECT_KALSHI_LABEL);
  assert.equal(CONNECT_KALSHI_LABEL, "Connect Kalshi to check price");
  const ready = probeUiState({ canSeeCombo: true, isOwner: false, kalshiConnected: true, probing: false, legCount: 2, contracts: 10 });
  assert.equal(ready.kind, "ready");
  assert.equal(ready.label, "Check market price");
  assert.equal(probeUiState({ canSeeCombo: false }).show, false);
}

{
  const src = fs.readFileSync(path.join(__dirname, "ComboLocks.jsx"), "utf8");
  assert.match(src, /probeUiState/);
  assert.match(src, /CONNECT_KALSHI_LABEL|Connect Kalshi to check price/);
  assert.match(src, /data-testid="check-market-price"/);
  assert.match(src, /Ask the market for its best price on this parlay at this size/);
  assert.match(src, /shows the best price traders would pay for this parlay right now/);
  assert.match(src, /\/api\/combo-probe/);
  assert.match(src, /authorization: "Bearer "/);
  assert.match(src, /waitMs:\s*8000/);
  assert.match(src, /\/api\/combo-keys/);
  assert.match(src, /\{formatProbeNote\(probeResult, form\.fill === "" \? null : \+form\.fill\)\}/);
  // Kevin removed these from the Add a lock form.
  assert.doesNotMatch(src, /Load example|loadExample|Test a request|See what it would do|const simulate|setSim\(/);
  assert.match(src, /className="add-lock" ref=\{createFormRef\}/);
}

console.log("comboProbe ui tests passed");
