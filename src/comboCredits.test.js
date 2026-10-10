import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  CREDIT_PRESETS_USD, CREDITS_PRICING, addCreditsState, balanceFromLedger, creditsText, fillFeeUsd, isMissingCreditsSchema,
  isPresetAmount, ledgerLabel, showUsdcCreditsEnabled, monthlyAllowanceUsd, returnNote, showCreditsCardFromEnv, showCreditsCardEnabled,
} from "./comboCredits.js";

const require = createRequire(import.meta.url);
const serverLib = require("../api/combo-credits-lib.js");

// Pricing stays OFF until Kevin approves pricing and gets legal sign-off.
assert.equal(CREDITS_PRICING.feesEnabled, false);
assert.equal(CREDITS_PRICING.allowanceEnabled, false);
assert.equal(CREDITS_PRICING.feeRate, 0.01);
assert.equal(fillFeeUsd(200), 0);
assert.equal(monthlyAllowanceUsd(), 0);
assert.equal(fillFeeUsd(200, { feeRate: 0.01, feesEnabled: true }), 2);
assert.equal(fillFeeUsd(33.33, { feeRate: 0.01, feesEnabled: true }), 0.33);
assert.equal(fillFeeUsd(-5, { feeRate: 0.01, feesEnabled: true }), 0);
assert.equal(monthlyAllowanceUsd({ allowanceEnabled: true, monthlyAllowanceUsd: 5 }), 5);

// Presets; server mirror matches.
assert.deepEqual([...CREDIT_PRESETS_USD], [10, 25, 50, 100]);
assert.deepEqual([...serverLib.CREDIT_PRESETS_USD], [...CREDIT_PRESETS_USD]);
assert.ok(isPresetAmount(25) && !isPresetAmount(26) && serverLib.isPresetAmount("50") && !serverLib.isPresetAmount(1e6));

// Ledger math.
assert.equal(balanceFromLedger([{ amount_usd: "25.00" }, { amount_usd: "-0.33" }, { amount_usd: 10.1 }]), 34.77);
assert.equal(balanceFromLedger([]), 0);
assert.equal(creditsText(34.77), "$34.77");
assert.equal(creditsText("x"), "—");
assert.equal(ledgerLabel({ kind: "deposit" }), "Added with USDC");
assert.equal(ledgerLabel({ kind: "fee" }), "Combo Locks fee");
assert.equal(ledgerLabel({ kind: "deposit", source: "stripe_checkout" }), "Added with card");
assert.equal(ledgerLabel({ kind: "refund", source: "stripe_refund" }), "Refunded to card");
assert.equal(addCreditsState({ configured: true, busy: "card" }).note, "Opening card checkout…");

// Button state: degrades to "coming soon" when Coinbase isn't configured.
assert.deepEqual(addCreditsState({ configured: false }), { disabled: true, note: "Coming soon. Adding credits isn't switched on yet." });
assert.equal(addCreditsState({ configured: true }).disabled, false);
assert.equal(addCreditsState({ configured: true, busy: true }).disabled, true);
assert.equal(addCreditsState({ loading: true }).disabled, true);

assert.equal(returnNote("?credits=paid").kind, "ok");
assert.equal(returnNote("?credits=failed").kind, "warn");
assert.equal(returnNote("?x=1"), null);

assert.ok(isMissingCreditsSchema({ code: "42P01", message: "relation does not exist" }));
assert.ok(isMissingCreditsSchema({ code: "PGRST205", message: "Could not find the table 'public.combo_credit_balances' in the schema cache" }));
assert.ok(!isMissingCreditsSchema({ code: "500", message: "timeout" }));

