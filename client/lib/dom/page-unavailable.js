import { h } from '../dom.js';
import { icon as uiIcon } from './icons.js';

/**
 * The one whole-page "this cannot be shown" state: a centred card with an
 * icon, a heading, one explanatory line, and an optional way back.
 *
 * This is a **page state, not a message** — the page has nothing else on it,
 * so there is no form or control for the text to sit beside. That is the line
 * with `createInlineError()`, which is the refusal of a form the user is
 * filling in (`docs/reference/feedback-surfaces.md`). It is also why nothing
 * here is named `*-error`: that vocabulary belongs to the inline element, and
 * `tests/feedback-surfaces-guard.test.js` keeps it there.
 *
 * Four views used to spell this out themselves — the editor (access denied,
 * not found), the analytics dashboard, the shared report and the share viewer,
 * each with its own class family and its own idea of what the block looks like
 * (B213). One form now, so a visitor who hits a dead end sees the same thing
 * wherever it happens.
 *
 * The root centres itself both as a block child (`min-height`) and as a child
 * of a flex column (`flex: 1`), which is what the share viewer's shell is.
 *
 * @param {object} opts
 * @param {string} [opts.icon='circle-alert'] - Vendored Lucide chrome-icon name
 * @param {string} opts.title - Heading line (rendered as the page's `h1`)
 * @param {string} [opts.subtitle] - Optional line above the message, for the
 *   thing that could not be shown (e.g. the presentation's title)
 * @param {string} [opts.message] - One explanatory line
 * @param {Node} [opts.extra] - Optional element after the message, for a
 *   consumer's own addition (e.g. the share viewer's revocation quote)
 * @param {string} [opts.actionLabel] - Label for the way back; omit when there
 *   is nowhere to send the visitor (a public page has no "back to the app")
 * @param {Function} [opts.onAction] - Handler for that button
 * @returns {HTMLElement}
 */
export function createPageUnavailable({
  icon = 'circle-alert',
  title,
  subtitle,
  message,
  extra,
  actionLabel,
  onAction,
} = {}) {
  const children = [];

  if (icon) {
    children.push(
      uiIcon(icon, { size: 64, className: 'page-unavailable-icon' }),
    );
  }

  children.push(
    h('h1', { class: 'page-unavailable-title', text: title || '' }),
  );

  if (subtitle) {
    children.push(
      h('div', { class: 'page-unavailable-subtitle', text: subtitle }),
    );
  }

  if (message) {
    children.push(h('p', { class: 'page-unavailable-message', text: message }));
  }

  if (extra) children.push(extra);

  if (actionLabel && typeof onAction === 'function') {
    children.push(
      h('div', { class: 'page-unavailable-actions' }, [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: actionLabel,
          onclick: () => onAction(),
        }),
      ]),
    );
  }

  return h('div', { class: 'page-unavailable' }, [
    h('div', { class: 'page-unavailable-card' }, children),
  ]);
}
