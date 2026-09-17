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
 * The anchor attributes for an action's `url`, or `''` when it is not a link.
 *
 * `url` is a `url` field, so the value is what the validator accepted: a web
 * link (`safeHref`) opens in a new tab, and a slide jump (`#slide:<id>`, `#N`)
 * carries the same `data-card-nav*` attribute a clickable card does, which the
 * presenter's one delegated listener follows. Nothing is repaired: a bare
 * domain is refused where it is typed, not completed here.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function actionLinkAttrs(raw) {
  const jump = slideJumpTarget(raw);
  if (jump) {
    return 'id' in jump
      ? `href="#" data-card-nav-id="${escapeHtml(jump.id)}"`
      : `href="#" data-card-nav="${jump.index}"`;
  }
  const href = safeHref(raw);
  return href
    ? `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`
    : '';
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
 * @returns {string} HTML string or empty string if no actions
 */
export function renderActionsHtml(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '';

  const validActions = actions
    .filter((a) => {
      if (!a || typeof a !== 'object') return false;
      const label = String(a.label || '').trim();
      return label && actionLinkAttrs(a.url);
    })
    .slice(0, 3); // Max 3 actions

  if (validActions.length === 0) return '';

  const buttonsHtml = validActions
    .map((action, idx) => {
      const label = String(action.label || '').trim();
      const styleClass = getActionStyleClass(action.style);
      return `
        <a
          ${actionLinkAttrs(action.url)}
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
