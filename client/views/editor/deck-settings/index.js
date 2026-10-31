import { t } from '../../../lib/ui-i18n.js';
import {
  buildQaSection,
  buildBuildsSection,
  buildRssFeedSection,
} from './toggles.js';
import { buildRevealStyleSection } from './reveal-style.js';
import { buildThemeSection } from './theme.js';
import { buildTransitionsSection } from './transitions.js';
import { buildLanguageSection } from './language.js';
import { buildDescriptionSection } from './description.js';
import { buildTagsSection } from './tags.js';
import { buildAnalyticsSection } from './analytics.js';
import { buildLiveVideoSection } from './live-video.js';
import { buildAutoAdvanceSection } from './auto-advance.js';
import { h } from '../../../lib/dom/index.js';
import { icon } from '../../../lib/dom/icons.js';
import { featureEnabled } from '../../../lib/state/features.js';

/**
 * The deck's settings as a pane of the editor's right-hand rail (B804).
 *
 * They used to be a modal with no address over the editor. They are a pane
 * now, beside the canvas the settings change, with one section on screen at a
 * time and each section an address (`deck-settings-route.js` owns the URL).
 * The sections are assembled from independent builders, the sibling modules
 * in this folder: each normalizes its own slice of `pres.settings`, builds its
 * DOM and wires its handlers to markDirty/requestSave. This index is the
 * folder's seam.
 */

/** Section keys in display order; the first is where an unknown key lands. */
export const DECK_SETTINGS_SECTIONS = Object.freeze([
  'general',
  'appearance',
  'playback',
  'publishing',
  'analytics',
  'live-video',
]);

/**
 * The sections this installation shows: analytics only with its cluster on
 * (D260), where the deck's stored options are left as they are.
 * @returns {string[]}
 */
export function availableDeckSettingsSections() {
  return DECK_SETTINGS_SECTIONS.filter(
    (key) => key !== 'analytics' || featureEnabled('analytics'),
  );
}

/**
 * A requested section, or the first one when it is unknown or not shown here.
 * @param {string|null|undefined} key
 * @returns {string}
 */
export function resolveDeckSettingsSection(key) {
  const available = availableDeckSettingsSections();
  return available.includes(key) ? key : available[0];
}

const sectionLabel = (key) =>
  ({
    general: t('editor.deckSettings.section.general', 'General'),
    appearance: t('editor.deckSettings.section.appearance', 'Appearance'),
    playback: t('editor.deckSettings.section.playback', 'Playback'),
    publishing: t('editor.deckSettings.section.publishing', 'Publishing'),
    analytics: t('editor.deckSettings.section.analytics', 'Analytics'),
    'live-video': t('editor.deckSettings.section.liveVideo', 'Live video'),
  })[key];

/**
 * Build the sections' content for one opening of the pane.
 * @returns {{ sections: Map<string, HTMLElement[]>, detach: Function }}
 */
function buildSections({
  root,
  pres,
  api,
  markDirty,
  requestSave,
  toast,
  beforeThemeChange,
  onThemeChanged,
  onNavigateToSlide,
  onOpenTranslateView,
}) {
  // Ensure settings is an object; each section normalizes its own slice.
  pres.settings =
    pres.settings && typeof pres.settings === 'object' ? pres.settings : {};
  const ctx = { pres, markDirty, requestSave };

  const tags = buildTagsSection({ pres, api });
  const sections = new Map([
    [
      'general',
      [
        buildLanguageSection({ pres, onOpenTranslateView }).el,
        tags.el,
        buildDescriptionSection(ctx).el,
      ],
    ],
    [
      'appearance',
      [
        buildThemeSection({
          root,
          pres,
          api,
          toast,
          beforeChange: beforeThemeChange,
          onThemeChanged,
          onNavigateToSlide,
        }).el,
      ],
    ],
    [
      'playback',
      [
        buildBuildsSection(ctx).row,
        buildRevealStyleSection(ctx).el,
        buildTransitionsSection(ctx).el,
        buildAutoAdvanceSection(ctx).el,
      ],
    ],
    [
      'publishing',
      [buildQaSection(ctx).row, buildRssFeedSection({ ...ctx, api }).row],
    ],
    ['live-video', [buildLiveVideoSection(ctx).el]],
  ]);
  if (featureEnabled('analytics')) {
    sections.set('analytics', [buildAnalyticsSection(ctx).el]);
  }
  return { sections, detach: () => tags.instance?.detach?.() };
}

