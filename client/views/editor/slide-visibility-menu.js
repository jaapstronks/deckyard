/**
 * Slide visibility menu component.
 * Shows a dropdown with visibility presets for slides.
 */

import { t } from '../../lib/ui-i18n.js';
import { VISIBILITY_PRESETS, getVisibilityPreset, applyVisibilityPreset } from '../../../shared/slide-visibility.js';

/**
 * Create a visibility preset option element.
 */
function createPresetOption(h, { presetName, isActive, onClick }) {
  const presetInfo = getPresetDisplayInfo(presetName);

  const option = h('button', {
    class: `visibility-menu-option${isActive ? ' is-active' : ''}`,
    type: 'button',
    onclick: (e) => onClick(e),
  });

  const icon = h('span', { class: `visibility-icon visibility-icon--${presetName}` });
  const content = h('div', { class: 'visibility-option-content' }, [
    h('div', { class: 'visibility-option-label', text: presetInfo.label }),
    h('div', { class: 'visibility-option-desc', text: presetInfo.description }),
  ]);

  const checkmark = isActive
    ? h('span', { class: 'visibility-option-check', text: '\u2713' })
    : null;

  option.append(icon, content);
  if (checkmark) option.append(checkmark);

  return option;
}

/**
 * Get display information for a preset.
 */
function getPresetDisplayInfo(presetName) {
  switch (presetName) {
    case 'visible':
      return {
        label: t('visibility.visible', 'Visible'),
        description: t('visibility.visibleDesc', 'Show everywhere'),
        iconClass: 'visible',
      };
    case 'draft':
      return {
        label: t('visibility.draft', 'Draft'),
        description: t('visibility.draftDesc', 'Hidden until finalized, visible to collaborators'),
        iconClass: 'draft',
      };
    case 'internal':
      return {
        label: t('visibility.internal', 'Internal'),
        description: t('visibility.internalDesc', 'Show in presentation, hide in exports and public'),
        iconClass: 'internal',
      };
    case 'hidden':
      return {
        label: t('visibility.hidden', 'Hidden'),
        description: t('visibility.hiddenDesc', 'Hide everywhere'),
        iconClass: 'hidden',
      };
    case 'skipInPresentation':
      return {
        label: t('visibility.skipInPresentation', 'Skip in Presentation'),
        description: t('visibility.skipInPresentationDesc', 'Hide in presenter mode only'),
        iconClass: 'skip',
      };
    case 'custom':
    default:
      return {
        label: t('visibility.custom', 'Custom'),
        description: t('visibility.customDesc', 'Custom visibility settings'),
        iconClass: 'custom',
      };
  }
}

/**
 * Create the visibility menu component.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - Element helper function
 * @param {Object} options.slide - The slide object
 * @param {Function} options.onVisibilityChange - Callback when visibility changes
 * @param {Function} options.onClose - Callback to close the menu
 * @returns {HTMLElement} The menu element
 */
export function createVisibilityMenu({ h, slide, onVisibilityChange, onClose }) {
  const currentPreset = getVisibilityPreset(slide);

  const menu = h('div', { class: 'visibility-menu' });

  const header = h('div', { class: 'visibility-menu-header' }, [
    h('span', { text: t('visibility.title', 'Slide Visibility') }),
    h('button', {
      class: 'visibility-menu-close',
      type: 'button',
      title: t('common.close', 'Close'),
      text: '\u00d7',
      onclick: onClose,
    }),
  ]);

  const options = h('div', { class: 'visibility-menu-options' });

  const presetOrder = ['visible', 'draft', 'internal', 'hidden', 'skipInPresentation'];

  for (const presetName of presetOrder) {
    const option = createPresetOption(h, {
      presetName,
      isActive: currentPreset === presetName,
      onClick: (e) => {
        // Update visual state immediately
        options.querySelectorAll('.visibility-menu-option').forEach((opt) => {
          opt.classList.remove('is-active');
          const check = opt.querySelector('.visibility-option-check');
          if (check) check.remove();
        });
        e.currentTarget.classList.add('is-active');
        const check = h('span', { class: 'visibility-option-check', text: '\u2713' });
        e.currentTarget.append(check);

        // Apply change and close after brief delay for feedback
        applyVisibilityPreset(slide, presetName);
        onVisibilityChange?.(slide, presetName);
        setTimeout(() => onClose?.(), 120);
      },
    });
    options.append(option);
  }

  menu.append(header, options);

  return menu;
}

