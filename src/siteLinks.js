import supportContact from "../public/support-email.json" with { type: "json" };

// Footer links + responsible-gambling line shared by the landing page, the
// app and the static /about, /privacy, /terms pages (public/*.html).
export const SITE_FOOTER_LINKS = Object.freeze([
  { href: "/about", label: "About" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/about#contact", label: "Contact" },
]);

export const RESPONSIBLE_GAMBLING_LINE = "21+ only. Gambling problem? Call 1-800-GAMBLER.";
export const GAMBLER_TEL = "tel:18004262537";

// Public support address. Defined once in public/support-email.json so the
// app, the static pages' filler script, and the Telegram bot share it.
// Static /about, /privacy and /terms also print the address for no-JS;
// sitePages.test.js fails if that copy drifts.
export const SUPPORT_EMAIL = supportContact.SUPPORT_EMAIL;
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
