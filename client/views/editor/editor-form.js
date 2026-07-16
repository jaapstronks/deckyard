import { createRenderField } from './editor-form/render-field.js';
import { renderSlideFormByType } from './editor-form/slide-form-router.js';
import { buildDeckSlideOptions } from './fields/card-link-field.js';
import { renderFocusGridField } from './editor-form/focus-picker.js';
import { newId } from '../../lib/id.js';
import { debugLog } from '../../lib/debug.js';
import { installDismissOnOutside } from '../../lib/dom.js';
import { confirmModal } from '../../lib/modal.js';
import { t } from '../../lib/ui-i18n.js';
import { slidePrimaryLabel } from './editor-utils.js';
import { toast as defaultToast } from '../../lib/toast.js';
import {
  convertSlideToType,
  getConvertibleSlideTypes,
  getConversionLossyKeys,
} from '../../../shared/slide-types.js';
import { openJsonDebugModal } from './modals/json-debug-modal.js';
import { openSaveToLibraryModal } from './modals/save-to-library-modal.js';
import { isOrgDisabledSlideType } from './slide-types-policy.js';
import { buildDataSourceIndicator } from './data-source-panel.js';
import { DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../../shared/slide-timing.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { getInlineDescriptor, getInlineFormTextKeys } from './inline-edit/descriptors.js';
import { getCollectionKey } from '../../../shared/slide-types/helpers.js';
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

// Sticky user preference: whether the collapsed "Text" section (fields that
// are also inline-editable on the preview) is expanded. Form-first users open
// it once and keep their flow; the clean default stays collapsed.
const TEXT_FIELDS_OPEN_KEY = 'editor.textFields.open';

function readTextFieldsOpen() {
  try {
    return localStorage.getItem(TEXT_FIELDS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeTextFieldsOpen(open) {
  try {
    localStorage.setItem(TEXT_FIELDS_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
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
  setFormCollapsed,
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

  const actionsDetails = h('details', { class: 'dropdown' });
  const actionsSummary = h(
    'summary',
    {
      class: 'btn btn-secondary btn-icon dropdown-trigger',
      title: t('common.moreOptions', 'More options'),
      'aria-label': t('common.moreOptions', 'More options'),
    },
    [h('span', { text: '⋯', 'aria-hidden': 'true' })]
  );
  const actionsMenu = h('div', { class: 'dropdown-menu dropdown-menu-right' });

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
    convertDetails = h('details', { class: 'dropdown dropdown-submenu' });
    const convertSummary = h(
      'summary',
      {
        class: 'dropdown-item dropdown-trigger',
        title: t('editor.slide.convert.title', 'Convert this slide to a different type (best-effort).'),
      },
      [
        h('span', { text: t('editor.slide.convert', 'Convert…') }),
        h('span', { class: 'dropdown-submenu-caret', text: '›', 'aria-hidden': 'true' }),
      ]
    );
    const convertMenu = h('div', { class: 'dropdown-menu dropdown-submenu-menu' });
    positionSubmenu(convertDetails, convertSummary, convertMenu);

    for (const toType of convertible) {
      convertMenu.append(
        h('button', {
          class: 'dropdown-item',
          type: 'button',
          text: typeLabel(toType),
          onclick: async () => {
            actionsDetails.open = false;
            convertDetails.open = false;

            const lossy = getConversionLossyKeys(slide, toType, { slideTypes: SLIDE_TYPES });
            if (lossy.length) {
              const ok = await confirmModal(h, document.body, {
                title: t('editor.slide.convert', 'Convert…'),
                message: t('editor.slide.convert.confirmLossy', 'Convert "{from}" → "{to}"?\n\nThis will remove some fields:\n{fields}\n\n(Notes are kept.)', {
                  from: typeLabel(slide.type),
                  to: typeLabel(toType),
                  fields: lossy.map((k) => `- ${k}`).join('\n'),
                }),
                confirmLabel: t('editor.slide.convert', 'Convert…'),
                danger: true,
              });
              if (!ok) return;
            }

            try {
              const lang = pres?.i18n?.active === 'en-GB' ? 'en-GB' : 'nl';
              const next = convertSlideToType(slide, toType, { slideTypes: SLIDE_TYPES, lang });
              slide.type = next.type;
              slide.content = next.content;
              editorState.dirtyRefreshWithItem();
            } catch (e) {
              debugLog('[editor] convert slide failed', e);
              toast.error(String(e?.message || e));
            }
          },
        })
      );
    }
    convertDetails.append(convertSummary, convertMenu);
  }

  // Build AI conversion submenu
  const aiConvertTargets = AI_CONVERT_TARGETS[slide.type] || [];
  let aiConvertDetails = null;
  if (aiConvertTargets.length && api) {
    aiConvertDetails = h('details', { class: 'dropdown dropdown-submenu' });
    const aiConvertSummary = h(
      'summary',
      {
        class: 'dropdown-item dropdown-trigger',
        title: t('editor.slide.aiConvert.title', 'Use AI to intelligently convert this slide to a different type.'),
      },
      [
        h('span', { text: t('editor.slide.aiConvert', 'AI Convert…') }),
        h('span', { class: 'dropdown-submenu-caret', text: '›', 'aria-hidden': 'true' }),
      ]
    );
    const aiConvertMenu = h('div', { class: 'dropdown-menu dropdown-submenu-menu' });
    positionSubmenu(aiConvertDetails, aiConvertSummary, aiConvertMenu);

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
                throw new Error(resp?.error || 'Unknown error');
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
    aiConvertDetails.append(aiConvertSummary, aiConvertMenu);
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

  actionsDetails.append(actionsSummary, actionsMenu);

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
      class: `btn btn-secondary btn-icon${isLocked ? ' is-active' : ''}`,
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

  // Collapse button: shrink the form panel to a thin rail so the slide canvas
  // gets the width (the rail re-expands it).
  let btnCollapse = null;
  if (setFormCollapsed) {
    btnCollapse = h('button', {
      class: 'btn btn-secondary btn-icon',
      type: 'button',
      text: '◀',
      title: t('editor.form.hidePanel', 'Hide edit panel'),
      'aria-label': t('editor.form.hidePanel', 'Hide edit panel'),
      onclick: () => setFormCollapsed(true),
    });
  }

  if (btnCollapse) headerActions.append(btnCollapse);
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
  onTranslateSlide,
  onTranslateField,
  user,
  openOverlayClosers,
  isAuthor,
  disabledSlideTypes,
  features,
  setFormCollapsed,
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

  return function rerenderEditor() {
    // Clean up previous dropdown listeners
    if (headerActionsDetach) {
      try { headerActionsDetach(); } catch { /* ignore */ }
      headerActionsDetach = null;
    }

    editorMount.innerHTML = '';
    const slide = pres.slides.find((s) => s.id === getSelectedSlideId?.());
    if (!slide) return;

    // Build combined header: h2 title + slide type pill + actions
    const header = h('div', { class: 'row spread editor-form-header' });
    const headerLeft = h('div', { class: 'row editor-form-header-left' });
    headerLeft.append(
      h('h2', { class: 'editor-form-title', text: t('editor.panel.title', 'Edit') }),
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
      headerLeft.append(
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
      headerLeft.append(
        h('span', {
          class: 'slide-type-custom-badge',
          text: badgeText,
          title: badgeTitle || badgeText,
        })
      );
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
      setFormCollapsed,
    });
    headerActionsDetach = headerActionsResult.detach;
    header.append(headerLeft, headerActionsResult.el);
    editorMount.append(header);

    // Data source indicator (shown for bindable slide types when live data is enabled)
    const dsBar = buildDataSourceIndicator({
      h, slide, pres, api, markDirty, editorState, features, openOverlayClosers,
    });
    if (dsBar) editorMount.append(dsBar);

    // Per-slide duration input (shown only when auto-advance is enabled)
    const timingEnabled = !!pres?.settings?.autoAdvance?.enabled;
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

    // AI reasoning panel (shown for AI-generated slides)
    if (slide._aiReasoning) {
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
        altLabel.textContent = `${t('editor.slide.aiAlternative', 'Alternative')}: `;
        const altConsider = document.createTextNode(`${t('editor.slide.aiAlternative.consider', 'Consider')} `);
        const altCode = h('code');
        altCode.textContent = alt.type;
        const altReason = document.createTextNode(` — ${alt.reason}`);
        altDiv.append(altLabel, altConsider, altCode, altReason);
        aiSection.append(altDiv);
      }

      form.append(aiSection);
    }

    // AI warnings panel (shown when validation found issues)
    if (slide._aiWarnings?.length) {
      const warningsDiv = h('div', { class: 'ai-warnings' });
      for (const w of slide._aiWarnings) {
        const p = h('p', { class: 'ai-warning-item' });
        p.textContent = `\u26A0\uFE0F ${w}`;
        warningsDiv.append(p);
      }
      form.append(warningsDiv);
    }

    // AI Iterate panel (slide-level AI refinement)
    if (api) {
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
      form.append(iteratePanel);
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

    // Text fields that are fully editable inline on the preview are tucked
    // behind a collapsed "Text" section: the slide itself is the primary text
    // surface, and the visible form leads with design controls (layout,
    // background, images). The section is the full-power fallback; its open
    // state is a sticky preference for form-first users.
    const inlineTextKeys = new Set(getInlineFormTextKeys(slide.type));

    // Legacy alias collections (items/steps/stages): the schema carries both
    // keys but the renderer reads exactly one (getCollectionKey). Skip the
    // inactive ones — a second "Stages" editor that edits an array the slide
    // never renders is a trap.
    const cardsCfg = getInlineDescriptor(slide.type)?.cards;
    const inactiveCollectionKeys = new Set();
    if (cardsCfg?.fieldAliases?.length) {
      const activeKey = getCollectionKey(slide.content, cardsCfg.field, cardsCfg.fieldAliases);
      for (const k of [cardsCfg.field, ...cardsCfg.fieldAliases]) {
        if (k !== activeKey) inactiveCollectionKeys.add(k);
      }
    }
    const textDetails = h('details', { class: 'editor-advanced editor-text-fields' });
    if (readTextFieldsOpen()) textDetails.open = true;
    textDetails.addEventListener('toggle', () => storeTextFieldsOpen(textDetails.open));
    const textSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.slide.textSection', 'Text'),
      title: t(
        'editor.slide.textSection.title',
        'All text on this slide. You can also edit it by clicking the text on the slide itself.'
      ),
    });
    const textBody = h('div', { class: 'editor-advanced-body' });
    textBody.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.slide.textSection.help',
          'Tip: you can also edit these texts by clicking them on the slide.'
        ),
      })
    );
    textDetails.append(textSummary, textBody);

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

    let textFieldCount = 0;
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
      const el = renderField(f);
      used.add(key);
      if (!el) return;
      if (isA11yFieldKey(key)) {
        a11yBody.append(el);
        return;
      }
      if (inlineTextKeys.has(key)) {
        textBody.append(el);
        textFieldCount += 1;
        return;
      }
      form.append(el);
    };

    // A slide-form can call this (after adding its text fields) to position the
    // collapsed "Text" section above its own content — card grids read better
    // with the title/subheading editors on top rather than below the card list.
    // If never called, the section is appended at the end as usual.
    let textSectionPlaced = false;
    const placeTextSection = () => {
      if (textSectionPlaced || textFieldCount === 0) return;
      form.append(textDetails);
      textSectionPlaced = true;
    };

    // Populate the Background section. Colour first: the section reads as
    // "colour ór custom image, and optionally the logo on top".
    const bgColorField = fieldByKey.get('background');
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
    const bgImageField = fieldByKey.get('slideBgImage');
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
    const logoField = fieldByKey.get('slideLogo');
    if (logoField) {
      if (slide.content.slideLogo == null) slide.content.slideLogo = 'none';
      const logoEl = renderField(logoField);
      if (logoEl) bgBody.append(logoEl);
    }

    // Route to appropriate slide form renderer
    renderSlideFormByType({
      h,
      form,
      slide,
      def,
      add,
      used,
      fieldByKey,
      renderField,
      // Deck slides (minus the current one) for in-deck card-link pickers.
      deckSlides: buildDeckSlideOptions(pres, slide?.id),
      placeTextSection,
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
    });

    // Add any remaining fields not handled by the type-specific form
    for (const f of def.fields || []) {
      if (!used.has(f.key)) add(f.key);
    }

    // Background section above the Text fallback: it's a design control set,
    // and it replaces the colour dropdown that used to sit loose in the form.
    if (bgBody.childNodes?.length) form.append(bgDetails);

    // Append the collapsed Text section (only when fields were routed into it,
    // and only if a slide-form didn't already position it above its content).
    if (textFieldCount > 0 && !textSectionPlaced) form.append(textDetails);

    // Append accessibility toggle if it has content
    if (a11yBody.childNodes?.length) form.append(a11yDetails);

    editorMount.append(form);
  };
}