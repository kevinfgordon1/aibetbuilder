import assert from "node:assert/strict";
import { finalOutcome } from "./rootForCompute.js";
assert.equal(finalOutcome({ HOU: 0.989, "JAC<3": 0, "JAC>=3": 0.011 }, ["JAC>=3", "JAC<3", "HOU"]), "HOU");
assert.equal(finalOutcome({ HOU: 0.989, JAC: 0.011 }, ["JAC>=3", "JAC<3", "HOU"]), "HOU");
assert.equal(finalOutcome({ "JAC>=3": 0.97, HOU: 0.03 }, ["JAC", "HOU"]), "JAC");
assert.equal(finalOutcome({ JAC: 0.97, HOU: 0.03 }, ["JAC>=3", "JAC<3", "HOU"]), null);
assert.equal(finalOutcome({ yes: 0.6, no: 0.4 }, ["yes", "no"]), null);
assert.equal(finalOutcome({ yes: 0.98, no: 0.02 }, ["yes", "no"]), "yes");
console.log("rootForCompute finals ok");
