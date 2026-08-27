import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMBO_MAKER_FEE,
  TAKER_FEE,
  impliedProb,
  americanFromProb,
  floor2,
  nominalProbFromEff,
  afterFeeYes,
  fillView,
} from "./comboFill.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FILLS = [500, 1000, 1600, 2000];

assert.equal(COMBO_MAKER_FEE, 0.035);
assert.equal(TAKER_FEE, 0.07);
assert.equal(TAKER_FEE / COMBO_MAKER_FEE, 2);

{
  const sEff = impliedProb(1600);
  const sNom = nominalProbFromEff(sEff);
  assert.ok(Math.abs(afterFeeYes(sNom) - sEff) < 1e-12);
}

for (const fill of FILLS) {
  const v = fillView(fill);
  assert.match(v.noBid, /^\d+\.\d{2}$/);
  const noBid = Number(v.noBid);
  assert.equal(noBid, floor2(1 - v.sNom));
  assert.ok(noBid <= 1 - v.sNom + 1e-12, `+${fill}: no_bid must not round up`);

  const sNomQuoted = 1 - noBid;
  const sEffQuoted = afterFeeYes(sNomQuoted);
  const effAm = americanFromProb(sEffQuoted);
  const sEffTyped = impliedProb(fill);

  // Flooring no_bid can only raise YES proceeds. After the 0.035 combo maker fee
  // the net sell must not be worse than the typed fill (higher sEff = better sell).
  assert.ok(
    sEffQuoted + 1e-12 >= sEffTyped,
    `+${fill}: after-fee sEff ${sEffQuoted} < typed ${sEffTyped} (no_bid ${v.noBid})`,
  );
  // Plus-money: a better (or equal) sell is a shorter-or-equal American.
  assert.ok(
    effAm <= fill,
    `+${fill}: after-fee American ${effAm} is a worse sell than typed`,
  );
}

// The old standard-maker coefficient (0.0175) under-recovers sNom. Applying the
// real 0.035 combo fee to that no_bid makes the net sell worse than typed.
{
  const fill = 1600;
  const sEff = impliedProb(fill);
  const oldNo = floor2(1 - nominalProbFromEff(sEff, 0.0175));
  const oldEff = afterFeeYes(1 - oldNo, COMBO_MAKER_FEE);
  assert.ok(oldEff < sEff, "0.0175 no_bid is worse than typed after the real 0.035 fee");
  const comboNo = Number(fillView(fill).noBid);
  assert.ok(comboNo < oldNo, "combo curve posts a lower (better) no_bid than 0.0175");
}

{
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.match(locks, /from "\.\/comboFill"/);
  assert.match(locks, /after combo maker fees/);
  assert.match(locks, /2× your combo maker fee/);
  assert.doesNotMatch(locks, /0\.0175/);
  assert.doesNotMatch(locks, /1\.75%/);
  assert.doesNotMatch(locks, /4× your maker fee/);
  assert.doesNotMatch(locks, /const KFEE/);
}

console.log("comboFill.test.js ok");
