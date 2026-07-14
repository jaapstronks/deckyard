export function buildExportUrl(path, lang) {
  const u = new URL(path, location.origin);
  if (lang) u.searchParams.set('lang', String(lang));
  return u.pathname + (u.search || '');
}
