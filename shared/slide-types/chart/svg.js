import { esc } from '../helpers.js';

export function svgText(
  x,
  y,
  text,
  { anchor = 'start', cls = '', size = 22, opacity, transform } = {}
) {
  const op =
    opacity != null ? ` opacity="${esc(opacity)}"` : '';
  const tr = transform ? ` transform="${esc(transform)}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="${esc(
    anchor
  )}" class="${esc(cls)}" font-size="${size}"${op}${tr}>${esc(
    text
  )}</text>`;
}
