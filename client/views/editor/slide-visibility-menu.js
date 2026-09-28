/**
 * Slide visibility menu component.
 * Shows a dropdown with visibility presets for slides.
 */

import { icon } from '../../lib/dom/icons.js';
import { t } from '../../lib/ui-i18n.js';
import {
  getVisibilityPreset,
  applyVisibilityPreset,
} from '../../../shared/slide-visibility.js';
import { h } from '../../lib/dom.js';
import { takeEscape } from '../../lib/dom/escape.js';

/**
 * The one open visibility menu, if any: its element and the teardown for every
 * listener and timer it bound. There is a single close path
 * (`closeVisibilityMenu`), so a closed menu can hold nothing that still hears
 * a key or a click (B493).
 * @type {{ menu: HTMLElement, detach: Function } | null}
 */
let active = null;

/**
 * Close the open visibility menu and release everything it bound.
 *
 * Every way out goes through here: outside click, Escape, the X, a picked
 * preset, a newer menu replacing it and the slide list's detach.
 *
 * @param {HTMLElement} [menu] - Close only when this menu is the open one; a
 *   late callback from a menu that is already gone then leaves its successor
 *   alone. Omit to close whichever menu is open.
 */
export function closeVisibilityMenu(menu) {
  if (!active || (menu && active.menu !== menu)) return;
  const { menu: el, detach } = active;
  active = null;
  detach();
  el.remove();
}

/**
 * Create a visibility preset option element.
 */
function createPresetOption({ presetName, isActive, onClick }) {
  const presetInfo = getPresetDisplayInfo(presetName);

  const option = h('button', {
    class: `visibility-menu-option${isActive ? ' is-active' : ''}`,
    type: 'button',
    onclick: (e) => onClick(e),
  });

  const presetIcon = h('span', {
    class: `visibility-icon visibility-icon--${presetName}`,
  });
  const content = h('div', { class: 'visibility-option-content' }, [
    h('div', { class: 'visibility-option-label', text: presetInfo.label }),
    h('div', { class: 'visibility-option-desc', text: presetInfo.description }),
  ]);

  const checkmark = isActive
    ? h('span', { class: 'visibility-option-check' }, [
        icon('check', { size: 14 }),
      ])
    : null;

  option.append(presetIcon, content);
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
        description: t(
          'visibility.draftDesc',
          'Hidden until finalized, visible to collaborators',
        ),
        iconClass: 'draft',
      };
    case 'internal':
      return {
        label: t('visibility.internal', 'Internal'),
        description: t(
          'visibility.internalDesc',
          'Show in presentation, hide in exports and public',
        ),
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
        description: t(
          'visibility.skipInPresentationDesc',
          'Hide in presenter mode only',
        ),
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
 * @param {Object} options.slide - The slide object
 * @param {Function} options.onVisibilityChange - Callback when visibility changes
 * @returns {HTMLElement} The menu element; show it with `showVisibilityMenuAt`
 */
export function createVisibilityMenu({ slide, onVisibilityChange }) {
  const currentPreset = getVisibilityPreset(slide);

  const menu = h('div', { class: 'visibility-menu' });

  const header = h('div', { class: 'visibility-menu-header' }, [
    h('span', { text: t('visibility.title', 'Slide Visibility') }),
    h(
      'button',
      {
        class: 'visibility-menu-close',
        type: 'button',
        title: t('common.close', 'Close'),
        onclick: () => closeVisibilityMenu(menu),
      },
      [icon('x', { size: 16 })],
    ),
  ]);

  const options = h('div', { class: 'visibility-menu-options' });

  const presetOrder = [
    'visible',
    'draft',
    'internal',
    'hidden',
    'skipInPresentation',
  ];

  for (const presetName of presetOrder) {
    const option = createPresetOption({
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
        const check = h('span', { class: 'visibility-option-check' }, [
          icon('check', { size: 14 }),
        ]);
        e.currentTarget.append(check);

        // Apply change and close after brief delay for feedback
        applyVisibilityPreset(slide, presetName);
        onVisibilityChange?.(slide, presetName);
        setTimeout(() => closeVisibilityMenu(menu), 120);
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
 * @param {Object} options.slide - The slide object
 * @returns {HTMLElement|null} The badge element or null if visible
 */
export function createVisibilityBadge({ slide }) {
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
 * @param {Object} options.slide - The slide object
 * @param {Function} options.onToggle - Callback when button is clicked
 * @returns {HTMLElement} The toggle button element
 */
export function createVisibilityToggle({ slide, onToggle }) {
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

  button.append(icon(isHidden ? 'eye-off' : 'eye', { size: 14 }));
  return button;
}

/**
 * Position and show a visibility menu as a popover, replacing any open one.
 * @param {Object} options - Configuration options
 * @param {{ getBoundingClientRect: Function, contains: Function }} options.anchor
 *   - The element (or rect-bearing stand-in) to anchor to
 * @param {HTMLElement} options.menu - The menu from `createVisibilityMenu`
 */
export function showVisibilityMenuAt({ anchor, menu }) {
  closeVisibilityMenu();

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
  const frame = requestAnimationFrame(() => {
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

  const closeOnOutsideClick = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) {
      closeVisibilityMenu(menu);
    }
  };
  // Deferred so the opening click does not close the menu it just opened.
  const bindClick = setTimeout(() => {
    document.addEventListener('click', closeOnOutsideClick, true);
  }, 0);

  // Capture phase: the menu is a layer, so it hears the key before the
  // surface it opened over (the slides drawer, the editor).
  const closeOnEscape = (e) => {
    if (takeEscape(e)) closeVisibilityMenu(menu);
  };
  document.addEventListener('keydown', closeOnEscape, true);

  active = {
    menu,
    detach: () => {
      cancelAnimationFrame(frame);
      clearTimeout(bindClick);
      document.removeEventListener('click', closeOnOutsideClick, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    },
  };
}
