// Regenerate lib/player-td.cjs from lib/player-td.mjs.
//
// The browser imports the ESM file. Node API routes (lib/*.js, api/*.js) are
// CommonJS and require the .cjs copy. Never hand-edit the .cjs file, never
// make a .cjs require the .mjs, and never import the .cjs into the client.
//
//   node scripts/build-player-td-cjs.js          # rewrite lib/player-td.cjs
//   node scripts/build-player-td-cjs.js --check  # exit 1 if it is stale
//
// The second header line records the sha256 of the .mjs it was built from.
// lib/player-td-cjs-parity.test.js fails when that hash no longer matches.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "lib", "player-td.mjs");
const outPath = path.join(root, "lib", "player-td.cjs");

export const HEADER = "// Generated from lib/player-td.mjs with esbuild (CommonJS for Node API routes). Do not edit by hand.";
export const HASH_PREFIX = "// Source sha256: ";

export function sourceHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function buildPlayerTdCjs(sourceText) {
  const { code } = transformSync(sourceText, {
    format: "cjs",
    platform: "node",
    loader: "js",
    sourcefile: "lib/player-td.mjs",
  });
  if (/require\(["'][^"']*\.mjs["']\)/.test(code)) {
    throw new Error("player-td.cjs must not require an .mjs file");
  }
  return `${HEADER}\n${HASH_PREFIX}${sourceHash(sourceText)}\n${code}`;
}

function main() {
  const source = fs.readFileSync(srcPath, "utf8");
  const check = process.argv.includes("--check");
  if (check) {
    const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
    const line = current.split("\n")[1] || "";
    if (line !== `${HASH_PREFIX}${sourceHash(source)}`) {
      console.error("lib/player-td.cjs is stale. Run: node scripts/build-player-td-cjs.js");
      process.exit(1);
    }
    console.log("lib/player-td.cjs is up to date");
    return;
  }
  fs.writeFileSync(outPath, buildPlayerTdCjs(source));
  console.log(`wrote ${path.relative(root, outPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
