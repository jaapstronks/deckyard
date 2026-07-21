export function truncateForPrompt(v, max = 480) {
  const s = String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function summarizeDeckForPrompt(deck, { maxSlides = 60 } = {}) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const title = truncateForPrompt(deck?.title || '', 120);
  const theme = truncateForPrompt(deck?.theme || '', 60);

  const lines = [];
  lines.push(`Title: ${title || '(untitled)'}`);
  lines.push(`Theme: ${theme || '(default)'}`);
  lines.push('');
  lines.push('Slides (in order):');

  const shown = slides.slice(0, Math.max(0, maxSlides));
  for (let i = 0; i < shown.length; i += 1) {
    const s = shown[i] || {};
    const type =
      truncateForPrompt(s?.type || '', 60) || '(missing type)';
    const c =
      s?.content && typeof s.content === 'object' ? s.content : {};

    const summaryBits = [];
    if (typeof c.title === 'string' && c.title.trim())
      summaryBits.push(`title="${truncateForPrompt(c.title, 120)}"`);
    // Check both subheading (new) and subtitle (legacy) for backward compatibility
    const subheadingVal = (typeof c.subheading === 'string' && c.subheading.trim()) || (typeof c.subtitle === 'string' && c.subtitle.trim()) || '';
    if (subheadingVal)
      summaryBits.push(
        `subheading="${truncateForPrompt(subheadingVal, 120)}"`
      );
    if (typeof c.quote === 'string' && c.quote.trim())
      summaryBits.push(`quote="${truncateForPrompt(c.quote, 180)}"`);
    if (typeof c.caption === 'string' && c.caption.trim())
      summaryBits.push(
        `caption="${truncateForPrompt(c.caption, 160)}"`
      );
    if (typeof c.layout === 'string' && c.layout.trim())
      summaryBits.push(
        `layout="${truncateForPrompt(c.layout, 40)}"`
      );
    if (typeof c.variant === 'string' && c.variant.trim())
      summaryBits.push(
        `variant="${truncateForPrompt(c.variant, 40)}"`
      );
    if (Array.isArray(c.items) && c.items.length)
      summaryBits.push(`items=${c.items.length}`);
    if (typeof c.chartType === 'string' && c.chartType.trim())
      summaryBits.push(
        `chartType="${truncateForPrompt(c.chartType, 20)}"`
      );
    if (typeof c.label === 'string' && c.label.trim())
      summaryBits.push(
        `label="${truncateForPrompt(c.label, 120)}"`
      );
    if (typeof c.body === 'string' && c.body.trim())
      summaryBits.push(`body="${truncateForPrompt(c.body, 260)}"`);
    if (typeof c.image === 'string' && c.image.trim())
      summaryBits.push(
        `image="${truncateForPrompt(c.image, 120)}"`
      );
    const bgImg =
      (typeof c.slideBgImage === 'string' && c.slideBgImage.trim()) ||
      (typeof c.bgImage === 'string' && c.bgImage.trim());
    if (bgImg)
      summaryBits.push(
        `slideBgImage="${truncateForPrompt(bgImg, 120)}"`
      );

    const bitStr = summaryBits.length
      ? ` — ${summaryBits.join(' · ')}`
      : '';
    lines.push(`${i + 1}. ${type}${bitStr}`);
  }

  if (slides.length > shown.length) {
    lines.push('');
    lines.push(`(${slides.length - shown.length} more slides not shown)`);
  }

  return lines.join('\n');
}
