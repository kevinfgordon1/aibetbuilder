// Fail the build if Vite left a raw CommonJS `module.exports` in the browser
// bundle. That assignment throws `module is not defined` and blanks the page.
import fs from "node:fs";
import path from "node:path";

const assetsDir = path.resolve("dist/assets");
const needle = "module.exports";
// Match a real assignment only (e.g. `}module.exports={`), not prose such as the
// inlined VITE_VERCEL_GIT_COMMIT_MESSAGE that may mention the phrase.
const pattern = /(^|[^\w$.])module\.exports\s*=(?!=)/;

if (!fs.existsSync(assetsDir)) {
  console.error(`assert-no-cjs-in-dist: missing ${assetsDir}`);
  process.exit(1);
}

const hits = [];
for (const name of fs.readdirSync(assetsDir)) {
  const file = path.join(assetsDir, name);
  if (!fs.statSync(file).isFile()) continue;
  const text = fs.readFileSync(file, "utf8");
  if (pattern.test(text)) hits.push(name);
}

if (hits.length) {
  console.error(`assert-no-cjs-in-dist: ${needle} shipped to the browser in ${hits.join(", ")}`);
  for (const name of hits) {
    const text = fs.readFileSync(path.join(assetsDir, name), "utf8");
    let from = 0;
    let shown = 0;
    while (shown < 3) {
      const m = pattern.exec(text.slice(from));
      if (!m) break;
      const at = from + m.index;
      const snippet = text.slice(Math.max(0, at - 180), Math.min(text.length, at + needle.length + 180)).replace(/\s+/g, " ");
      console.error(`  ${name}@${at}: …${snippet}…`);
      from = at + needle.length;
      shown += 1;
    }
  }
  process.exit(1);
}

console.log("assert-no-cjs-in-dist: ok");
