import { createRenderField } from './editor-form/render-field.js';
import { renderSlideFormByType } from './editor-form/slide-form-router.js';
import { buildDeckSlideOptions } from './fields/card-link-field.js';
import { renderFocusGridField } from './editor-form/focus-picker.js';
import { newId } from '../../lib/id.js';
import { debugLog } from '../../lib/debug.js';
import { installDismissOnOutside } from '../../lib/dom.js';
import { createDropdown } from '../../lib/dropdown.js';
import { confirmModal } from '../../lib/modal.js';
import { t } from '../../lib/ui-i18n.js';
import { slidePrimaryLabel } from './editor-utils.js';
import { toast as defaultToast } from '../../lib/toast.js';
import { getConvertibleSlideTypes } from '../../../shared/slide-types.js';
import { convertSlideWithConfirm } from './convert-slide-action.js';
import { openJsonDebugModal } from './modals/json-debug-modal.js';
import { openSaveToLibraryModal } from './modals/save-to-library-modal.js';
import { isOrgDisabledSlideType } from './slide-types-policy.js';
import { buildDataSourceIndicator } from './data-source-panel.js';
import { DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../../shared/slide-timing.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { moreIcon, closeIcon } from '../../lib/icons.js';
import { getInlineDescriptor } from './inline-edit/descriptors.js';
import { createLayoutSwitcherChip } from './layout-switcher.js';
import {
  getInspectorKeepKeys,
  renderInspectorExtrasByType,
} from './editor-form/inspector-form.js';
import { getCollectionKey } from '../../../shared/slide-types/helpers.js';
import { isLocked } from '../../../shared/theme-locks.js';
import { loadThemeById } from '../../lib/theme.js';
import { detectBgTextContrast } from '../../lib/bg-contrast.js';

/**
 * Sample the current slide's background image and store which theme text colour
 * (light/dark) reads best, plus whether a scrim is still needed. Runs async and
 * persists the result on slide content (slideBgTextAuto / slideBgNeedsScrim) so
 * the server render (export/PDF/PNG) honours it without re-sampling pixels.
 * Idempotent per image via slideBgAutoFor, so the UI refresh it triggers does
 * not loop.
 * @param {object} slide
 * @param {object} pres
 * @param {{ markDirty?: Function, scheduleUiRefresh?: Function }} cbs
 */
async function runBgContrastDetection(slide, pres, { markDirty, scheduleUiRefresh } = {}) {
  const url = String(slide?.content?.slideBgImage || '').trim();
  if (!url) return;
  if (slide.content.slideBgAutoFor === url) return; // already detected for this image
  let theme = null;
  try {
    theme = await loadThemeById(pres?.theme);
  } catch {
    theme = null;
  }
  let result;
  try {
    result = await detectBgTextContrast(url, {
      light: theme?.textColorLight || '#ffffff',
      dark: theme?.textColorDark || '#212121',
    });
  } catch {
    result = { ok: false };
  }
  // Guard against a race: the author may have swapped the image mid-detection.
  if (String(slide?.content?.slideBgImage || '').trim() !== url) return;
  slide.content.slideBgAutoFor = url;
  if (result?.ok) {
    slide.content.slideBgTextAuto = result.text;
    slide.content.slideBgNeedsScrim = !!result.needsScrim;
  } else {
    // Couldn't sample (e.g. cross-origin image) — drop any stale recommendation
    // so 'auto' falls back to the theme default rather than a wrong swap.
    delete slide.content.slideBgTextAuto;
    delete slide.content.slideBgNeedsScrim;
  }
  markDirty?.();
  scheduleUiRefresh?.();
}

// Sticky user preference for the unified "Background" section (colour +
// custom image + corner logo). Defaults to open: the colour picker lives
// here now, and hiding a primary design control behind a collapsed panel
// would be a discoverability regression.
const BG_SECTION_OPEN_KEY = 'editor.bgSection.open';

function readBgSectionOpen() {
  try {
    return localStorage.getItem(BG_SECTION_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function storeBgSectionOpen(open) {
  try {
    localStorage.setItem(BG_SECTION_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Whether a selected canvas element ({kind, idx}) has an element tab on this
 * slide type. Images: image / image-text. Cards: icon-card-grid (idx in range).
 * @returns {boolean}
 */
function elementAppliesToSlide(slide, sel) {
  if (!slide || !sel) return false;
  if (sel.kind === 'image') {
    return slide.type === 'image-slide' || slide.type === 'image-text-slide';
  }
  if (sel.kind === 'card' && slide.type === 'icon-card-grid-slide') {
    const items = slide.content?.items;
    return Array.isArray(items) && sel.idx >= 0 && sel.idx < items.length;
  }
  return false;
}

/** Label for the element tab, by selected element kind. */
function elementTabLabel(sel) {
  if (sel?.kind === 'image') return t('editor.inspector.tab.image', 'This image');
  if (sel?.kind === 'card') return t('editor.inspector.tab.card', 'This card');
  return t('editor.inspector.tab.element', 'This element');
}

// AI conversion targets — which types can each slide type convert to?
const AI_CONVERT_TARGETS = {
  'content-slide': [
    { type: 'lijstje-slide', labelKey: 'slideType.lijstje-slide.label', label: 'List' },
    { type: 'icon-card-grid-slide', labelKey: 'slideType.icon-card-grid-slide.label', label: 'Icon cards' },
    { type: 'text-blocks-slide', labelKey: 'slideType.text-blocks-slide.label', label: 'Text blocks' },
    { type: 'kpi-metrics-slide', labelKey: 'slideType.kpi-metrics-slide.label', label: 'KPI metrics' },
  ],
  'list-slide': [
    { type: 'icon-card-grid-slide', labelKey: 'slideType.icon-card-grid-slide.label', label: 'Icon cards' },
    { type: 'content-slide', labelKey: 'slideType.content-slide.label', label: 'Content' },
    { type: 'text-blocks-slide', labelKey: 'slideType.text-blocks-slide.label', label: 'Text blocks' },
  ],
  // Also match the alias
  'lijstje-slide': [
    { type: 'icon-card-grid-slide', labelKey: 'slideType.icon-card-grid-slide.label', label: 'Icon cards' },
    { type: 'content-slide', labelKey: 'slideType.content-slide.label', label: 'Content' },
    { type: 'text-blocks-slide', labelKey: 'slideType.text-blocks-slide.label', label: 'Text blocks' },
  ],
  'icon-card-grid-slide': [
    { type: 'lijstje-slide', labelKey: 'slideType.lijstje-slide.label', label: 'List' },
    { type: 'content-slide', labelKey: 'slideType.content-slide.label', label: 'Content' },
    { type: 'text-blocks-slide', labelKey: 'slideType.text-blocks-slide.label', label: 'Text blocks' },
  ],
  'text-blocks-slide': [
    { type: 'icon-card-grid-slide', labelKey: 'slideType.icon-card-grid-slide.label', label: 'Icon cards' },
    { type: 'lijstje-slide', labelKey: 'slideType.lijstje-slide.label', label: 'List' },
  ],
  'kpi-metrics-slide': [
    { type: 'content-slide', labelKey: 'slideType.content-slide.label', label: 'Content' },
    { type: 'lijstje-slide', labelKey: 'slideType.lijstje-slide.label', label: 'List' },
  ],
};

/**
 * Build the header actions dropdown menu
 */
function buildHeaderActions({
  h,
  slide,
  pres,
  api,
  toast,
  SLIDE_TYPES,
  openSlideLibraryModal,
  setSelectedSlideId,
  editorState,
  rerenderEditor,
  onTranslateSlide,
  user,
  openOverlayClosers,
  markDirty,
  rerenderPreview,
  rerenderSlideList,
  isAuthor,
}) {
  const headerActions = h('div', { class: 'row editor-form-header-actions' });
  const isFollowInviteSlide = slide.type === 'follow-invite-slide';
  // Follow-invite slides shouldn't be saved to library (they're presentation-specific)
  const canSaveToLibrary = !!api && !isFollowInviteSlide;

  const saveToLibrary = () => {
    if (!api) return;
    const suggestedName = slidePrimaryLabel(slide, SLIDE_TYPES) || '';
    openSaveToLibraryModal({
      h,
      root: document.body,
      slide,
      pres,
      api,
      suggestedName,
      openOverlayClosers,
      openSlideLibraryModal,
    });
  };

  // Top-level actions menu. dismissOnOutside is handled below with a custom
  // close that also collapses the Convert / AI Convert submenus.
  const { details: actionsDetails, menu: actionsMenu } = createDropdown({
    h,
    triggerClass: 'ghost-icon-btn',
    triggerContent: [moreIcon({ size: 16 })],
    title: t('common.moreOptions', 'More options'),
    ariaLabel: t('common.moreOptions', 'More options'),
    menuClass: 'dropdown-menu-right',
    dismissOnOutside: false,
  });

  // Build conversion submenu
  const convertible = getConvertibleSlideTypes(slide, { slideTypes: SLIDE_TYPES });
  const defFor = (type) => SLIDE_TYPES?.[type] || null;
  const typeLabel = (type) => {
    const def = defFor(type);
    return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
  };

  // Helper: position a fixed submenu next to its trigger (opens LEFT to avoid viewport edge)
  const positionSubmenu = (details, summary, menu) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const rect = summary.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = `${rect.top}px`;
      menu.style.left = 'auto';
      menu.style.right = `${window.innerWidth - rect.left + 4}px`;
    });
  };

  let convertDetails = null;
  if (convertible.length) {
    const built = createDropdown({
      h,
      triggerClass: 'dropdown-item',
      triggerContent: [
        h('span', { text: t('editor.slide.convert', 'Convert…') }),
        h('span', { class: 'dropdown-submenu-caret', text: '›', 'aria-hidden': 'true' }),
      ],
      title: t('editor.slide.convert.title', 'Convert this slide to a different type (best-effort).'),
      detailsClass: 'dropdown-submenu',
      menuClass: 'dropdown-submenu-menu',
      dismissOnOutside: false,
    });
    convertDetails = built.details;
    const convertMenu = built.menu;
    positionSubmenu(convertDetails, built.summary, convertMenu);

    for (const toType of convertible) {
      convertMenu.append(
        h('button', {
          class: 'dropdown-item',
          type: 'button',
          text: typeLabel(toType),
          onclick: async () => {
            actionsDetails.open = false;
            convertDetails.open = false;
            await convertSlideWithConfirm({
              h,
              slide,
              toType,
              pres,
              editorState,
              SLIDE_TYPES,
            });
          },
        })
      );
    }
  }

  // Build AI conversion submenu
  const aiConvertTargets = AI_CONVERT_TARGETS[slide.type] || [];
  let aiConvertDetails = null;
  if (aiConvertTargets.length && api) {
    const built = createDropdown({
      h,
      triggerClass: 'dropdown-item',
      triggerContent: [
        h('span', { text: t('editor.slide.aiConvert', 'AI Convert…') }),
        h('span', { class: 'dropdown-submenu-caret', text: '›', 'aria-hidden': 'true' }),
      ],
      title: t('editor.slide.aiConvert.title', 'Use AI to intelligently convert this slide to a different type.'),
      detailsClass: 'dropdown-submenu',
      menuClass: 'dropdown-submenu-menu',
      dismissOnOutside: false,
    });
    aiConvertDetails = built.details;
    const aiConvertMenu = built.menu;
    positionSubmenu(aiConvertDetails, built.summary, aiConvertMenu);

    // Guard against re-triggering a convert while one is already in flight
    // (the menu closes on click, but reopening it must not fire a second call).
    let aiConvertBusy = false;

    for (const target of aiConvertTargets) {
      const targetLabel = t(target.labelKey, target.label);
      aiConvertMenu.append(
        h('button', {
          class: 'dropdown-item',
          type: 'button',
          text: targetLabel,
          onclick: async () => {
            actionsDetails.open = false;
            aiConvertDetails.open = false;
            if (aiConvertBusy) return;
            aiConvertBusy = true;

            const controller = new AbortController();
            const converting = toast.info(
              t('editor.slide.aiConvert.converting', 'Converting with AI…'),
              {
                id: 'ai-convert',
                durationMs: 120000,
                action: {
                  label: t('editor.slide.aiConvert.cancel', 'Cancel'),
                  onClick: () => controller.abort(),
                },
              }
            );

            try {
              const lang = pres?.i18n?.active === 'en-GB' ? 'en-GB' : 'nl';
              const { readPreferredLlmVendor } = await import('../../lib/llm-vendor.js');
              const vendor = readPreferredLlmVendor() || null;

              const resp = await api('/api/ai/convert-slide', {
                method: 'POST',
                signal: controller.signal,
                body: JSON.stringify({
                  slide: { id: slide.id, type: slide.type, content: slide.content, notes: slide.notes || '' },
                  toType: target.type,
                  lang,
                  vendor,
                }),
              });

              if (resp?.slide) {
                slide.type = resp.slide.type;
                slide.content = resp.slide.content;
                if (resp.slide.notes) slide.notes = resp.slide.notes;
                converting.dismiss();
                editorState.dirtyRefreshWithItem();
                toast.success(t('editor.slide.aiConvert.done', 'Converted successfully!'));
              } else {
                throw new Error(resp?.error || t('common.unknownError', 'Unknown error'));
              }
            } catch (e) {
              converting.dismiss();
              if (e?.name === 'AbortError') {
                toast.info(t('editor.slide.aiConvert.cancelled', 'Conversion cancelled.'));
              } else {
                debugLog('[editor] AI convert slide failed', e);
                toast.error(t('editor.slide.aiConvert.failed', 'Conversion failed: {error}', { error: e?.message || String(e) }));
              }
            } finally {
              aiConvertBusy = false;
            }
          },
        })
      );
    }
  }

  // Assemble menu items (filter out null entries to avoid "null" text in DOM)
  const menuItems = [
    h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('editor.slide.fillTranslation', 'Fill slide…'),
      title: t('editor.slide.fillTranslation.title', 'Fill this slide from the other language (with preview).'),
      onclick: async () => {
        actionsDetails.open = false;
        if (convertDetails) convertDetails.open = false;
        if (aiConvertDetails) aiConvertDetails.open = false;
        try {
          await onTranslateSlide?.({ slideId: slide.id });
        } catch (e) {
          debugLog('[editor] translate slide failed', e);
        }
      },
    }),
    h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('editor.slideLibrary.save', 'Save to slide library…'),
      title: canSaveToLibrary
        ? t('editor.slideLibrary.save.title', 'Save this slide so you can reuse it later.')
        : t('editor.slideLibrary.save.disabled', "This slide is managed automatically and can't be saved."),
      disabled: !canSaveToLibrary,
      onclick: () => {
        actionsDetails.open = false;
        if (convertDetails) convertDetails.open = false;
        if (aiConvertDetails) aiConvertDetails.open = false;
        saveToLibrary();
      },
    }),
    convertDetails,
    aiConvertDetails,
    h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('editor.slide.duplicate', 'Duplicate'),
      onclick: () => {
        actionsDetails.open = false;
        if (convertDetails) convertDetails.open = false;
        if (aiConvertDetails) aiConvertDetails.open = false;
        const clone = structuredClone(slide);
        clone.id = newId();
        if (clone.type === 'poll-slide') {
          if (!clone.content || typeof clone.content !== 'object') clone.content = {};
          clone.content.pollId = newId();
        }
        pres.slides.splice(pres.slides.findIndex((s) => s.id === slide.id) + 1, 0, clone);
        setSelectedSlideId?.(clone.id);
        editorState.dirtyRefreshAll();
      },
    }),
    // Admin-only: View/edit raw JSON
    user?.isAdmin ? h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: t('admin.jsonDebug.menuItem', 'View JSON (Debug)'),
      title: t('admin.jsonDebug.menuItemTitle', 'View and edit raw slide JSON data'),
      onclick: () => {
        actionsDetails.open = false;
        if (convertDetails) convertDetails.open = false;
        if (aiConvertDetails) aiConvertDetails.open = false;
        openJsonDebugModal({
          h,
          root: document.body,
          slide,
          SLIDE_TYPES,
          openOverlayClosers,
          markDirty,
          rerenderEditor,
          rerenderPreview,
          rerenderSlideList,
        });
      },
    }) : null,
    // Destructive action last, visually separated. Lives in the menu (not as a
    // standing header button) so the default chrome stays calm; power users
    // also have Delete/Backspace on the slide list and the bulk-action bar.
    h('button', {
      class: 'dropdown-item is-danger',
      type: 'button',
      text: t('editor.slide.deleteMenu', 'Delete slide…'),
      onclick: async () => {
        actionsDetails.open = false;
        if (convertDetails) convertDetails.open = false;
        if (aiConvertDetails) aiConvertDetails.open = false;
        if (!(await confirmModal(h, document.body, {
          title: t('editor.slide.delete', 'Delete slide'),
          message: t('editor.slide.deleteConfirm', 'Delete this slide?'),
          confirmLabel: t('common.delete', 'Delete'),
          danger: true,
        }))) return;
        // Keep the viewport where it was: select the slide that slid into the
        // deleted slot (former N+1 becomes the new N), clamped to the last
        // slide. Jumping back to slide 1 was inconsistent with the slide list,
        // which stays put. Mirrors deleteSlides() in slide-list/slide-actions.js.
        const delIdx = pres.slides.findIndex((s) => s.id === slide.id);
        pres.slides = pres.slides.filter((s) => s.id !== slide.id);
        const nextIdx = Math.max(0, Math.min(delIdx, pres.slides.length - 1));
        setSelectedSlideId?.(pres.slides?.[nextIdx]?.id || null);
        editorState.dirtyRefreshAll();
      },
    }),
  ].filter(Boolean);
  actionsMenu.append(...menuItems);

  // Close the dropdown on outside click / Escape
  const detachDismiss = installDismissOnOutside({
    rootEl: actionsDetails,
    isOpen: () => !!actionsDetails.open,
    close: () => {
      actionsDetails.open = false;
      if (convertDetails) convertDetails.open = false;
      if (aiConvertDetails) aiConvertDetails.open = false;
    },
  });

  // Lock/unlock button (author only)
  let btnLock = null;
  if (isAuthor) {
    const isLocked = !!slide.lockedByAuthor;
    btnLock = h('button', {
      class: `ghost-icon-btn${isLocked ? ' is-active' : ''}`,
      type: 'button',
      title: isLocked
        ? t('editor.slide.unlock', 'Unlock slide')
        : t('editor.slide.lock', 'Lock slide'),
      'aria-label': isLocked
        ? t('editor.slide.unlock', 'Unlock slide')
        : t('editor.slide.lock', 'Lock slide'),
      onclick: () => {
        slide.lockedByAuthor = !slide.lockedByAuthor;
        markDirty?.();
        rerenderEditor?.();
        rerenderSlideList?.();
      },
    });
    btnLock.append(h('img', { class: 'btn-lock-icon', src: isLocked ? iconUrl('lock-open') : iconUrl('lock'), alt: '', 'aria-hidden': 'true' }));
  }

  if (btnLock) headerActions.append(btnLock);
  headerActions.append(actionsDetails);
  return { el: headerActions, detach: detachDismiss };
}