/**
 * Create a visibility badge for a slide thumbnail.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - Element helper function
 * @param {Object} options.slide - The slide object
 * @returns {HTMLElement|null} The badge element or null if visible
 */
export function createVisibilityBadge({ h, slide }) {
  const preset = getVisibilityPreset(slide);

  // Don't show badge for fully visible slides
  if (preset === 'visible') {
    return null;
  }

  const info = getPresetDisplayInfo(preset);

  const badge = h('div', {
    class: `slide-visibility-badge slide-visibility-badge--${preset}`,
    title: `${info.label}: ${info.description}`,
  });

  return badge;
}

/**
 * Create the visibility toggle button for slide thumbnails.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - Element helper function
 * @param {Object} options.slide - The slide object
 * @param {Function} options.onToggle - Callback when button is clicked
 * @returns {HTMLElement} The toggle button element
 */
export function createVisibilityToggle({ h, slide, onToggle }) {
  const preset = getVisibilityPreset(slide);
  const isHidden = preset !== 'visible';

  const button = h('button', {
    class: `slide-visibility-toggle${isHidden ? ' is-visibility-restricted' : ''}`,
    type: 'button',
    title: t('editor.slideList.visibility', 'Change visibility'),
    onclick: (e) => {
      e.stopPropagation();
      onToggle?.(e);
    },
  });

  // Eye icon SVG (h() routes SVG tag names through createElementNS)
  const iconChildren = isHidden
    ? [
        // Eye-off icon
        h('path', {
          d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24',
        }),
        h('line', { x1: '1', y1: '1', x2: '23', y2: '23' }),
      ]
    : [
        // Eye icon
        h('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
        h('circle', { cx: '12', cy: '12', r: '3' }),
      ];

  const svg = h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    iconChildren
  );

  button.append(svg);
  return button;
}

/**
 * Position and show a visibility menu as a popover.
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.anchor - The element to anchor to
 * @param {HTMLElement} options.menu - The menu element
 * @param {HTMLElement} options.container - Container for the menu (unused, menu appends to body)
 */
export function showVisibilityMenuAt({ anchor, menu, container }) {
  // Remove any existing menu from body
  const existing = document.body.querySelector('.visibility-menu');
  if (existing) existing.remove();

  // Append to body to escape stacking context of slides panel
  document.body.appendChild(menu);

  // Position using fixed positioning relative to viewport
  const anchorRect = anchor.getBoundingClientRect();

  menu.style.position = 'fixed';
  // Start by positioning to the right of the anchor
  let left = anchorRect.right + 8;
  let top = anchorRect.top;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  // Ensure menu stays within viewport bounds
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // If menu goes past right edge of viewport, position to the left of anchor instead
    if (menuRect.right > viewportWidth - 10) {
      left = anchorRect.left - menuRect.width - 8;
      // If still off-screen on the left, just align near left edge
      if (left < 10) {
        left = 10;
      }
      menu.style.left = `${left}px`;
    }

    // If menu goes past bottom of viewport, move it up
    if (menuRect.bottom > viewportHeight - 10) {
      top = Math.max(10, viewportHeight - menuRect.height - 10);
      menu.style.top = `${top}px`;
    }
  });

  // Close on outside click
  const closeOnOutsideClick = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeOnOutsideClick, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeOnOutsideClick, true);
  }, 0);

  // Close on Escape
  const closeOnEscape = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('keydown', closeOnEscape);
    }
  };
  document.addEventListener('keydown', closeOnEscape);
}
