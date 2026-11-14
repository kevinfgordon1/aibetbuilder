// Writes the no-JS homepage article, static tool pages, Markdown twins,
// llms.txt, and the Markdown 404 function. Safe to run more than once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRA_HEAD,
  NOT_FOUND_MD,
  homeArticle,
  llmsFull,
  llmsTxt,
  pages,
  standaloneHtml,
  toMarkdown,
  visibleText,
} from "./agent-content.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = (rel, text) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = text.endsWith("\n") ? text : text + "\n";
  fs.writeFileSync(file, next);
};

function replaceMarked(html, name, inner) {
  const start = `<!--${name}:start-->`;
  const end = `<!--${name}:end-->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(html)) throw new Error(`missing ${name} markers in index.html`);
  return html.replace(re, `${start}\n${inner}\n${end}`);
}

let index = fs.readFileSync(path.join(root, "index.html"), "utf8");
index = replaceMarked(index, "agent-extra-head", EXTRA_HEAD);
index = replaceMarked(index, "agent-static", homeArticle());
fs.writeFileSync(path.join(root, "index.html"), index);

const homeText = visibleText(homeArticle());
if (homeText.length < 500) throw new Error(`homepage text is ${homeText.length} chars`);
if ((homeArticle().match(/<h1[\s>]/g) || []).length !== 1) throw new Error("homepage needs exactly one h1");

for (const page of pages) {
  const md = toMarkdown(page);
  if (visibleText(md).length < 500) throw new Error(`${page.path} markdown is short`);
  write(path.join("public", "md", page.mdFile), md);
  if (page.html && page.html !== "index") {
    const html = standaloneHtml(page);
    if ((html.match(/<h1[\s>]/g) || []).length !== 1) throw new Error(`${page.path} h1 count`);
    if (visibleText(html).length < 500) throw new Error(`${page.path} html is short`);
    write(path.join("public", page.html), html);
  }
}

write("public/md/404.md", NOT_FOUND_MD);
if (visibleText(NOT_FOUND_MD).length < 20) throw new Error("404 markdown is short");

write("public/llms.txt", llmsTxt());
write("public/llms-full.txt", llmsFull());

const handler = `'use strict';
// Markdown 404 for Accept: text/markdown on unknown paths. HTML 404s stay on
// Vercel's default. Body is the same text as public/md/404.md.
const BODY = ${JSON.stringify(NOT_FOUND_MD)};

module.exports = function handler(_req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.end(BODY);
};
`;
write("api/agent-markdown-404.js", handler);

console.log("render-agent-pages: wrote", pages.length, "markdown pages");
