import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESPONSIBLE_GAMBLING_LINE, SITE_FOOTER_LINKS } from "./siteLinks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Trust pages exist as static files and Vercel serves them at clean URLs.
const vercel = JSON.parse(read("vercel.json"));
for (const name of ["about", "privacy", "terms"]) {
  const html = read(`public/${name}.html`);
  assert.match(html, /1-800-GAMBLER/, name);
  assert.match(html, /href="\/privacy"/, name);
  assert.match(html, /href="\/terms"/, name);
  assert.match(html, /kev120909@gmail\.com/, name);
  assert.ok(vercel.rewrites.some((r) => r.source === `/${name}` && r.destination === `/${name}.html`), name);
}
assert.ok(vercel.rewrites.some((r) => r.source === "/s/:path*"));
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
for (const f of ["og-image.png", "favicon.ico", "favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "site.webmanifest", "site-pages.css"]) {
  assert.ok(fs.existsSync(path.join(root, "public", f)), f);
}
const manifest = JSON.parse(read("public/site.webmanifest"));
assert.equal(manifest.name, "AI Bet Builder");
assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));

// Footer on landing + app.
assert.deepEqual(SITE_FOOTER_LINKS.map((l) => l.href), ["/about", "/privacy", "/terms", "/about#contact"]);
assert.equal(RESPONSIBLE_GAMBLING_LINE, "21+ only. Gambling problem? Call 1-800-GAMBLER.");
const app = read("src/App.jsx");
assert.equal((app.match(/<SiteFooterLinks \/>/g) || []).length, 2);

console.log("sitePages.test.js ok");
