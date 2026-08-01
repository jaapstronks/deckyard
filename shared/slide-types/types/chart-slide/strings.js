export function truncateLabel(s, max = 16) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTick(v) {
  // Keep it readable: integers if close, else 1 decimal.
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-6) return String(rounded);
  return String(Math.round(n * 10) / 10);
}
