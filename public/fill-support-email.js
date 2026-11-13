// Fills every [data-support-email] link from public/support-email.json so the
// static pages use the same address as SUPPORT_EMAIL in src/siteLinks.js.
const support = await fetch("/support-email.json").then((res) => res.json());
const email = support.SUPPORT_EMAIL;
const mailto = "mailto:" + email;
for (const el of document.querySelectorAll("[data-support-email]")) {
  el.textContent = email;
  const link = el.closest("a");
  if (link) link.href = mailto;
}
