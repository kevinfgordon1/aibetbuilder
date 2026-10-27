import test from "node:test";
import assert from "node:assert/strict";
import { pickTopLevelPage, diagnoseEmptyPromo, shouldShowWizard, WIZARD_DONE_KEY, GLOSSARY, FOOTER_DISCLAIMER } from "./onboarding.js";
const mem = (o = {}) => ({ get length() { return Object.keys(o).length; }, key: (i) => Object.keys(o)[i], getItem: (k) => o[k] ?? null });
test("landing only for plain logged-out /", () => {
  assert.equal(pickTopLevelPage({ pathname: "/", hash: "", search: "" }, mem()), "landing");
  assert.equal(pickTopLevelPage({ pathname: "/", hash: "#promo", search: "" }, mem()), "app");
  assert.equal(pickTopLevelPage({ pathname: "/", hash: "#combo/abc", search: "" }, mem()), "app");
  assert.equal(pickTopLevelPage({ pathname: "/", hash: "", search: "?code=x" }, mem()), "app");
  assert.equal(pickTopLevelPage({ pathname: "/", hash: "", search: "" }, mem({ "sb-xuo-auth-token": "{}" })), "app");
  assert.equal(pickTopLevelPage({ pathname: "/app", hash: "", search: "" }, mem()), "app");
  assert.equal(pickTopLevelPage({ pathname: "/learn/", hash: "", search: "" }, mem()), "learn");
});
test("empty diagnosis names Min Final Odds", () => {
  const d = diagnoseEmptyPromo({ minFinalOdds: "1000", numLegs: 1, sportsCount: 4 });
  assert.equal(d[0].key, "minFinalOdds");
  assert.match(d[0].text, /\+1000.*very long for 1 leg/);
  assert.deepEqual(diagnoseEmptyPromo({ minFinalOdds: "", numLegs: 3, sportsCount: 4, dateRange: "7d" }), []);
});
test("wizard once", () => {
  assert.equal(shouldShowWizard({ storage: mem(), activeTab: "promo" }), true);
  assert.equal(shouldShowWizard({ storage: mem({ [WIZARD_DONE_KEY]: "1" }), activeTab: "promo" }), false);
  assert.equal(shouldShowWizard({ storage: mem(), activeTab: "promo", hasDeepLink: true }), false);
});
test("copy stays compliant", () => {
  const all = GLOSSARY.map((g) => g.def).join(" ") + FOOTER_DISCLAIMER;
  assert.doesNotMatch(all, /guarantee(d)? (profit|win)|risk[- ]free|can't lose/i);
});
import { buildLockShareModel, shareCardResult, shareTweetText, xPostIntentUrl, SHARE_CARD_DISCLAIMER, shareCardBottomLine, buildShareCardModel } from "./shareCard.js";
test("lock share card: legs, hedged outcome, no user fields, no guaranteed wording", () => {
  const m = buildLockShareModel({ user_id: "u1", sportsbook: "DraftKings", parlay_american: 1200, parlay_stake: 100, legs: [{ label: "Lions ML", american: -170 }, { label: "Army ML", american: 195 }] }, { current: { hit: 42.5, miss: 30 } });
  assert.equal(m.kind, "lock");
  assert.equal(m.legs.length, 2);
  assert.equal(m.legs[0].odds, "-170");
  const r = shareCardResult(m);
  assert.match(r.headline, /Hedged: \+\$30/);
  const json = JSON.stringify(m).replace(/"guaranteedCash":null,/, "") + shareTweetText(m) + r.headline + r.sub;
  assert.doesNotMatch(json, /u1|guarantee|risk[- ]free/i);
  assert.match(xPostIntentUrl({ text: "hi", url: "https://www.aibetbuilder.io" }), /^https:\/\/x\.com\/intent\/post\?text=hi&url=https%3A%2F%2Fwww\.aibetbuilder\.io$/);
  assert.match(SHARE_CARD_DISCLAIMER, /Results not guaranteed/);
  const fb = buildShareCardModel({ kind: "promo", promoType: "freebet", stake: 100, guaranteedCash: 70, legs: ["A"] });
  assert.doesNotMatch(shareCardBottomLine(fb), /guaranteed/);
});

test("wizard skips existing accounts", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const old = { id: "u1", created_at: "2026-01-01T00:00:00Z" };
  const fresh = { id: "u2", created_at: "2026-10-27T10:00:00Z" };
  assert.equal(shouldShowWizard({ storage: mem(), activeTab: "promo", user: old, now }), false);
  assert.equal(shouldShowWizard({ storage: mem(), activeTab: "promo", user: fresh, now }), true);
  assert.equal(shouldShowWizard({ storage: mem({ [WIZARD_DONE_KEY + ":u2"]: "1" }), activeTab: "promo", user: fresh, now }), false);
  assert.equal(shouldShowWizard({ storage: mem({ "sb-x-auth-token": "t" }), activeTab: "promo" }), false);
});
