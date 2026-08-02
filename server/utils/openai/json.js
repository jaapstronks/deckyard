export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractJsonObject(text) {
  // Try direct JSON first, then a minimal "find first {...}" fallback.
  const direct = safeJsonParse(text);
  if (direct && typeof direct === 'object') return direct;

  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const maybe = safeJsonParse(s.slice(start, end + 1));
    if (maybe && typeof maybe === 'object') return maybe;
  }
  return null;
}

