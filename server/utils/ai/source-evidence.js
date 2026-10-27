/**
 * Find an analysis excerpt in the actual source. Whitespace may differ after
 * document extraction; spelling, punctuation and order must match exactly.
 * @param {string} source
 * @param {string} candidate
 * @returns {string|null} A literal source substring, never model text.
 */
export function verifiedSourceExcerpt(source, candidate) {
  if (
    typeof candidate !== 'string' ||
    !candidate.trim() ||
    candidate.length > 4000
  )
    return null;
  const words = candidate.trim().split(/\s+/u);
  const pattern = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const match = String(source || '').match(new RegExp(pattern, 'u'));
  if (!match) return null;
  return match[0].length <= 480
    ? match[0]
    : match[0].slice(0, 480).replace(/\s+\S*$/u, '');
}

/** Evidence for every outline slide, including slides refined structurally. */
export function outlineSourceEvidence(outline, source) {
  for (const slide of outline.slides || []) {
    slide._reviewEvidence = {
      sourceExcerpt: verifiedSourceExcerpt(
        source,
        slide.sourceContext?.excerpt,
      ),
      kind: ['chapter', 'quote', 'closing'].includes(slide.intent)
        ? slide.intent
        : 'content',
    };
  }
  const firstLine = String(source || '')
    .split(/\r?\n/u)
    .find((line) => line.trim());
  outline._reviewTitleEvidence = {
    kind: 'title',
    sourceExcerpt:
      (outline.slides || [])
        .map((slide) => slide._reviewEvidence.sourceExcerpt)
        .find(Boolean) ||
      verifiedSourceExcerpt(
        source,
        (firstLine || '').slice(0, 480).replace(/\s+\S*$/u, ''),
      ),
  };
}
