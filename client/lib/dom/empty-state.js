import { t } from '../ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Reusable empty-state block: icon + title + one-line message + a primary CTA
 * (and an optional secondary). Replaces the dead-end "help" text in list views
 * so a user with no decks has an obvious way forward.
 *
 * This is the one block-form empty state (A7.16 cluster 3). The other
 * sanctioned form is the one-line placeholder note, which is plain
 * `h('div', { class: 'empty-note', text })` — deliberately not a helper.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {string|null} [opts.icon='presentation'] - Lucide icon name (rendered
 *   via iconUrl); pass `null` for an icon-less block
 * @param {string} opts.title - Bold heading line
 * @param {string} [opts.message] - Secondary explanatory line
 * @param {string} [opts.className] - Extra class(es) on the root: either
 *   `empty-state-panel` (dashed placeholder panel, settings tabs) or
 *   `empty-state-fill` (fills and centres in a stage-sized container)
 * @param {string} [opts.primaryLabel] - Primary button label
 * @param {Function} [opts.onPrimary] - Primary button handler
 * @param {string} [opts.secondaryLabel] - Optional secondary button label
 * @param {Function} [opts.onSecondary] - Optional secondary button handler
 * @returns {HTMLElement}
 */
export function createEmptyState({
  h,
  icon = 'presentation',
  title,
  message,
  className,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
} = {}) {
  const actions = h('div', { class: 'empty-state-actions' });

  if (primaryLabel && typeof onPrimary === 'function') {
    actions.append(
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: primaryLabel,
        onclick: () => onPrimary(),
      }),
    );
  }

  if (secondaryLabel && typeof onSecondary === 'function') {
    actions.append(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: secondaryLabel,
        onclick: () => onSecondary(),
      }),
    );
  }

  const children = [];
  if (icon) {
    children.push(
      h('img', {
        class: 'empty-state-icon',
        src: iconUrl(icon),
        alt: '',
        'aria-hidden': 'true',
      }),
    );
  }
  children.push(h('div', { class: 'empty-state-title', text: title || '' }));
  if (message) {
    children.push(
      h('div', { class: 'empty-state-message help', text: message }),
    );
  }
  if (actions.childNodes.length) children.push(actions);

  const rootClass = ['empty-state', className].filter(Boolean).join(' ');
  return h('div', { class: rootClass }, children);
}

/**
 * Convenience wrapper for the common "you have no presentations" case, wiring
 * the shared copy + create/template actions. `onBrowseTemplates` is optional;
 * pass it only when there are templates to browse.
 */
export function createNoPresentationsEmptyState({
  h,
  title,
  onCreate,
  onBrowseTemplates,
} = {}) {
  return createEmptyState({
    h,
    icon: 'presentation',
    title: title || t('list.empty.title', 'No presentations yet'),
    message: t(
      'list.empty.message',
      'Create your first presentation — start blank, from your notes, or from a template.',
    ),
    primaryLabel: t('list.empty.create', 'Create your first presentation'),
    onPrimary: onCreate,
    secondaryLabel: onBrowseTemplates
      ? t('list.empty.browseTemplates', 'Start from a template')
      : null,
    onSecondary: onBrowseTemplates,
  });
}
