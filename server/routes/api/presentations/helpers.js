export function parseIfMatchRevision(req) {
  const raw = String(req?.headers?.['if-match'] || '').trim();
  if (!raw) return null;
  // Accept: 12, "12", W/"12"
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
