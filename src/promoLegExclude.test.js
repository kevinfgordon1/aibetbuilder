import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  promoLegIdentity,
  filterExcludedLegs,
  filterParlaysByExcluded,
} from "./promoLegExclude.js";

const sox = { name: "White Sox ML", market: "ML", game: "White Sox @ Yankees", bookKey: "draftkings" };
const soxFd = { name: "White Sox ML", market: "ML", game: "White Sox @ Yankees", bookKey: "fanduel" };
const yanks = { name: "Yankees ML", market: "ML", game: "White Sox @ Yankees", bookKey: "draftkings" };
const cubs = { name: "Cubs ML", market: "ML", game: "Cubs @ Brewers", bookKey: "draftkings" };
const tot = { name: "White Sox/Yankees o8.5", market: "TOT", game: "White Sox @ Yankees", bookKey: "draftkings" };

{
  assert.equal(promoLegIdentity(sox), promoLegIdentity(soxFd));
  assert.notEqual(promoLegIdentity(sox), promoLegIdentity(yanks));
  assert.notEqual(promoLegIdentity(sox), promoLegIdentity(tot));
  assert.notEqual(promoLegIdentity(sox), promoLegIdentity(cubs));
}

{
  const excluded = new Set([promoLegIdentity(sox)]);
  const kept = filterExcludedLegs([sox, soxFd, yanks, cubs, tot], excluded);
  assert.deepEqual(kept.map((l) => l.name + l.bookKey), ["Yankees MLdraftkings", "Cubs MLdraftkings", "White Sox/Yankees o8.5draftkings"]);
  assert.deepEqual(filterExcludedLegs([sox, cubs], new Set()), [sox, cubs]);
}

{
  const parlays = [
    { ev: 12, legs: [sox, cubs] },
    { ev: 9, legs: [cubs, tot] },
    { ev: 4, legs: [soxFd, tot] },
  ];
  const excluded = new Set([promoLegIdentity(sox)]);
  const kept = filterParlaysByExcluded(parlays, excluded);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].ev, 9);
  assert.deepEqual(filterParlaysByExcluded(parlays, new Set()), parlays);
  assert.deepEqual(filterParlaysByExcluded([], excluded), []);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/promoLegExclude"/);
  assert.match(app, /filterExcludedLegs\(/);
  assert.match(app, /setExcludedPromoLegs\(new Set\(\)\)/);
  assert.match(app, /function ExcludeLegButton/);
  assert.match(app, /width: 22,\s*height: 22,\s*minWidth: 22,\s*minHeight: 22,[\s\S]*?fontSize: 14,/);
  assert.doesNotMatch(app, /localStorage/);
  const combo = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.doesNotMatch(combo, /excludedPromoLegs|promoLegIdentity|ExcludeLegButton/);
  const worker = fs.readFileSync(path.join(dir, "../worker/ev-parlay-alerts.js"), "utf8");
  assert.doesNotMatch(worker, /excludedPromoLegs|promoLegExclude|ExcludeLegButton/);
}

console.log("promoLegExclude.test.js: ok");
