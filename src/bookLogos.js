// Compact sportsbook marks for New Odds Board chips + column headers.
// Files live in public/book-logos and are copied to /book-logos by Vite.
// These are the books' public favicons (not invented letter badges). Direct
// site /favicon.ico links 404/403 for several shops, so the PNGs are self-hosted.

export const BOOK_LOGO_DIR = "/book-logos";

export function bookLogo(key) {
  if (!key) return null;
  return `${BOOK_LOGO_DIR}/${key}.png`;
}
