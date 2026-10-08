// Lock card summary click → toggle Details, except on controls or a text selection.
import assert from "node:assert/strict";
import { shouldToggleFromCard, CARD_CONTROL_SELECTOR } from "./comboCardToggle.js";

const card = { closest: () => null };
const ev = (target, currentTarget = card) => ({ target, currentTarget });
const el = (match) => ({ closest: (sel) => (sel === CARD_CONTROL_SELECTOR ? match : null) });
globalThis.window = { getSelection: () => "" };
assert.equal(shouldToggleFromCard(ev(el(null))), true);
const sw = { role: "switch" };
assert.equal(shouldToggleFromCard(ev(el(sw))), false);
assert.equal(shouldToggleFromCard(ev(el(card))), true);
globalThis.window = { getSelection: () => "Kansas City" };
assert.equal(shouldToggleFromCard(ev(el(null))), false);
globalThis.window = { getSelection: () => "  " };
assert.equal(shouldToggleFromCard(ev(el(null))), true);
assert.match(CARD_CONTROL_SELECTOR, /button/);
assert.match(CARD_CONTROL_SELECTOR, /\[role=switch\]/);
assert.match(CARD_CONTROL_SELECTOR, /a,/);
assert.match(CARD_CONTROL_SELECTOR, /input/);
assert.match(CARD_CONTROL_SELECTOR, /label/);
delete globalThis.window;
console.log("comboCardClick.test.js ok");
