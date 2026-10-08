import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evEmptyState } from "./evEmptyState.js";

{
  const s = evEmptyState({ dateRange: "24h" });
  assert.equal(s.message, "No bets in the next 24 hours right now.");
  assert.deepEqual(s.action, { label: "See the next 7 days", dateRange: "7d" });
}
{
  const s = evEmptyState({ dateRange: "today" });
  assert.equal(s.message, "No bets for the rest of today right now.");
  assert.equal(s.action.dateRange, "7d");
}
{
  const s = evEmptyState({ dateRange: "24h", bookFilter: "fanduel", bookLabel: "FanDuel" });
  assert.equal(s.message, "No FanDuel bets in the next 24 hours right now.");
  assert.equal(s.action.label, "See the next 7 days");
}
{
  const s = evEmptyState({ dateRange: "7d", bookFilter: "fanduel", bookLabel: "FanDuel" });
  assert.equal(s.message, "No FanDuel bets in the next 7 days right now.");
  assert.deepEqual(s.action, { label: "Show all books", bookFilter: "all" });
}
{
  const s = evEmptyState({ dateRange: "any" });
  assert.equal(s.message, "No bets right now.");
  assert.equal(s.action, null);
  assert.match(s.hint, /5 minutes/);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
assert.match(app, /evEmptyState\(/);
assert.match(app, /data-ev-empty/);

console.log("evEmptyState.test.js ok");