// Credits card is off by default; only explicit truthy env values show it.
assert.equal(showCreditsCardFromEnv(undefined), false);
assert.equal(showCreditsCardFromEnv(""), false);
assert.equal(showCreditsCardFromEnv("0"), false);
assert.equal(showCreditsCardFromEnv("false"), false);
assert.equal(showCreditsCardFromEnv("off"), false);
assert.equal(showCreditsCardFromEnv("1"), true);
assert.equal(showCreditsCardFromEnv("true"), true);
assert.equal(showCreditsCardFromEnv("ON"), true);
const prevVite = process.env.VITE_SHOW_CREDITS_CARD;
const prevShow = process.env.SHOW_CREDITS_CARD;
delete process.env.VITE_SHOW_CREDITS_CARD;
delete process.env.SHOW_CREDITS_CARD;
assert.equal(showCreditsCardEnabled(), false);
process.env.VITE_SHOW_CREDITS_CARD = "1";
assert.equal(showCreditsCardEnabled(), true);
process.env.VITE_SHOW_CREDITS_CARD = "0";
assert.equal(showCreditsCardEnabled(), false);
if (prevVite === undefined) delete process.env.VITE_SHOW_CREDITS_CARD; else process.env.VITE_SHOW_CREDITS_CARD = prevVite;
if (prevShow === undefined) delete process.env.SHOW_CREDITS_CARD; else process.env.SHOW_CREDITS_CARD = prevShow;


// Redirect origin stays on our site.
assert.equal(serverLib.siteOrigin({ headers: { host: "aibetbuilder.io" } }, {}), "https://aibetbuilder.io");
assert.equal(serverLib.siteOrigin({ headers: { "x-forwarded-host": "aibetbuilder-abc-kevin.vercel.app" } }, {}), "https://aibetbuilder-abc-kevin.vercel.app");
assert.equal(serverLib.siteOrigin({ headers: { host: "evil.example.com" } }, {}), "https://aibetbuilder.io");

console.log("comboCredits tests passed");

{ const prev = process.env.VITE_SHOW_USDC_CREDITS; delete process.env.VITE_SHOW_USDC_CREDITS;
  assert.equal(showUsdcCreditsEnabled(), false);
  process.env.VITE_SHOW_USDC_CREDITS = "1"; assert.equal(showUsdcCreditsEnabled(), true);
  if (prev === undefined) delete process.env.VITE_SHOW_USDC_CREDITS; else process.env.VITE_SHOW_USDC_CREDITS = prev; }

// Per-user fees: 1% of amount at risk, all-in <-> exchange price.
{
  const m = await import("./comboCredits.js");
  assert.equal(m.lockFillFeeUsd(23.47, 0.08), 0.22); // 0.01 x 23.47 x 0.92 = 0.2159
  assert.equal(m.lockFillFeeUsd(100, 0.5), 0.5);
  assert.equal(m.lockFillFeeUsd(0, 0.5), 0);
  assert.equal(m.allInFromExchange(1150), 1162); // fee analysis: lay -1150 -> -1162 with fee
  assert.equal(m.exchangeFromAllIn(1162), 1150);
  assert.equal(m.exchangeFromAllIn(404), 400);
  assert.equal(m.allInFromExchange(-150), -148);
  assert.equal(m.exchangeFromAllIn(-149), -151);
  for (const a of [150, 400, 999, 1150, 2500, -120, -200]) {
    const back = m.exchangeFromAllIn(m.allInFromExchange(a));
    const dec = (x) => (x > 0 ? x / 100 : 100 / -x);
    assert.ok(dec(back) <= dec(a) + 1e-9, `round trip never quotes above ${a}: ${back}`);
  }
  assert.equal(m.feeStatusFromRow(null), null);
  assert.equal(m.feeStatusFromRow({ fees_enabled: false }), null);
  const st = m.feeStatusFromRow({ fees_enabled: true, monthly_allowance_usd: "100", allowance_used_usd: "100", allowance_left_usd: "0", credits_usd: "0", can_quote: false });
  assert.equal(st.canQuote, false);
  assert.match(m.feeGateNote(st), /^Add credits to keep quoting/);
  assert.equal(m.feeGateNote({ ...st, canQuote: true }), null);
  assert.equal(m.allowanceResetText(new Date("2026-10-31T23:00:00-04:00")), "Resets Nov 1");
  assert.equal(m.allowanceResetText(new Date("2026-12-15T12:00:00Z")), "Resets Jan 1");
}
