/**
 * Slide header actions menu — the "More options" dropdown and lock toggle that
 * sit in the inspector form header. Split out of `editor-form.js` as a
 * behaviour-preserving concern module (B10). `buildHeaderActions` is fully
 * parameterised: every dependency arrives through its options object or the
 * module imports below, so it holds no state from the editor-form closure.
 */
import { debugLog } from '../../../lib/util/debug.js';
import { cloneSlidesForInsert } from '../../../lib/slide-authoring/clone-slides.js';
import { installDismissOnOutside } from '../../../lib/dom.js';
import { createDropdown } from '../../../lib/dom/dropdown.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { slidePrimaryLabel } from '../editor-utils.js';
import {
  getAiConvertibleSlideTypes,
  getConvertibleSlideTypes,
} from '../../../../shared/slide-types.js';
import { convertSlideWithConfirm } from '../convert-slide-action.js';
import { openJsonDebugModal } from '../modals/json-debug-modal.js';
import { openSaveToLibraryModal } from '../modals/save-to-library-modal.js';
import { iconUrl } from '../../../../shared/icon-names.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { icon } from '../../../lib/dom/icons.js';

/**
 * Build the header actions dropdown menu
 */
export function buildHeaderActions({
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
    triggerClass: 'ghost-icon-btn slide-actions-btn',
    triggerContent: [icon('ellipsis', { size: 16 })],
    title: t('common.moreOptions', 'More options'),
    ariaLabel: t('common.moreOptions', 'More options'),
    menuClass: 'dropdown-menu-right slide-actions-menu',
    dismissOnOutside: false,
  });

  // Build conversion submenu
  const convertible = getConvertibleSlideTypes(slide, {
    slideTypes: SLIDE_TYPES,
  });
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
        h('span', {
          class: 'dropdown-submenu-caret',
          text: '›',
          'aria-hidden': 'true',
        }),
      ],
      title: t(
        'editor.slide.convert.title',
        'Convert this slide to a different type (best-effort).',
      ),
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
        }),
      );
    }
  }

  // Build AI conversion submenu. Which targets a type offers comes from the
  // one AI_CONVERT_PAIRS map (shared/slide-types/convert.js); the labels come
  // from the same typeLabel() the deterministic Convert submenu uses, so the
  // menu holds no type knowledge.
  const aiConvertTargets = getAiConvertibleSlideTypes(slide, {
    slideTypes: SLIDE_TYPES,
  });
  let aiConvertDetails = null;
  if (aiConvertTargets.length && api) {
    const built = createDropdown({
      h,
      triggerClass: 'dropdown-item',
      triggerContent: [
        h('span', { text: t('editor.slide.aiConvert', 'AI Convert…') }),
        h('span', {
          class: 'dropdown-submenu-caret',
          text: '›',
          'aria-hidden': 'true',
        }),
      ],
      title: t(
        'editor.slide.aiConvert.title',
        'Use AI to intelligently convert this slide to a different type.',
      ),
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
      const targetLabel = typeLabel(target);
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
              },
            );

            try {
              const lang = pres?.i18n?.active === 'en-GB' ? 'en-GB' : 'nl';
              const vendor = readPreferredLlmVendor() || null;

              const resp = await api('/api/ai/convert-slide', {
                method: 'POST',
                signal: controller.signal,
                body: JSON.stringify({
                  slide: {
                    id: slide.id,
                    type: slide.type,
                    content: slide.content,
                    notes: slide.notes || '',
                  },
                  toType: target,
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
                toast.success(
                  t('editor.slide.aiConvert.done', 'Converted successfully!'),
                );
              } else {
                throw new Error(
                  resp?.error || t('common.unknownError', 'Unknown error'),
                );
              }
            } catch (e) {
              converting.dismiss();
              if (e?.name === 'AbortError') {
                toast.info(
                  t(
                    'editor.slide.aiConvert.cancelled',
                    'Conversion cancelled.',
                  ),
                );
              } else {
                debugLog('[editor] AI convert slide failed', e);
                toast.error(
                  t(
                    'editor.slide.aiConvert.failed',
                    'Conversion failed: {error}',
                    { error: e?.message || String(e) },
                  ),
                );
              }
            } finally {
              aiConvertBusy = false;
            }
          },
        }),
      );
    }
  }

  // Assemble menu items (filter out null entries to avoid "null" text in DOM)
  const menuItems = [
    h('button', {
      class: 'dropdown-item slide-fill-translation-item',
      type: 'button',
      text: t('editor.slide.fillTranslation', 'Fill slide…'),
      title: t(
        'editor.slide.fillTranslation.title',
        'Fill this slide from the other language (with preview).',
      ),
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
        ? t(
            'editor.slideLibrary.save.title',
            'Save this slide so you can reuse it later.',
          )
        : t(
            'editor.slideLibrary.save.disabled',
            "This slide is managed automatically and can't be saved.",
          ),
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
        const [clone] = cloneSlidesForInsert([slide], {
          slideTypes: SLIDE_TYPES,
          presentationId: pres?.id || '',
        });
        pres.slides.splice(
          pres.slides.findIndex((s) => s.id === slide.id) + 1,
          0,
          clone,
        );
        setSelectedSlideId?.(clone.id);
        editorState.dirtyRefreshAll();
      },
    }),
    // Admin-only: View/edit raw JSON
    user?.isAdmin
      ? h('button', {
          class: 'dropdown-item',
          type: 'button',
          text: t('admin.jsonDebug.menuItem', 'View JSON (Debug)'),
          title: t(
            'admin.jsonDebug.menuItemTitle',
            'View and edit raw slide JSON data',
          ),
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
        })
      : null,
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
        if (
          !(await confirmModal(h, document.body, {
            title: t('editor.slide.delete', 'Delete slide'),
            message: t('editor.slide.deleteConfirm', 'Delete this slide?'),
            confirmLabel: t('common.delete', 'Delete'),
            danger: true,
          }))
        )
          return;
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
    btnLock.append(
      h('img', {
        class: 'btn-lock-icon',
        src: isLocked ? iconUrl('lock-open') : iconUrl('lock'),
        alt: '',
        'aria-hidden': 'true',
      }),
    );
  }

  if (btnLock) headerActions.append(btnLock);
  headerActions.append(actionsDetails);
  return { el: headerActions, detach: detachDismiss };
}
