import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESPONSIBLE_GAMBLING_LINE, SITE_FOOTER_LINKS, SUPPORT_EMAIL, SUPPORT_MAILTO } from "./siteLinks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Trust pages exist as static files and Vercel serves them at clean URLs.
const vercel = JSON.parse(read("vercel.json"));
for (const name of ["about", "privacy", "terms", "support"]) {
  const html = read(`public/${name}.html`);
  assert.match(html, /1-800-GAMBLER/, name);
  assert.match(html, /href="\/privacy"/, name);
  assert.match(html, /href="\/terms"/, name);
  assert.match(html, new RegExp(SUPPORT_EMAIL.replace(/\./g, "\\."), "g"), name);
  assert.match(html, new RegExp(`href="${SUPPORT_MAILTO}"`), name);
  assert.match(html, /data-support-email/, name);
  assert.match(html, /Questions\? Contact/, name);
  assert.match(html, /fill-support-email\.js/, name);
  assert.doesNotMatch(html, /kev120909@gmail\.com|kevin\.f\.gordon1@gmail\.com|\bKevin\b/, name);
  assert.ok(vercel.rewrites.some((r) => r.source === `/${name}` && r.destination === `/${name}.html`), name);
}
assert.ok(vercel.rewrites.some((r) => r.source === "/s/:path*"));
const headerMap = Object.fromEntries((vercel.headers || []).flatMap((block) => block.headers || []).map((h) => [h.key, h.value]));
assert.equal(headerMap["X-Content-Type-Options"], "nosniff");
assert.equal(headerMap["Referrer-Policy"], "strict-origin-when-cross-origin");
assert.equal(headerMap["X-Frame-Options"], "DENY");
assert.match(headerMap["Strict-Transport-Security"], /max-age=63072000/);
assert.match(headerMap["Permissions-Policy"], /camera=\(\)/);
assert.match(headerMap["Content-Security-Policy-Report-Only"], /frame-ancestors 'none'/);
assert.match(headerMap["Content-Security-Policy-Report-Only"], /https:\/\/\*\.supabase\.co/);
assert.match(headerMap["Content-Security-Policy-Report-Only"], /wss:\/\/\*\.supabase\.co/);
assert.match(headerMap["Content-Security-Policy-Report-Only"], /gateway\.polymarket\.us/);
assert.equal(headerMap["Content-Security-Policy"], undefined);
assert.ok(vercel.redirects.some((r) => r.source === "/contact" && r.destination === "/about#contact"));

