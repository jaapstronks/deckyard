import { oneLine } from '../editor-utils.js';

function norm(s) {
  return String(s || '').toLowerCase();
}

export function normalizeQuery(q) {
  return String(q || '').trim();
}

export function findFirstMatchInText(text, query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const t = String(text || '');
  const idx = norm(t).indexOf(norm(q));
  if (idx < 0) return null;
  return { index: idx, length: q.length };
}

export function makeSnippet(text, query, { radius = 28 } = {}) {
  const t = oneLine(text);
  const m = findFirstMatchInText(t, query);
  if (!m) return null;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(t.length, m.index + m.length + radius);
  const leftEllipsis = start > 0 ? '…' : '';
  const rightEllipsis = end < t.length ? '…' : '';
  const snippet = `${leftEllipsis}${t.slice(start, end)}${rightEllipsis}`;
  // index within the snippet string (account for left ellipsis)
  const snippetIndex = (m.index - start) + leftEllipsis.length;
  return { snippet, index: snippetIndex, length: m.length };
}

function* walkStrings(v, { maxNodes = 400 } = {}) {
  const seen = new Set();
  let nodes = 0;
  const stack = [v];

  while (stack.length && nodes < maxNodes) {
    const x = stack.pop();
    if (x == null) continue;
    const t = typeof x;
    if (t === 'string') {
      nodes += 1;
      yield x;
      continue;
    }
    if (t === 'number' || t === 'boolean') {
      nodes += 1;
      yield String(x);
      continue;
    }
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i -= 1) stack.push(x[i]);
      continue;
    }
    if (t === 'object') {
      if (seen.has(x)) continue;
      seen.add(x);
      const vals = Object.values(x);
      for (let i = vals.length - 1; i >= 0; i -= 1) stack.push(vals[i]);
    }
  }
}

export function findFirstMatchInSlide(slide, query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const s = slide && typeof slide === 'object' ? slide : {};

  // Notes first: usually where speakers store longer text.
  const notesText = String(s?.notes || '');
  const notesMatch = findFirstMatchInText(notesText, q);
  if (notesMatch) {
    const sn = makeSnippet(notesText, q, { radius: 34 });
    return {
      source: 'notes',
      index: notesMatch.index,
      length: notesMatch.length,
      snippet: sn?.snippet || oneLine(notesText),
      snippetIndex: sn?.index ?? 0,
      snippetLength: sn?.length ?? q.length,
    };
  }

  // Then content: walk nested strings (items, grids, etc.)
  for (const text of walkStrings(s?.content || {})) {
    const m = findFirstMatchInText(text, q);
    if (!m) continue;
    const sn = makeSnippet(text, q, { radius: 34 });
    return {
      source: 'content',
      index: m.index,
      length: m.length,
      snippet: sn?.snippet || oneLine(text),
      snippetIndex: sn?.index ?? 0,
      snippetLength: sn?.length ?? q.length,
    };
  }

  return null;
}

export function renderHighlightedText(h, text, query, { className = 'search-hit' } = {}) {
  const q = normalizeQuery(query);
  const t = String(text || '');
  if (!q) return [t];

  const tLower = norm(t);
  const qLower = norm(q);
  const parts = [];

  let i = 0;
  while (i < t.length) {
    const at = tLower.indexOf(qLower, i);
    if (at < 0) {
      parts.push(t.slice(i));
      break;
    }
    if (at > i) parts.push(t.slice(i, at));
    parts.push(h('mark', { class: className, text: t.slice(at, at + q.length) }));
    i = at + q.length;
  }
  return parts.length ? parts : [t];
}
