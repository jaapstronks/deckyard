import { h } from '../../../lib/dom.js';

export function makeDragGhost({ num, title, typeLabel }) {
  // Build with h() so the slide title/type label — user-authored content —
  // land as text nodes, not interpolated into raw innerHTML.
  const ghost = h('div', { class: 'drag-ghost' }, [
    h('div', { class: 'row' }, [
      h('div', { class: 'ghost-num', text: String(num) }),
      h('div', { class: 'ghost-title', text: String(title) }),
    ]),
    h('div', { class: 'ghost-type', text: String(typeLabel) }),
  ]);
  document.body.appendChild(ghost);
  return ghost;
}
