import test from "node:test";
import assert from "node:assert/strict";
import { capLegsMonotonic } from "./promoLegCap.js";
import { findTopParlaysChunked } from "./promoParlayScan.js";

const now = new Date("2026-10-15T16:00:00Z"); // noon ET
const H = 3600 * 1000;
const mk = (name, edge, hoursOut) => ({ name, game: name + " g", edge, commence_time: new Date(now.getTime() + hoursOut * H).toISOString() });

test(">200 legs: 7 Days keeps every leg Today kept, and best EV never drops", async () => {
  const today = Array.from({ length: 30 }, (_, i) => mk("T" + i, 1 + i * 0.01, 3));
  const later = Array.from({ length: 300 }, (_, i) => mk("L" + i, 5 + i * 0.01, 72)); // higher edge, 3 days out
  const byEdge = (ls) => [...ls].sort((a, b) => b.edge - a.edge);
  const narrow = capLegsMonotonic(byEdge(today), "today", 200, now);
  const wide = capLegsMonotonic(byEdge(today.concat(later)), "7d", 200, now);
  for (const l of narrow) assert.ok(wide.includes(l), "dropped " + l.name);
  // Old plain cap would have dropped all Today legs.
  assert.equal(byEdge(today.concat(later)).slice(0, 200).filter((l) => l.name[0] === "T").length, 0);
  // EV that favours Today legs (e.g. live depth): wide best >= narrow best.
  const calc = (ls) => ({ ev: ls.reduce((s, l) => s + (l.name[0] === "T" ? 10 : 1), 0), parlayOdds: 500 });
  const top = async (ls) => (await findTopParlaysChunked(ls, 3, calc, { maxResults: 5, yieldFn: async () => {} }))[0].ev;
  assert.ok((await top(wide)) >= (await top(narrow)));
  assert.ok(wide.length <= 400);
});

test("under the cap nothing is dropped", () => {
  const ls = [mk("a", 1, 1), mk("b", 2, 100)];
  assert.equal(capLegsMonotonic(ls, "7d", 200, now).length, 2);
});
