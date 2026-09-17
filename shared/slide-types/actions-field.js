import { escapeHtml, safeHref, slideJumpTarget } from './helpers.js';
import { sharedOption } from '../ui-i18n-keys.js';

/**
 * Shared actions field definition for slide types.
 * Allows adding CTA buttons to slides.
 *
 * Type-independent, so its copy lives under `editor.slideField.*` (D60): the
 * two types that spread it today would otherwise mint two copies of all seven
 * strings, and the third type to want CTA buttons a third.
 */
export const ACTIONS_FIELD = {
  key: 'actions',
  label: 'Action buttons',
  labelKey: 'editor.slideField.actions.label',
  type: 'items',
  maxItems: 3,
  itemFields: [
    {
      key: 'label',
      label: 'Button label',
      labelKey: 'editor.slideField.actions.item.label.label',
      type: 'string',
      // The button label is the text of the link `url` points at.
      hrefKey: 'url',
      required: true,
      maxLength: 40,
    },
    {
      key: 'url',
      label: 'URL',
      labelKey: 'editor.slideField.actions.item.url.label',
      type: 'url',
      required: true,
      maxLength: 500,
    },
    {
      key: 'style',
      label: 'Style',
      labelKey: 'editor.slideField.actions.item.style.label',
      type: 'enum',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.actions.item.style.option.primary',
          'primary',
          'Primary',
        ),
        sharedOption(
          'editor.slideField.actions.item.style.option.secondary',
          'secondary',
          'Secondary',
        ),
        sharedOption(
          'editor.slideField.actions.item.style.option.outline',
          'outline',
          'Outline',
        ),
      ],
    },
  ],
};

/**
 * The anchor attributes for an action's `url`, or `null` when it is not a link.
 *
 * `url` is a `url` field, so the value is what the validator accepted: a web
 * link (`safeHref`) opens in a new tab, and a slide jump (`#slide:<id>`, `#N`)
 * carries the same `data-card-nav*` attribute a clickable card does, which the
 * presenter's one delegated listener follows. Outside the presenter nobody
 * listens, so there the jump is a placeholder link (an `<a>` without `href`,
 * the button as content), the way a card outside `present` mode draws no
 * overlay. Nothing is repaired: a bare domain is refused where it is typed,
 * not completed here.
 *
 * @param {unknown} raw
 * @param {string} [mode] - the render mode (`present`, `thumb`, `edit`, …)
 * @returns {string|null} attribute text (`''` for a placeholder link), or
 *   `null` when the value is no link at all
 */
function actionLinkAttrs(raw, mode) {
  const jump = slideJumpTarget(raw);
  if (jump) {
    if (mode !== 'present') return '';
    return 'id' in jump
      ? `href="#" data-card-nav-id="${escapeHtml(jump.id)}"`
      : `href="#" data-card-nav="${jump.index}"`;
  }
  const href = safeHref(raw);
  return href
    ? `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`
    : null;
}

function getActionStyleClass(style) {
  const s = String(style || 'primary').trim();
  if (s === 'secondary') return 'slide-action--secondary';
  if (s === 'outline') return 'slide-action--outline';
  return 'slide-action--primary';
}

/**
 * Render actions HTML for a slide.
 * @param {Array} actions - Array of action objects with label, url, style
 * @param {string} [mode] - the render mode; a slide jump is a live link in
 *   `present` mode only
 * @returns {string} HTML string or empty string if no actions
 */
export function renderActionsHtml(actions, mode) {
  if (!Array.isArray(actions) || actions.length === 0) return '';

  const validActions = actions
    .filter((a) => {
      if (!a || typeof a !== 'object') return false;
      const label = String(a.label || '').trim();
      return label && actionLinkAttrs(a.url, mode) !== null;
    })
    .slice(0, 3); // Max 3 actions

  if (validActions.length === 0) return '';

  const buttonsHtml = validActions
    .map((action, idx) => {
      const label = String(action.label || '').trim();
      const styleClass = getActionStyleClass(action.style);
      return `
        <a
          ${actionLinkAttrs(action.url, mode)}
          class="slide-action ${styleClass}"
          data-action-track="${idx}"
          data-action-label="${escapeHtml(label)}"
        >${escapeHtml(label)}</a>
      `;
    })
    .join('');

  return `
    <div class="slide-actions" aria-label="Actions">
      ${buttonsHtml}
    </div>
  `;
}
