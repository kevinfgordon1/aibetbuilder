import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_LOGO_DIR, bookLogo } from "./bookLogos.js";
import { BETSTAMP_TRIAL_BOOKS } from "./betstampBooks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = path.join(root, "public", "book-logos");

assert.equal(BOOK_LOGO_DIR, "/book-logos");
assert.equal(bookLogo("fanduel"), "/book-logos/fanduel.svg");
assert.equal(bookLogo("williamhill_us"), "/book-logos/williamhill_us.svg");

const requiredKeys = [
  "fanduel",
  "draftkings",
  "williamhill_us",
  "pinnacle",
  "betonlineag",
  "betcris",
  "circa",
  "bet365",
  "prophetx",
  "polymarket",
  "kalshi",
];

for (const book of BETSTAMP_TRIAL_BOOKS) {
  assert.equal(book.logo, bookLogo(book.key), `${book.key} should use self-hosted bookLogo()`);
  assert.ok(!String(book.logo).includes("favicon"), `${book.key} must not hotlink a favicon`);
}

for (const key of requiredKeys) {
  const file = path.join(logoDir, `${key}.svg`);
  assert.ok(fs.existsSync(file), `missing ${file}`);
  const body = fs.readFileSync(file, "utf8");
  assert.match(body, /<svg\b/, `${key}.svg should be SVG`);
  assert.ok(body.length < 12_000, `${key}.svg should stay compact`);
}

const appSrc = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
assert.match(appSrc, /import \{ bookLogo \} from "\.\/bookLogos\.js"/);
assert.doesNotMatch(appSrc, /favicon\.ico/);
for (const key of ["draftkings", "fanduel", "betmgm", "fanatics", "bovada", "novig", "betopenly"]) {
  assert.match(appSrc, new RegExp(`logo: bookLogo\\("${key}"\\)`), `ALL_BOOKS ${key} should use bookLogo()`);
}

const boards = [
  fs.readFileSync(path.join(root, "src", "OddsBoard.jsx"), "utf8"),
  fs.readFileSync(path.join(root, "src", "BetstampOddsBoard.jsx"), "utf8"),
];
for (const src of boards) {
  assert.match(src, /import BookMark from "\.\/BookMark\.jsx"/);
  assert.match(src, /<BookMark book=\{b\} size=\{14\} \/>/);
  assert.match(src, /<BookMark book=\{b\} size=\{16\} \/>/);
}
