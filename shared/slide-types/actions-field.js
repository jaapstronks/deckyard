import { escapeHtml } from './helpers.js';
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
      required: true,
      maxLength: 40,
    },
    {
      key: 'url',
      label: 'URL',
      labelKey: 'editor.slideField.actions.item.url.label',
      type: 'string',
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

function normalizeActionUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Allow http, https, mailto, tel protocols
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  // If no protocol, assume https
  if (s.includes('.') && !s.startsWith('/')) {
    return `https://${s}`;
  }
  // Allow relative paths
  return s;
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
      const url = normalizeActionUrl(a.url);
      return label && url;
    })
    .slice(0, 3); // Max 3 actions

  if (validActions.length === 0) return '';

  const buttonsHtml = validActions
    .map((action, idx) => {
      const label = String(action.label || '').trim();
      const url = normalizeActionUrl(action.url);
      const styleClass = getActionStyleClass(action.style);
      return `
        <a
          href="${escapeHtml(url)}"
          class="slide-action ${styleClass}"
          target="_blank"
          rel="noopener noreferrer"
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
