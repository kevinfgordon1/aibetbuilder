// Old shared caches may still contain anonymous/international Polymarket data.
export function isUsPolymarketBook(book) {
 return book && (book.source === 'polymarket-us' || /^polymarket-us(?:-|$)/.test(book.feed || ''));
}
export const usOnlyBooks = books => (books || []).filter(b=>b && (b.key !== 'polymarket' || isUsPolymarketBook(b)));
