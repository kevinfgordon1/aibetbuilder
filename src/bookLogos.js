// Self-hosted sportsbook marks for Odds Board / New Odds Board BookMark.
// Paths are served from public/book-logos (Vite copies public/ to the site root).

export const BOOK_LOGO_DIR = "/book-logos";

export function bookLogo(key) {
  return `${BOOK_LOGO_DIR}/${key}.svg`;
}