export function createRerenderEditor({
  h,
  editorMount,
  pres,
  SLIDE_TYPES,
  api,
  toast = defaultToast,
  openSlideLibraryModal,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  markDirty,
  requestSave,
  rerenderSlideList,
  rerenderPreview,
  scheduleUiRefresh,
  updateSelectedSlideListItem,
  PARTNER_LOGOS,
  fieldRenderers,
  // The active theme, for its override locks. Absent means nothing is locked.
  theme = null,
  onTranslateSlide,
  onTranslateField,
  user,
  openOverlayClosers,
  isAuthor,
  disabledSlideTypes,
  features,
  setInspectorCollapsed,
  // Mount points in the canvas header for the slide-scoped toolbar
  // ({ leftEl, actionsEl }); absent in contentOnly mode and in tests.
  slideToolbar,
  onOpenBulkEdit,
  // Bulk-edit ("Edit all text") mode: render ONLY the per-type content fields
  // into editorMount - no header/actions, no data-source bar, no duration, no
  // AI panels, no Background/Accessibility sections, and inline-covered text
  // fields render in place instead of tucked behind the collapsed Text
  // section. Reuses the exact same field renderers, so the modal can never
  // drift from what the form can edit (the phase-2 parity invariant).
  contentOnly = false,
  // Selection-aware inspector: () => {kind:'image'|'card', idx} | null. When an
  // element is selected the inspector grows a [This element | Slide] tab bar.
  getSelectedElement,
} = {}) {
  const {
    fieldText,
    fieldNumber,
    fieldTextarea,
    fieldMarkdown,
    fieldCode,
    fieldEnum,
    fieldGrid,
    fieldBackground,
    fieldColor,
    fieldIconPicker,
    fieldImage,
    fieldTitleBgImage,
    fieldImages,
  } = fieldRenderers || {};

  // Whether this user may author raw HTML/CSS (custom-html-slide). The server
  // enforces the same gate on write; this drives the read-only UI state.
  const canEditCustomHtml = Boolean(user?.canEditCustomHtml);

  // Track detachers for cleanup between re-renders
  let headerActionsDetach = null;

  // Which inspector tab is active while an element is selected. A newly
  // selected element resets to its own tab; clicking "Slide" persists across
  // rerenders (so editing a slide-wide field doesn't yank you back).
  let activeElementTab = true;
  let lastElementKey = null;

  return function rerenderEditor() {
    // Clean up previous dropdown listeners
    if (headerActionsDetach) {
      try { headerActionsDetach(); } catch { /* ignore */ }
      headerActionsDetach = null;
    }

    editorMount.innerHTML = '';
    const slide = pres.slides.find((s) => s.id === getSelectedSlideId?.());
    if (!slide) return;

    // Pane header: pure pane chrome (chrome re-org 2026-07-16). Everything
    // scoped to the current slide (type chip, "All text", lock, actions
    // menu) renders into the slide toolbar above the canvas instead.
    if (!contentOnly) {
    const header = h('div', { class: 'row spread editor-form-header' });
    header.append(
      h('h2', { class: 'editor-form-title', text: t('editor.inspector.title', 'Inspector') })
    );
    if (setInspectorCollapsed) {
      header.append(
        (() => {
          const b = h('button', {
            class: 'ghost-icon-btn editor-form-close-btn',
            type: 'button',
            title: t('editor.inspector.hide', 'Hide inspector'),
            'aria-label': t('editor.inspector.hide', 'Hide inspector'),
            onclick: () => setInspectorCollapsed(true),
          });
          b.append(closeIcon({ size: 16 }));
          return b;
        })()
      );
    }
    editorMount.append(header);

    // Slide toolbar above the canvas: type chip + badges + "All text" on the
    // left; lock + slide-actions menu on the right. Rebuilt per slide.
    const tbLeft = slideToolbar?.leftEl || null;
    const tbActions = slideToolbar?.actionsEl || null;
    if (tbLeft) {
      tbLeft.innerHTML = '';
      tbLeft.append(
        h('div', {
          class: 'pill',
          text: t(
            SLIDE_TYPES[slide.type]?.labelKey || `slideType.${slide.type}.label`,
            SLIDE_TYPES[slide.type]?.label || slide.type
          ),
        })
      );

      // Show retired badge if slide type is org-disabled
      if (isOrgDisabledSlideType(slide.type, disabledSlideTypes)) {
        tbLeft.append(
          h('span', {
            class: 'slide-type-retired-badge',
            text: t('editor.slide.retiredType', 'Retired type'),
            title: t('editor.slide.retiredType.title', 'This slide type is no longer available for new slides.'),
          })
        );
      }

      // Show custom type badge
      const slideDef = SLIDE_TYPES[slide.type];
      if (slideDef?.isCustom || slide.type.startsWith('custom-')) {
        const badgeText = t('editor.slide.customType', 'Custom type');
        const badgeTitle = slideDef?.baseType
          ? t('editor.slide.customType.basedOn', 'Based on: {base}', { base: slideDef.baseType })
          : '';
        tbLeft.append(
          h('span', {
            class: 'slide-type-custom-badge',
            text: badgeText,
            title: badgeTitle || badgeText,
          })
        );
      }

      // Layout switcher chip: only for types that declare layoutVariants
      // (type-agnostic; forks that override a type control their own set).
      const layoutChip = createLayoutSwitcherChip({
        h,
        slide,
        pres,
        SLIDE_TYPES,
        editorState,
        openOverlayClosers,
      });
      if (layoutChip) tbLeft.append(layoutChip);

      // "Edit all text": opens the roomy bulk-edit modal (all content fields
      // + live preview).
      if (typeof onOpenBulkEdit === 'function') {
        tbLeft.append(
          h('button', {
            type: 'button',
            class: 'btn editor-bulk-edit-btn',
            text: t('editor.bulkEdit.open', 'All text'),
            title: t('editor.bulkEdit.openTitle', 'Edit all text fields of this slide in one view'),
            onclick: () => onOpenBulkEdit(),
          })
        );
      }
    }

    const headerActionsResult = buildHeaderActions({
      h,
      slide,
      pres,
      api,
      toast,
      SLIDE_TYPES,
      openSlideLibraryModal,
      setSelectedSlideId,
      editorState,
      rerenderEditor,
      onTranslateSlide,
      user,
      openOverlayClosers,
      markDirty,
      rerenderPreview,
      rerenderSlideList,
      isAuthor,
    });
    headerActionsDetach = headerActionsResult.detach;
    if (tbActions) {
      tbActions.innerHTML = '';
      tbActions.append(headerActionsResult.el);
    }
    } // end !contentOnly header

    // Data source indicator (shown for bindable slide types when live data is enabled)
    if (!contentOnly) {
      const dsBar = buildDataSourceIndicator({
        h, slide, pres, api, markDirty, editorState, features, openOverlayClosers,
      });
      if (dsBar) editorMount.append(dsBar);
    }

    // Per-slide duration input (shown only when auto-advance is enabled)
    const timingEnabled = !contentOnly && !!pres?.settings?.autoAdvance?.enabled;
    if (timingEnabled) {
      const deckDefault = pres.settings.autoAdvance.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS;
      const durationWrap = h('div', { class: 'editor-slide-duration' });
      const durationLabel = h('div', {
        class: 'help',
        text: t('editor.slide.duration.label', 'Slide duration (seconds)'),
      });
      const durationInput = h('input', {
        type: 'number',
        class: 'form-input form-input-sm',
        min: '1',
        max: '300',
        placeholder: String(deckDefault) + 's (default)',
        value: slide.duration != null ? String(slide.duration) : '',
      });
      const durationHelp = h('div', {
        class: 'help',
        text: t(
          'editor.slide.duration.help',
          'Leave empty to use the deck default ({default}s). Override for this slide only.',
          { default: String(deckDefault) }
        ),
      });
      durationInput.addEventListener('input', () => {
        const v = durationInput.value.trim();
        if (v === '') {
          delete slide.duration;
          markDirty?.();
        } else {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1 && n <= 300) {
            slide.duration = Math.round(n);
            markDirty?.();
          }
        }
      });
      durationInput.addEventListener('blur', () => {
        const v = durationInput.value.trim();
        if (v === '') {
          delete slide.duration;
        } else {
          let n = Number(v);
          if (!Number.isFinite(n) || n < 1) n = 1;
          if (n > 300) n = 300;
          n = Math.round(n);
          durationInput.value = String(n);
          slide.duration = n;
        }
        markDirty?.();
        requestSave?.();
      });
      durationWrap.append(durationLabel, durationInput, durationHelp);
      editorMount.append(durationWrap);
    }

    // Build form
    const def = SLIDE_TYPES[slide.type];
    const form = h('div', { class: 'stack editor-form' });
    const fieldByKey = new Map((def?.fields || []).map((f) => [f.key, f]));
    const used = new Set();

    // Selection-aware inspector: when a canvas element (image/card) is selected
    // and applies to this slide, its settings render into `elementForm` (the
    // "This element" tab) and the tab bar appears; the rest renders into `form`
    // (the "Slide" tab). With no selection there is no tab bar - just `form`.
    const selectedElement = contentOnly ? null : getSelectedElement?.() || null;
    const elementActive = elementAppliesToSlide(slide, selectedElement);
    const elemKey = elementActive
      ? `${selectedElement.kind}:${selectedElement.idx}`
      : null;
    if (elemKey !== lastElementKey) {
      // A fresh selection (or a deselect) resets to the element's own tab.
      activeElementTab = true;
      lastElementKey = elemKey;
    }
    const elementForm = h('div', { class: 'stack editor-form editor-element-form' });

    // AI reasoning panel (shown for AI-generated slides)
    if (!contentOnly && slide._aiReasoning) {
      const aiSection = h('details', { class: 'ai-reasoning-panel' });
      const summary = h('summary', { class: 'ai-reasoning-toggle' });
      summary.textContent = t('editor.slide.aiReasoning', 'AI type reasoning');
      aiSection.append(summary);

      const reasoningText = h('p', { class: 'ai-reasoning-text' });
      reasoningText.textContent = slide._aiReasoning;
      aiSection.append(reasoningText);

      // Alternatives: newer slides carry _aiAlternatives [{type, reason}];
      // older stored slides may still have the flat _aiAlternativeType pair.
      const alternatives = Array.isArray(slide._aiAlternatives)
        ? slide._aiAlternatives.filter((a) => a?.type && a?.reason)
        : slide._aiAlternativeType && slide._aiAlternativeReason
          ? [{ type: slide._aiAlternativeType, reason: slide._aiAlternativeReason }]
          : [];
      for (const alt of alternatives) {
        const altDiv = h('div', { class: 'ai-reasoning-alternative' });
        const altLabel = h('strong');
        altLabel.textContent = t('editor.slide.aiAlternativeLabel', 'Alternative:');
        const altCode = h('code');
        altCode.textContent = alt.type;
        // One key for the whole suggestion: {type} marks where the <code> node
        // goes, so translations control word order and punctuation.
        const tpl = t('editor.slide.aiAlternativeSuggestion', 'Consider {type} — {reason}');
        const [beforeType, afterType = ''] = tpl.split('{type}');
        const fillReason = (s) => s.replace('{reason}', () => String(alt.reason));
        altDiv.append(
          altLabel,
          document.createTextNode(' '),
          document.createTextNode(fillReason(beforeType)),
          altCode,
          document.createTextNode(fillReason(afterType))
        );
        aiSection.append(altDiv);
      }

      form.append(aiSection);
    }

    // AI warnings panel (shown when validation found issues)
    if (!contentOnly && slide._aiWarnings?.length) {
      const warningsDiv = h('div', { class: 'ai-warnings' });
      for (const w of slide._aiWarnings) {
        const p = h('p', { class: 'ai-warning-item' });
        p.textContent = t('editor.slide.aiWarningItem', '\u26A0\uFE0F {warning}', { warning: w });
        warningsDiv.append(p);
      }
      form.append(warningsDiv);
    }

    // AI Iterate panel (slide-level AI refinement). Built here, appended at
    // the very end of the form: the inspector is a settings pane first, and
    // the refine box is a tool, not a setting.
    let aiIteratePanel = null;
    if (api && !contentOnly) {
      const iteratePanel = h('div', { class: 'ai-iterate-panel' });
      const iterateForm = h('div', { class: 'ai-iterate-form' });
      const iterateInput = h('input', {
        type: 'text',
        class: 'form-input ai-iterate-input',
        placeholder: t('editor.slide.aiIterate.placeholder', 'Make this punchier, split this slide...'),
      });
      const iterateBtn = h('button', {
        type: 'button',
        class: 'btn btn-secondary ai-iterate-btn',
        title: t('editor.slide.aiIterate.title', 'Use AI to refine this slide'),
      });
      iterateBtn.textContent = t('editor.slide.aiIterate.button', 'Refine');

      let isIterating = false;
      let iterateController = null;

      // While a refine is in flight the button becomes a Cancel control (with a
      // spinner) so the user can abort a slow LLM call instead of waiting.
      const setIterateBusy = (busy) => {
        isIterating = busy;
        iterateBtn.classList.toggle('is-loading', busy);
        iterateBtn.textContent = busy
          ? t('editor.slide.aiIterate.cancel', 'Cancel')
          : t('editor.slide.aiIterate.button', 'Refine');
      };

      const handleIterate = async () => {
        const command = iterateInput.value.trim();
        if (!command || isIterating) return;

        iterateController = new AbortController();
        setIterateBusy(true);

        try {
          const { readPreferredLlmVendor } = await import('../../lib/llm-vendor.js');
          const vendor = readPreferredLlmVendor() || null;
          const lang = pres?.i18n?.active === 'en-GB' ? 'en-GB' : 'nl';

          // This panel edits one slide: tell the server which slide so refine
          // scopes to it (faster) unless the command names another slide.
          const currentSlideIndex = pres.slides.findIndex(
            (s) => s.id === slide.id
          );

          const resp = await api('/api/ai/iterate', {
            method: 'POST',
            signal: iterateController.signal,
            body: JSON.stringify({
              presentation: pres,
              command,
              lang,
              vendor,
              currentSlideIndex,
              applyChanges: true,
            }),
          });

          if (resp?.plan?.modifications?.length > 0 && resp.presentation?.slides) {
            // Apply the change immediately, then offer a one-click Undo.
            // There is no non-destructive preview surface here, so a preview the
            // user can't see reflected on the slide is worse than just applying
            // it and using the plan summary to explain what was done — with Undo
            // as the safety net. The editor's own undo history also captures it.
            const prevSlides = structuredClone(pres.slides);
            const prevSelectedId = getSelectedSlideId?.();

            pres.slides = resp.presentation.slides;
            // Keep the edited slide selected/visible if the server flagged one.
            if (resp.targetSlideIndex != null && pres.slides[resp.targetSlideIndex]) {
              setSelectedSlideId?.(pres.slides[resp.targetSlideIndex].id);
            }
            editorState.dirtyRefreshAll();
            iterateInput.value = '';

            // Explain what was done. The per-modification `reasoning` is the
            // human-readable account of the edit (e.g. "translated to Dutch,
            // keeping structure and formatting"); fall back to the terse plan
            // summary, then a generic string.
            const reasons = resp.plan.modifications
              .map((m) => String(m?.reasoning || '').trim())
              .filter(Boolean);
            const summaryText =
              (reasons.length ? reasons.join(' • ') : '') ||
              resp.plan.summary ||
              t('editor.slide.aiIterate.applied', 'Changes applied');
            toast.success(summaryText, {
              durationMs: 15000,
              action: {
                label: t('editor.slide.aiIterate.undo', 'Undo'),
                onClick: () => {
                  pres.slides = structuredClone(prevSlides);
                  if (
                    prevSelectedId &&
                    pres.slides.some((s) => s.id === prevSelectedId)
                  ) {
                    setSelectedSlideId?.(prevSelectedId);
                  }
                  editorState.dirtyRefreshAll();
                  toast.info(
                    t('editor.slide.aiIterate.reverted', 'Reverted the change.')
                  );
                },
              },
            });
          } else {
            toast.info(t('editor.slide.aiIterate.noChanges', 'No changes suggested'));
          }
        } catch (e) {
          if (e?.name === 'AbortError') {
            toast.info(t('editor.slide.aiIterate.cancelled', 'Refinement cancelled.'));
          } else {
            console.error('[AI Iterate] Error:', e);
            toast.error(t('editor.slide.aiIterate.failed', 'Refinement failed: {error}', { error: e?.message || String(e) }));
          }
        } finally {
          iterateController = null;
          setIterateBusy(false);
        }
      };

      iterateBtn.onclick = () => {
        if (isIterating) {
          iterateController?.abort();
          return;
        }
        handleIterate();
      };
      iterateInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !isIterating) handleIterate();
      };

      iterateForm.append(iterateInput, iterateBtn);
      iteratePanel.append(iterateForm);
      aiIteratePanel = iteratePanel;
    }

    // Accessibility fields (global) are tucked behind a toggle
    const hasA11yValue =
      Boolean(String(slide?.content?.a11yTitle || '').trim()) ||
      Boolean(String(slide?.content?.a11ySummary || '').trim());
    const a11yDetails = h('details', { class: 'editor-advanced' });
    if (hasA11yValue) a11yDetails.open = true;
    const a11ySummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.accessibility', 'Accessibility'),
      title: t('editor.slide.accessibility.title', 'Optional fields to improve screen-reader output and exports.'),
    });
    const a11yBody = h('div', { class: 'editor-advanced-body' });
    a11yDetails.append(a11ySummary, a11yBody);

    // Inspector mode (the default): the pane renders ONLY settings/design
    // fields (the audit's "Inspector keeps"), plus Background and
    // Accessibility. Content lives on the slide (wysiwyg) and - all of it,
    // by construction - in the "Edit all text" bulk modal.
    const inspectorKeeps = contentOnly ? null : getInspectorKeepKeys(slide.type, def);

    // Legacy alias collections (items/steps/stages): the schema carries both
    // keys but the renderer reads exactly one (getCollectionKey). Skip the
    // inactive ones — a second "Stages" editor that edits an array the slide
    // never renders is a trap.
    const cardsCfg = getInlineDescriptor(slide.type, def)?.cards;
    const inactiveCollectionKeys = new Set();
    if (cardsCfg?.fieldAliases?.length) {
      const activeKey = getCollectionKey(slide.content, cardsCfg.field, cardsCfg.fieldAliases);
      for (const k of [cardsCfg.field, ...cardsCfg.fieldAliases]) {
        if (k !== activeKey) inactiveCollectionKeys.add(k);
      }
    }
    // The unified "Background" section: colour choice, custom image and the
    // theme corner logo live together (they used to be split between a
    // top-level colour dropdown and a collapsed "Background & logo" panel).
    // Sticky open preference (default open); force-open when a non-default
    // image/logo is set so active settings are never hidden.
    const hasBgImage = Boolean(String(slide?.content?.slideBgImage || '').trim());
    const hasCornerLogo = slide?.content?.slideLogo === 'top-right';
    const bgDetails = h('details', { class: 'editor-advanced editor-bg-section' });
    if (readBgSectionOpen() || hasBgImage || hasCornerLogo) bgDetails.open = true;
    bgDetails.addEventListener('toggle', () => storeBgSectionOpen(bgDetails.open));
    const bgSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.background.section', 'Background'),
      title: t(
        'editor.slide.background.sectionHelp',
        'Background colour or a custom image, plus the theme corner logo.'
      ),
    });
    const bgBody = h('div', { class: 'editor-advanced-body' });
    bgDetails.append(bgSummary, bgBody);

    const renderField = createRenderField({
      h,
      pres,
      slide,
      def,
      PARTNER_LOGOS,
      fieldRenderers: {
        fieldText,
        fieldNumber,
        fieldTextarea,
        fieldMarkdown,
        fieldCode,
        fieldEnum,
        fieldGrid,
        fieldBackground,
        fieldColor,
        fieldIconPicker,
        fieldImage,
        fieldTitleBgImage,
        fieldImages,
      },
      markDirty,
      rerenderEditor,
      scheduleUiRefresh,
      updateSelectedSlideListItem,
      onTranslateField,
      canEditCustomHtml,
    });

    const isA11yFieldKey = (key) => key === 'a11yTitle' || key === 'a11ySummary';
    const isGlobalBgFieldKey = (key) =>
      key === 'background' ||
      key === 'bgCustomColor' ||
      key === 'slideBgImage' ||
      key === 'slideBgFit' ||
      key === 'slideBgFocusX' ||
      key === 'slideBgFocusY' ||
      key === 'slideBgOverlay' ||
      key === 'slideBgText' ||
      key === 'slideLogo';

    const add = (key) => {
      const f = fieldByKey.get(key);
      if (!f) return;
      // Global background fields are rendered by the dedicated Background section.
      if (isGlobalBgFieldKey(key)) {
        used.add(key);
        return;
      }
      // Inactive legacy alias collection (the renderer reads the other key).
      if (inactiveCollectionKeys.has(key)) {
        used.add(key);
        return;
      }
      // Bulk-edit mode: a11y stays an inspector concern.
      if (contentOnly && isA11yFieldKey(key)) {
        used.add(key);
        return;
      }
      // Inspector mode: content fields don't render here (their homes are the
      // slide surface and the bulk modal); only the per-type keeps pass.
      if (inspectorKeeps && !isA11yFieldKey(key) && !inspectorKeeps.has(key)) {
        used.add(key);
        return;
      }
      const el = renderField(f);
      used.add(key);
      if (!el) return;
      if (isA11yFieldKey(key)) {
        a11yBody.append(el);
        return;
      }
      form.append(el);
    };

    // Theme override locks. A locked property's controls are omitted rather
    // than disabled — a disabled control invites you to wonder what it would
    // do, and the renderer ignores the value either way. One note explains the
    // absence, so the section never just looks broken.
    const bgLocked = isLocked(theme, 'background');
    const logoLocked = isLocked(theme, 'logo');
    if (bgLocked || logoLocked) {
      bgBody.append(
        h('p', {
          class: 'help',
          text: t(
            'editor.slide.background.lockedByTheme',
            'Set by the theme and not editable per slide.'
          ),
        })
      );
    }

    // Populate the Background section. Colour first: the section reads as
    // "colour ór custom image, and optionally the logo on top".
    const bgColorField =
      contentOnly || bgLocked ? null : fieldByKey.get('background');
    if (bgColorField) {
      // Inside a section already titled "Background" the field label reads
      // better as "Colour" (it sits next to "Background image").
      const colorEl = renderField({
        ...bgColorField,
        label: t('editor.slide.background.colour', 'Color'),
      });
      if (colorEl) bgBody.append(colorEl);
      // Freeform's extended option set has a 'custom' value with its own
      // colour input; only shown while 'custom' is selected (the form
      // rerenders on change, so this stays in sync).
      const bgCustomField = fieldByKey.get('bgCustomColor');
      if (bgCustomField) {
        const customEl = renderField(bgCustomField);
        if (customEl) {
          if (slide.content?.background !== 'custom') customEl.style.display = 'none';
          bgBody.append(customEl);
        }
      }
    }

    // Custom image (+ crop focus + fit/overlay once an image is set).
    const bgImageField =
      contentOnly || bgLocked ? null : fieldByKey.get('slideBgImage');
    if (bgImageField) {
      const imgEl = renderField(bgImageField);
      if (imgEl) bgBody.append(imgEl);
      if (hasBgImage) {
        bgBody.append(
          renderFocusGridField({
            h,
            label: t('editor.slide.background.focus', 'Background focus (crop)'),
            helpText: t(
              'editor.slide.background.focusHelp',
              'Pick which part stays visible when the image is cropped to fill the slide.'
            ),
            focusX: slide.content?.slideBgFocusX ?? 50,
            focusY: slide.content?.slideBgFocusY ?? 50,
            onChange: ({ focusX, focusY }) => {
              slide.content.slideBgFocusX = focusX;
              slide.content.slideBgFocusY = focusY;
              markDirty?.();
              scheduleUiRefresh?.();
            },
          })
        );
        if (slide.content.slideBgFit == null) slide.content.slideBgFit = 'cover';
        if (slide.content.slideBgOverlay == null)
          slide.content.slideBgOverlay = 'auto';
        if (slide.content.slideBgText == null)
          slide.content.slideBgText = 'auto';
        // Auto-detect the readable text colour for the current image (async;
        // stores slideBgTextAuto / slideBgNeedsScrim, then refreshes). No-op
        // when already detected for this image URL.
        runBgContrastDetection(slide, pres, { markDirty, scheduleUiRefresh });
        const fitField = fieldByKey.get('slideBgFit');
        const overlayField = fieldByKey.get('slideBgOverlay');
        const textField = fieldByKey.get('slideBgText');
        const fitEl = fitField ? renderField(fitField) : null;
        const overlayEl = overlayField ? renderField(overlayField) : null;
        const textEl = textField ? renderField(textField) : null;
        const optionsRow = fieldGrid([fitEl, overlayEl].filter(Boolean), 2);
        if (optionsRow) bgBody.append(optionsRow);
        if (textEl) bgBody.append(textEl);
      }
    }
    // Theme logo (corner) toggle — independent of the background image.
    const logoField =
      contentOnly || logoLocked ? null : fieldByKey.get('slideLogo');
    if (logoField) {
      if (slide.content.slideLogo == null) slide.content.slideLogo = 'none';
      const logoEl = renderField(logoField);
      if (logoEl) bgBody.append(logoEl);
    }

    const formTypeCtx = {
      h,
      form,
      // Selection-aware inspector: element-scoped widgets render into
      // elementForm for the selected element; slide-wide stays in form.
      elementForm,
      selectedElement: elementActive ? selectedElement : null,
      slide,
      def,
      add,
      used,
      fieldByKey,
      renderField,
      // Deck slides (minus the current one) for in-deck card-link pickers.
      deckSlides: buildDeckSlideOptions(pres, slide?.id),
      fieldRenderers: {
        fieldGrid,
        fieldText,
        fieldTextarea,
        fieldEnum,
        fieldIconPicker,
        fieldImage,
        fieldTitleBgImage,
      },
      markDirty,
      rerenderEditor,
      rerenderSlideList,
      rerenderPreview,
      scheduleUiRefresh,
    };

    if (contentOnly) {
      // Bulk modal: the full per-type content form (parity by construction).
      renderSlideFormByType(formTypeCtx);
    } else {
      // Inspector: only the per-type widgets a flat keeps-list can't express
      // (chart config, focus pickers, per-card icon/link, per-column image
      // settings); the loop below renders the remaining keeps.
      renderInspectorExtrasByType(formTypeCtx);
    }

    // Add any remaining fields not handled above. In inspector mode add()
    // gates on the keeps set, so this renders keeps in schema order and
    // routes a11y/background keys to their sections.
    for (const f of def.fields || []) {
      if (!used.has(f.key)) add(f.key);
    }

    // Background section after the type fields: it's a design control set,
    // and it replaces the colour dropdown that used to sit loose in the form.
    if (!contentOnly && bgBody.childNodes?.length) form.append(bgDetails);

    // Append accessibility toggle if it has content
    if (!contentOnly && a11yBody.childNodes?.length) form.append(a11yDetails);

    // AI refine box last: tooling under the settings.
    if (aiIteratePanel) form.append(aiIteratePanel);

    // Selection-aware inspector: with an element selected and its element form
    // populated, show a [This element | Slide] tab bar over the two panels;
    // otherwise the pane is just the slide form (identical to pre-tab behavior).
    if (!contentOnly && elementActive && elementForm.childNodes.length) {
      const tabBar = h('div', { class: 'inspector-tabs', role: 'tablist' });
      const mkTab = (label, isEl) => {
        const on = isEl === activeElementTab;
        return h('button', {
          type: 'button',
          role: 'tab',
          class: `inspector-tab${on ? ' is-active' : ''}`,
          'aria-selected': on ? 'true' : 'false',
          text: label,
          onclick: () => {
            activeElementTab = isEl;
            rerenderEditor();
          },
        });
      };
      tabBar.append(
        mkTab(elementTabLabel(selectedElement), true),
        mkTab(t('editor.inspector.tab.slide', 'Slide'), false)
      );
      editorMount.append(tabBar);
      elementForm.hidden = !activeElementTab;
      form.hidden = activeElementTab;
      editorMount.append(elementForm, form);
    } else {
      editorMount.append(form);
    }
  };
}