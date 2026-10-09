import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  CREDIT_PRESETS_USD, CREDITS_PRICING, addCreditsState, balanceFromLedger, creditsText, fillFeeUsd, isMissingCreditsSchema,
  isPresetAmount, ledgerLabel, monthlyAllowanceUsd, returnNote, showCreditsCardFromEnv, showCreditsCardEnabled,
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
