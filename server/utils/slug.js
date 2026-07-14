export function safeSlug(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    // Remove diacritics
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Keep alnum, space, dash
    .replace(/[^a-z0-9\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/\-+/g, '-')
    .replace(/^\-+|\-+$/g, '')
    .slice(0, 80);
  return s || 'presentation';
}