/**
 * Create the deck settings pane. It is empty until `open()`; every opening
 * builds the sections afresh from the deck (as the modal did), and `close()`
 * detaches them, so no listener outlives a closed pane.
 *
 * @param {object} options
 * @param {HTMLElement} options.root - editor root (theme warning modal host)
 * @param {object} options.pres
 * @param {Function|null} options.api
 * @param {Function} [options.markDirty]
 * @param {Function} [options.requestSave]
 * @param {Function} [options.toast]
 * @param {Function} [options.beforeThemeChange] - async; stores pending
 *   edits before a theme change rewrites the deck on the server
 * @param {Function} [options.onThemeChanged]
 * @param {Function} [options.onNavigateToSlide]
 * @param {() => (Function|null)} [options.getOpenTranslateView] - the
 *   translation view opener, or null where it cannot open now
 * @param {(key: string) => void} [options.onSelectSection] - a section
 *   button was pressed
 * @param {() => void} [options.onRequestClose] - the close button was pressed
 * @returns {{ el: HTMLElement, open: Function, close: Function, showSection: Function, isOpen: Function, containsFocus: Function, currentSection: Function, focus: Function, detach: Function }}
 */
export function createDeckSettingsPane({
  root,
  pres,
  api,
  markDirty,
  requestSave,
  toast,
  beforeThemeChange,
  onThemeChanged,
  onNavigateToSlide,
  getOpenTranslateView,
  onSelectSection,
  onRequestClose,
} = {}) {
  const title = h('h2', {
    class: 'deck-settings-title',
    tabindex: '-1',
    text: t('editor.deckSettings.title', 'Deck settings'),
  });
  const closeLabel = t('editor.deckSettings.close', 'Close deck settings');
  const closeBtn = h(
    'button',
    {
      type: 'button',
      class: 'ghost-icon-btn deck-settings-close',
      title: closeLabel,
      'aria-label': closeLabel,
      onclick: () => onRequestClose?.(),
    },
    [icon('x', { size: 16 })],
  );
  const nav = h('nav', {
    class: 'deck-settings-nav',
    'aria-label': t('editor.deckSettings.sections', 'Settings sections'),
  });
  const body = h('div', { class: 'deck-settings-body' });
  const el = h('div', { class: 'deck-settings-pane' }, [
    h('div', { class: 'deck-settings-head' }, [title, closeBtn]),
    nav,
    h('div', { class: 'panel-scroll' }, [body]),
  ]);

  let built = null;
  let current = null;
  /** key → { button, section } for the open pane */
  let parts = new Map();

  const close = () => {
    // A field that still has focus saves on blur: let it, before its DOM
    // goes (a Back press closes the pane without moving focus).
    const active = document.activeElement;
    if (active && el.contains(active)) active.blur?.();
    built?.detach();
    built = null;
    current = null;
    parts = new Map();
    nav.replaceChildren();
    body.replaceChildren();
  };

  const open = () => {
    if (built) return;
    built = buildSections({
      root,
      pres,
      api,
      markDirty,
      requestSave,
      toast,
      beforeThemeChange,
      onThemeChanged,
      onNavigateToSlide,
      onOpenTranslateView: getOpenTranslateView?.() || null,
    });
    for (const key of availableDeckSettingsSections()) {
      const button = h('button', {
        type: 'button',
        class: 'deck-settings-nav-btn',
        text: sectionLabel(key),
        'data-section': key,
        onclick: () => onSelectSection?.(key),
      });
      const section = h(
        'section',
        {
          class: 'deck-settings-section stack',
          'data-section': key,
          'aria-label': sectionLabel(key),
        },
        built.sections.get(key) || [],
      );
      section.hidden = true;
      parts.set(key, { button, section });
      nav.append(button);
      body.append(section);
    }
  };

  /**
   * Show one section (opening the pane first if needed).
   * @param {string} key - resolved through `resolveDeckSettingsSection`
   * @returns {string} the section shown
   */
  const showSection = (key) => {
    open();
    const next = resolveDeckSettingsSection(key);
    current = next;
    for (const [k, { button, section }] of parts) {
      const active = k === next;
      section.hidden = !active;
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    return next;
  };

  return {
    el,
    open,
    close,
    showSection,
    isOpen: () => !!built,
    containsFocus: () => el.contains(document.activeElement),
    currentSection: () => current,
    focus: () => title.focus({ preventScroll: true }),
    detach: close,
  };
}
