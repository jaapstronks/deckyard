/**
 * The type pill as a menu (B703 PR 3, D335): the pill above the canvas names
 * the slide's type and opens what changes it - Convert, AI Convert - plus the
 * admin's View JSON. The slide actions that shared the old ⋯ beside it moved
 * to the slide list (`slide-list/context-menu.js`); Fill slide to the AI box
 * in the inspector.
 *
 * `buildTypeMenu` is fully parameterised: every dependency arrives through its
 * options object or the module imports below, so it holds no state from the
 * editor-form closure. With nothing to offer (a type nothing converts to, no
 * admin) the pill is a plain label, not an empty menu.
 */
import { debugLog } from '../../../lib/state/debug.js';
import { h, installDismissOnOutside } from '../../../lib/dom/index.js';
import { createDropdown } from '../../../lib/dom/dropdown.js';
import { t } from '../../../lib/ui-i18n.js';
import {
  getAiConvertibleSlideTypes,
  getConvertibleSlideTypes,
} from '../../../../shared/slide-types.js';
import { convertSlideWithConfirm } from '../convert-slide-action.js';
import { openJsonDebugModal } from '../modals/json-debug-modal.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { featureEnabled } from '../../../lib/state/features.js';
import { isOrganizationAdmin } from '../../../../shared/organization-role.js';
import { makeDropdownCaret } from '../../../lib/dom/icons.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';

/**
 * Build the type pill: a menu trigger when there is something to offer, a
 * plain label otherwise.
 * @returns {{ el: HTMLElement, detach: () => void }}
 */
export function buildTypeMenu({
  slide,
  pres,
  api,
  toast,
  SLIDE_TYPES,
  editorState,
  rerenderEditor,
  user,
  markDirty,
  rerenderPreview,
  rerenderSlideList,
}) {
  const defFor = (type) => SLIDE_TYPES?.[type] || null;
  const typeLabel = (type) => {
    const def = defFor(type);
    return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
  };
  const pillLabel = typeLabel(slide.type);

  // Top-level menu. dismissOnOutside is handled below with a custom close
  // that also collapses the Convert / AI Convert submenus.
  const { details: actionsDetails, menu: actionsMenu } = createDropdown({
    triggerClass: 'pill type-pill',
    triggerContent: [h('span', { text: pillLabel }), makeDropdownCaret()],
    title: t('editor.slide.typeMenu.title', 'Slide type: convert or inspect'),
    menuClass: 'type-pill-menu',
    dismissOnOutside: false,
  });

  // Helper: position a fixed submenu next to its trigger. The pill sits at
  // the left of the canvas, so the submenu opens to the RIGHT.
  const positionSubmenu = (details, summary, menu) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const rect = summary.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = `${rect.top}px`;
      menu.style.right = 'auto';
      menu.style.left = `${rect.right + 4}px`;
    });
  };

  let convertDetails = null;
  let aiConvertDetails = null;
  const closeAll = () => {
    actionsDetails.open = false;
    if (convertDetails) convertDetails.open = false;
    if (aiConvertDetails) aiConvertDetails.open = false;
  };

  // Build conversion submenu
  const convertible = getConvertibleSlideTypes(slide, {
    slideTypes: SLIDE_TYPES,
  });

  if (convertible.length) {
    const built = createDropdown({
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
            closeAll();
            await convertSlideWithConfirm({
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
  // menu holds no type knowledge. Absent where AI is off (D179): the server
  // does not mount /api/ai/convert-slide there.
  const aiConvertTargets = featureEnabled('ai')
    ? getAiConvertibleSlideTypes(slide, { slideTypes: SLIDE_TYPES })
    : [];
  if (aiConvertTargets.length && api) {
    const built = createDropdown({
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
            closeAll();
            if (aiConvertBusy) return;
            aiConvertBusy = true;

            const controller = new AbortController();
            const converting = toast.info(
              t('editor.slide.aiConvert.converting', 'Converting with AI…'),
              {
                id: 'ai-convert',
                action: {
                  label: t('editor.slide.aiConvert.cancel', 'Cancel'),
                  onClick: () => controller.abort(),
                },
              },
            );

            try {
              const lang =
                normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
              const vendor = readPreferredLlmVendor() || null;

              const resp = await api('/api/ai/convert-slide', {
                method: 'POST',
                signal: controller.signal,
                body: {
                  slide: {
                    id: slide.id,
                    type: slide.type,
                    content: slide.content,
                    notes: slide.notes || '',
                  },
                  toType: target,
                  lang,
                  vendor,
                },
              });

              if (resp?.slide) {
                slide.type = resp.slide.type;
                slide.content = resp.slide.content;
                if (resp.slide.notes) slide.notes = resp.slide.notes;
                converting.dismiss();
                editorState.dirtyRefreshWithItem();
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

  // Admin-only: View/edit raw JSON
  const jsonItem = isOrganizationAdmin(user)
    ? h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: t('admin.jsonDebug.menuItem', 'View JSON (Debug)'),
        title: t(
          'admin.jsonDebug.menuItemTitle',
          'View and edit raw slide JSON data',
        ),
        onclick: () => {
          closeAll();
          openJsonDebugModal({
            root: document.body,
            slide,
            SLIDE_TYPES,
            markDirty,
            rerenderEditor,
            rerenderPreview,
            rerenderSlideList,
          });
        },
      })
    : null;

  const menuItems = [convertDetails, aiConvertDetails, jsonItem].filter(
    Boolean,
  );
  // Nothing to offer: the pill only names the type.
  if (!menuItems.length) {
    return {
      el: h('div', { class: 'pill', text: pillLabel }),
      detach: () => {},
    };
  }
  actionsMenu.append(...menuItems);

  // Close the dropdown on outside click / Escape
  const detachDismiss = installDismissOnOutside({
    rootEl: actionsDetails,
    isOpen: () => !!actionsDetails.open,
    close: closeAll,
  });

  return { el: actionsDetails, detach: detachDismiss };
}
