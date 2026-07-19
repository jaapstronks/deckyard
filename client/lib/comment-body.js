/**
 * Render a comment body with @mention markup as inline chips.
 *
 * A mention is stored in the body as the marker `@[Name](user:email)` (see
 * `shared/comment-mentions.js`). Everywhere a comment body is shown to a reader
 * we render those markers as a subtle `.comment-mention-chip` span and keep the
 * rest as plain text nodes. Using `h()` text nodes means no manual escaping.
 *
 * Shared by every comment-body render surface (editor thread, share viewer,
 * preview lightbox) so a chip looks the same everywhere.
 */

import { splitMentionSegments } from '../../shared/comment-mentions.js';

/**
 * Build DOM nodes for a comment body: mention markers become chips, the rest
 * stays plain text. Append them with `el.append(...renderCommentBodyNodes(...))`.
 *
 * @param {string} body - Raw comment body (may contain mention markup).
 * @param {(tag: string, attrs?: object, children?: any) => HTMLElement} h -
 *   The DOM helper (injected so this works in both editor and viewer contexts).
 * @returns {Array<HTMLElement|string>} Nodes/text ready for `.append(...)`.
 */
export function renderCommentBodyNodes(body, h) {
  const nodes = [];
  for (const seg of splitMentionSegments(body)) {
    if (seg.type === 'mention') {
      nodes.push(
        h('span', {
          class: 'comment-mention-chip',
          title: seg.email,
          text: `@${seg.name}`,
        })
      );
    } else {
      nodes.push(seg.text);
    }
  }
  return nodes;
}
