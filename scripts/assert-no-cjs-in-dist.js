// Fail the build if Vite left a raw CommonJS `module.exports` in the browser
// bundle. That assignment throws `module is not defined` and blanks the page.
import fs from "node:fs";
import path from "node:path";

const assetsDir = path.resolve("dist/assets");
const needle = "module.exports";

if (!fs.existsSync(assetsDir)) {
  console.error(`assert-no-cjs-in-dist: missing ${assetsDir}`);
  process.exit(1);
}

const hits = [];
for (const name of fs.readdirSync(assetsDir)) {
  const file = path.join(assetsDir, name);
  if (!fs.statSync(file).isFile()) continue;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(needle)) hits.push(name);
}

if (hits.length) {
  console.error(`assert-no-cjs-in-dist: ${needle} shipped to the browser in ${hits.join(", ")}`);
  process.exit(1);
}

console.log("assert-no-cjs-in-dist: ok");
