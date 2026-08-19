import { escapeHtml } from '../../helpers.js';

export function svgText(
  x,
  y,
  text,
  { anchor = 'start', cls = '', size = 22, opacity, transform } = {},
) {
  const op = opacity != null ? ` opacity="${escapeHtml(opacity)}"` : '';
  const tr = transform ? ` transform="${escapeHtml(transform)}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="${escapeHtml(
    anchor,
  )}" class="${escapeHtml(cls)}" font-size="${size}"${op}${tr}>${escapeHtml(
    text,
  )}</text>`;
}