const privacy = read("public/privacy.html");
assert.match(privacy, /id="data-deletion"/);
for (const s of ["Google", "Facebook", "Supabase", "Google Analytics", "Microsoft Clarity", "email address", "account ID"]) {
  assert.ok(privacy.includes(s), s);
}
assert.match(privacy, /don't sell your data/);
assert.match(read("public/about.html"), /id="contact"/);
assert.match(read("public/terms.html"), /21 or older/);

// Head tags for link previews + icons.
const index = read("index.html");
assert.match(index, /<title>AI Bet Builder — Best bets for sportsbook promos &amp; boosts<\/title>/);
assert.match(index, /og:image" content="https:\/\/www\.aibetbuilder\.io\/og-image\.png"/);
assert.match(index, /og:url" content="https:\/\/www\.aibetbuilder\.io"/);
assert.match(index, /twitter:card" content="summary_large_image"/);
assert.match(index, /rel="manifest" href="\/site\.webmanifest"/);
assert.match(index, /rel="apple-touch-icon"/);
for (const f of ["og-image.png", "favicon.ico", "favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "site.webmanifest", "site-pages.css", "robots.txt", "sitemap.xml"]) {
  assert.ok(fs.existsSync(path.join(root, "public", f)), f);
}
const og = fs.readFileSync(path.join(root, "public", "og-image.png"));
assert.equal(og.readUInt32BE(16), 1200);
assert.equal(og.readUInt32BE(20), 630);
assert.doesNotMatch(og.toString("latin1").toLowerCase(), /kevin|gordon|kev120909/);
const robots = read("public/robots.txt");
assert.match(robots, /Sitemap: https:\/\/www\.aibetbuilder\.io\/sitemap\.xml/);
const sitemap = read("public/sitemap.xml");
for (const loc of ["https://www.aibetbuilder.io/", "https://www.aibetbuilder.io/about", "https://www.aibetbuilder.io/privacy", "https://www.aibetbuilder.io/terms", "https://www.aibetbuilder.io/support"]) {
  assert.ok(sitemap.includes(`<loc>${loc}</loc>`), loc);
}
for (const page of ["index.html", "public/about.html", "public/privacy.html", "public/terms.html", "public/support.html"]) {
  const html = read(page);
  assert.match(html, /<title>[^<]+<\/title>/, page);
  assert.match(html, /name="description"/, page);
  assert.match(html, /rel="canonical"/, page);
  assert.match(html, /property="og:title"/, page);
  assert.match(html, /property="og:image"/, page);
  assert.match(html, /name="twitter:card" content="summary_large_image"/, page);
}
const shortCache = "public, max-age=0, must-revalidate";
const bySource = new Map((vercel.headers || []).map((rule) => [rule.source, rule]));
const assets = bySource.get("/assets/(.*)");
assert.ok(assets, "hashed /assets cache rule");
assert.equal(assets.headers.find((h) => h.key === "Cache-Control").value, "public, max-age=31536000, immutable");
for (const source of ["/", "/index.html", "/about", "/about.html", "/privacy", "/privacy.html", "/terms", "/terms.html", "/support", "/support.html", "/app", "/learn"]) {
  const rule = bySource.get(source);
  assert.ok(rule, source);
  const value = rule.headers.find((h) => h.key === "Cache-Control").value;
  assert.equal(value, shortCache, source);
  assert.doesNotMatch(value, /immutable|31536000/);
}
const manifest = JSON.parse(read("public/site.webmanifest"));
assert.equal(manifest.name, "AI Bet Builder");
assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));

// Footer on landing + app.
assert.deepEqual(SITE_FOOTER_LINKS.map((l) => l.href), ["/about", "/support", "/privacy", "/terms", "/about#contact"]);
assert.equal(SITE_FOOTER_LINKS.find((l) => l.href === "/support").label, "Support");
const supportPage = read("public/support.html");
assert.match(supportPage, /<h1>Support<\/h1>/);
assert.match(supportPage, /We usually reply within 1 business day/);
assert.match(supportPage, /class="sp-support-btn" href="mailto:support@aibetbuilder\.io">Email <span data-support-email>support@aibetbuilder\.io<\/span>/);
assert.match(supportPage, /Account and sign-in/);
assert.match(supportPage, /Billing and subscriptions/);
assert.match(supportPage, /odds number looks wrong/);
assert.match(supportPage, /don't promise/);
assert.match(supportPage, /not betting advice/);
assert.doesNotMatch(supportPage, /\$\d|refund guaranteed|you will win|sure thing/i);
assert.equal(RESPONSIBLE_GAMBLING_LINE, "21+ only. Gambling problem? Call 1-800-GAMBLER.");
assert.equal(SUPPORT_EMAIL, "support@aibetbuilder.io");
assert.equal(SUPPORT_MAILTO, "mailto:support@aibetbuilder.io");
const supportJson = JSON.parse(read("public/support-email.json"));
assert.equal(supportJson.SUPPORT_EMAIL, SUPPORT_EMAIL);
assert.match(read("src/SupportContact.jsx"), /SUPPORT_EMAIL/);
assert.match(read("src/SupportContact.jsx"), /SUPPORT_MAILTO/);
assert.match(read("src/SupportContact.jsx"), /Questions\? Contact/);
assert.match(read("src/SiteFooterLinks.jsx"), /SupportContact/);
assert.match(read("src/SignInOptions.jsx"), /SupportContact/);
assert.match(read("src/SignInOptions.jsx"), /status\.kind === "error" \|\| status\.kind === "rate_limit"/);
const app = read("src/App.jsx");
assert.equal((app.match(/<SiteFooterLinks \/>/g) || []).length, 2);
assert.match(app, /How do I reach you\?/);
assert.match(app, /You don’t have access to this page\. <SupportContact/);
assert.doesNotMatch(read("public/about.html") + read("public/privacy.html") + read("public/terms.html") + read("src/SiteFooterLinks.jsx") + read("src/SupportContact.jsx"), /gmail\.com/);
const hook = read("api/telegram-webhook.js");
assert.match(hook, /support-email\.json/);
assert.match(hook, /Questions\? Email \$\{SUPPORT_EMAIL\}/);
assert.doesNotMatch(hook, /Kevin will text|Reach out to Kevin/);
assert.doesNotMatch(read("src/ComboLocks.jsx"), /Kevin \(you\)/);
assert.doesNotMatch(read("src/ComboTesters.jsx"), /Kevin's desk/);

console.log("sitePages.test.js ok");
