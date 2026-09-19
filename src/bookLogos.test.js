import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_LOGO_DIR, bookLogo } from "./bookLogos.js";
import { BETSTAMP_TRIAL_BOOKS, visibleBetstampBooks, UNDERDOG_PREDICT_BOOK_KEY } from "./betstampBooks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = path.join(root, "public", "book-logos");

assert.equal(BOOK_LOGO_DIR, "/book-logos");
assert.equal(bookLogo("fanduel"), "/book-logos/fanduel.png");
assert.equal(bookLogo("underdog_predict"), "/book-logos/underdog_predict.png");
assert.equal(bookLogo(""), null);
assert.equal(bookLogo(null), null);

const missingLogos = [];
for (const book of BETSTAMP_TRIAL_BOOKS) {
  assert.equal(book.logo, bookLogo(book.key), `${book.key} should use self-hosted bookLogo()`);
  assert.ok(book.logo, `${book.label} must have a logo src`);
  const file = path.join(logoDir, `${book.key}.png`);
  if (!fs.existsSync(file)) missingLogos.push(book.key);
  else {
    const body = fs.readFileSync(file);
    assert.ok(body.length > 200, `${book.key}.png looks empty`);
    assert.ok(body.length < 20_000, `${book.key}.png should stay compact`);
    assert.equal(body[0], 0x89, `${book.key}.png should start with PNG magic`);
    assert.equal(body[1], 0x50);
    assert.equal(body[2], 0x4e);
    assert.equal(body[3], 0x47);
  }
}
assert.deepEqual(missingLogos, [], `missing logo files: ${missingLogos.join(", ")}`);

assert.equal(visibleBetstampBooks(null).some((b) => b.key === UNDERDOG_PREDICT_BOOK_KEY), false);
assert.equal(visibleBetstampBooks({ email: "kev120909@gmail.com" }).some((b) => b.key === UNDERDOG_PREDICT_BOOK_KEY), true);
assert.equal(
  visibleBetstampBooks({ email: "stranger@gmail.com" }).some((b) => b.key === UNDERDOG_PREDICT_BOOK_KEY),
  false,
);

const board = fs.readFileSync(path.join(root, "src", "BetstampOddsBoard.jsx"), "utf8");
const label = fs.readFileSync(path.join(root, "src", "BookLabel.jsx"), "utf8");
assert.match(board, /import BookLabel from "\.\/BookLabel\.jsx"/);
assert.match(board, /data-book-chip=\{b\.key\}/);
assert.match(board, /<BookLabel book=\{b\} size=\{14\} \/>/);
assert.match(board, /<BookLabel book=\{b\} size=\{16\} \/>/);
assert.match(board, /data-book-header=\{b\.key\}/);
assert.match(board, /b\.key === "best" \? b\.label : <BookLabel book=\{b\} size=\{16\} \/>/);
assert.match(label, /data-book-logo=\{book\.key\}/);
assert.match(label, /onError=\{\(\) => setLogoError\(true\)\}/);
assert.match(label, /showLogo \? \(/);
assert.match(label, /<span>\{text\}<\/span>/);
assert.doesNotMatch(label, /bookInitials/);
assert.match(label, /rgba\(255,255,255,0\.92\)/);

console.log("bookLogos.test.js ok");
