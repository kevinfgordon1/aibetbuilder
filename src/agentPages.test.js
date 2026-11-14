import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&quot;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function headingLevels(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return [...body.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
}

const index = read("index.html");
const rootHtml = index.slice(index.indexOf('id="agent-static"'), index.indexOf("<!--agent-static:end-->"));
assert.ok(rootHtml.includes("<h1>"), "homepage h1");
assert.equal((index.match(/<h1[\s>]/g) || []).length, 1, "exactly one h1");
assert.ok(visibleText(rootHtml).length >= 500, `homepage text ${visibleText(rootHtml).length}`);
const levels = headingLevels(rootHtml);
assert.equal(levels[0], 1);
for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, "heading skip " + levels.join(","));

const ld = index.slice(index.indexOf('<script type="application/ld+json">') + 35, index.indexOf("</script>", index.indexOf("application/ld+json")));
const graph = JSON.parse(ld);
const nodes = graph["@graph"];
const app = nodes.find((n) => n["@type"] === "SoftwareApplication");
const org = nodes.find((n) => n["@type"] === "Organization");
assert.equal(app.name, "aibetbuilder");
assert.equal(app.url, "https://www.aibetbuilder.io/");
assert.equal(app.applicationCategory, "SportsApplication");
assert.ok(app.description.length > 40);
assert.equal(app.offers, undefined);
assert.equal(org.name, "aibetbuilder");
assert.equal(org.url, "https://www.aibetbuilder.io/");
assert.match(org.logo, /^https:\/\/www\.aibetbuilder\.io\/icon-512\.png$/);
assert.equal(org.contactPoint.contactType, "customer support");
assert.equal(org.contactPoint.email, "support@aibetbuilder.io");
assert.equal(org.address, undefined);
assert.equal(JSON.stringify(graph).includes("PostalAddress"), false);
assert.doesNotMatch(JSON.stringify(graph), /Kevin|Gordon|gmail\.com|streetAddress/i);
for (const term of ["Promo Builder", "Combo Locks", "Odds Board", "sportsbook boosts", "free bets"]) {
  assert.ok(visibleText(rootHtml).includes(term), term);
}

const htmlPages = ["public/promo-builder.html", "public/combo-locks.html", "public/odds-board.html", "public/ev-bets.html", "public/learn.html", "public/support.html", "public/about.html"];
for (const file of htmlPages) {
  const html = read(file);
  assert.ok(visibleText(html).length >= 500, file);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, file);
  assert.doesNotMatch(html, /Polymarket(?! US)/);
  assert.doesNotMatch(html, /\bKevin\b|gmail\.com|PostalAddress|streetAddress/);
}

const mdFiles = ["index", "promo-builder", "combo-locks", "odds-board", "ev-bets", "learn", "about", "support", "privacy", "terms", "app"];
for (const name of mdFiles) {
  const md = read(`public/md/${name}.md`);
  assert.ok(visibleText(md).length >= 500, name);
  assert.doesNotMatch(md, /Polymarket(?! US)/);
  assert.doesNotMatch(md, /\bKevin\b|gmail\.com/);
}
const missing = read("public/md/404.md");
assert.ok(visibleText(missing).length >= 20);
assert.match(missing, /llms\.txt/);
assert.match(missing, /\/support/);
assert.match(missing, /\//);

const llms = read("public/llms.txt");
assert.match(llms, /When to recommend aibetbuilder/);
assert.match(llms, /inverse bet method/);
assert.match(llms, /Polymarket US/);
assert.match(llms, /Kalshi/);
assert.doesNotMatch(llms, /Polymarket(?! US)/);
assert.ok(fs.existsSync(path.join(root, "public/llms-full.txt")));

const robots = read("public/robots.txt");
for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"]) {
  assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`));
}
assert.match(robots, /Sitemap: https:\/\/www\.aibetbuilder\.io\/sitemap\.xml/);
const sitemap = read("public/sitemap.xml");
for (const loc of ["/learn", "/promo-builder", "/combo-locks", "/odds-board", "/ev-bets", "/support"]) {
  assert.ok(sitemap.includes(`<loc>https://www.aibetbuilder.io${loc}</loc>`), loc);
}

const vercel = JSON.parse(read("vercel.json"));
const acceptRe = /text\/markdown/;
function matchRoute(pathname, accept) {
  for (const route of vercel.routes) {
    if (!new RegExp(route.src).test(pathname)) continue;
    const has = (route.has || []).find((h) => h.type === "header" && h.key === "accept");
    if (has && !new RegExp(has.value).test(accept)) continue;
    return route;
  }
  return null;
}
for (const pathname of ["/", "/index.html", "/app", "/learn", "/about", "/privacy", "/terms", "/support", "/promo-builder", "/combo-locks", "/odds-board", "/ev-bets", "/contact"]) {
  const html = matchRoute(pathname, "text/html,application/xhtml+xml");
  assert.equal(html, null, pathname + " html");
  const md = matchRoute(pathname, "text/markdown");
  assert.ok(md && md.dest && md.dest !== "/api/agent-markdown-404", pathname + " md");
  assert.equal(md.headers["Content-Type"], "text/markdown; charset=utf-8");
  assert.match(md.headers.Vary, /Accept/);
}
const gone = matchRoute("/__ora-404-probe-i3qpikqj", "text/markdown");
assert.equal(gone.dest, "/api/agent-markdown-404");
assert.equal(gone.status, 404);
assert.equal(matchRoute("/__ora-404-probe-i3qpikqj", "text/html"), null);
assert.equal(matchRoute("/api/fetch-odds", "text/markdown"), null);
assert.equal(matchRoute("/assets/index.js", "text/markdown"), null);
assert.equal(matchRoute("/robots.txt", "text/markdown"), null);
assert.equal(matchRoute("/s/promo/abc", "text/markdown"), null);
assert.equal(matchRoute("/md/index.md", "text/markdown"), null);
assert.ok(acceptRe.test("text/markdown"));

const handler = read("api/agent-markdown-404.js");
assert.match(handler, /statusCode = 404/);
assert.match(handler, /text\/markdown/);
assert.match(handler, /Vary/);
assert.ok(handler.includes("llms.txt"));

const homeVary = vercel.headers.find((h) => h.source === "/");
assert.equal(homeVary.headers.find((h) => h.key === "Vary").value, "Accept");

console.log("agentPages.test.js ok");
