import { createRenderField } from './editor-form/render-field.js';
import { renderSlideFormByType } from './editor-form/slide-form-router.js';
import { buildDeckSlideOptions } from './fields/card-link-field.js';
import { t } from '../../lib/ui-i18n.js';
import { toast as defaultToast } from '../../lib/dom/toast.js';
import { isOrgDisabledSlideType } from './slide-types-policy.js';
import { buildDataSourceIndicator } from './data-source-panel.js';
import { closeIcon } from '../../lib/dom/icons.js';
import { buildHeaderActions } from './editor-form/header-actions.js';
import { getInlineDescriptor } from './inline-edit/descriptors.js';
import { createLayoutSwitcherChip } from './layout-switcher.js';
import {
  getInspectorKeepKeys,
  renderInspectorExtrasByType,
} from './editor-form/inspector-form.js';
import { renderTextElementCard } from './editor-form/text-element-card.js';
import { getCollectionKey } from '../../../shared/slide-types/helpers.js';
import { fieldFormRows } from '../../../shared/slide-types/form-layout.js';
import {
  describeUnresolvedType,
  unresolvedNotes,
} from '../../../shared/slide-types/unresolved.js';
import { ensureTitleSlideBackground } from '../../../shared/slide-types/title-slide-background.js';
import { elementAppliesToSlide, elementTabLabel } from './editor-form/element-tab.js';
import {
  buildBackgroundControls,
  isBackgroundFieldKey,
} from './editor-form/background-section.js';
import { buildSlideDurationControl } from './editor-form/slide-duration.js';
import {
  buildAiReasoningPanel,
  buildAiWarningsPanel,
} from './editor-form/ai-slide-notes.js';
import { buildAiIteratePanel } from './editor-form/ai-iterate-panel.js';

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
  // Opens the bottom-panel Data tab for a chart slide (editing-surfaces §4.3).
  // Inspector-only: the bulk modal has no bottom panel and keeps its inline grid.
  onEditChartData,
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

  // Track detachers for cleanup between re-renders. The header's actions
  // dropdown installs document-level pointerdown/keydown handlers, so the
  // *last* render's pair needs detaching on unmount too, not just the
  // previous one on each rerender — hence the `detach` on the returned API.
  let headerActionsDetach = null;
  const detachHeaderActions = () => {
    if (!headerActionsDetach) return;
    try {
      headerActionsDetach();
    } catch {
      /* ignore */
    }
    headerActionsDetach = null;
  };

  // Which inspector tab is active while an element is selected. A newly
  // selected element resets to its own tab; clicking "Slide" persists across
  // rerenders (so editing a slide-wide field doesn't yank you back).
  let activeElementTab = true;
  let lastElementKey = null;

  function rerenderEditor() {
    // Clean up previous dropdown listeners
    detachHeaderActions();

    editorMount.innerHTML = '';
    const slide = pres.slides.find((s) => s.id === getSelectedSlideId?.());
    if (!slide) return;

    /** @type {HTMLElement|null} The floating collapse control, appended last. */
    let closeSlot = null;

    // Pane chrome (chrome re-org 2026-07-16). Everything scoped to the current
    // slide (type chip, "All text", lock, actions menu) renders into the slide
    // toolbar above the canvas instead.
    if (!contentOnly) {
    // Collapse control. The "INSPECTOR" title it used to sit next to was
    // redundant beside the already-active Inspector pane tab, so the whole
    // 57px header row went (declutter 2026-07-26) — but the close button
    // stays: it belongs inside the surface it dismisses, and hiding it behind
    // hover would strand touch users. It floats in a zero-height slot over the
    // first field's label band, which is empty on every type. Built here,
    // appended at the very end — it has to land *under* the element tab bar,
    // whose right-hand "Slide" tab it would otherwise cover.
    if (setInspectorCollapsed) {
      closeSlot = h('div', { class: 'editor-form-close-slot' });
      const closeBtn = h('button', {
        class: 'ghost-icon-btn editor-form-close-btn',
        type: 'button',
        title: t('editor.inspector.hide', 'Hide inspector'),
        'aria-label': t('editor.inspector.hide', 'Hide inspector'),
        onclick: () => setInspectorCollapsed(true),
      });
      closeBtn.append(closeIcon({ size: 16 }));
      closeSlot.append(closeBtn);
    }

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
    const durationWrap = buildSlideDurationControl({
      h, pres, slide, contentOnly, markDirty, requestSave,
    });
    if (durationWrap) editorMount.append(durationWrap);

    // Build form
    const def = SLIDE_TYPES[slide.type];
    const form = h('div', { class: 'stack editor-form' });
    const fieldByKey = new Map((def?.fields || []).map((f) => [f.key, f]));
    const used = new Set();

    // A slide whose type no longer resolves has no fields to inspect, so the
    // inspector would otherwise be a silent empty pane next to a placeholder
    // slide. Say the same thing the canvas says: which type is missing, whether
    // it was deliberately removed, and what replaces it. Read-only on purpose —
    // the content is recoverable (canvas, reader view), the type is not.
    if (!def) {
      const info = describeUnresolvedType(slide.type);
      const notice = h('div', { class: 'editor-card' });
      notice.append(
        h('p', {
          class: 'field-label',
          text:
            info.state === 'removed'
              ? t('editor.slide.archivedType', 'Archived slide type')
              : t('editor.slide.unavailableType', 'Unavailable slide type'),
        })
      );
      for (const line of unresolvedNotes(info)) {
        notice.append(h('p', { class: 'help', text: line }));
      }
      form.append(notice);
    }

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
    if (!contentOnly) {
      const aiReasoning = buildAiReasoningPanel({ h, slide });
      if (aiReasoning) form.append(aiReasoning);
    }

    // AI warnings panel (shown when validation found issues)
    if (!contentOnly) {
      const aiWarnings = buildAiWarningsPanel({ h, slide });
      if (aiWarnings) form.append(aiWarnings);
    }

    // AI Iterate panel (slide-level AI refinement). Built here, appended at
    // the very end of the form: the inspector is a settings pane first, and
    // the refine box is a tool, not a setting.
    const aiIteratePanel = contentOnly
      ? null
      : buildAiIteratePanel({
          h, api, pres, slide, getSelectedSlideId, setSelectedSlideId, editorState, toast,
        });

    // Accessibility fields (global) are tucked behind a toggle. a11yTitle/
    // a11ySummary are OVERRIDES, not the primary a11y mechanism: export/present
    // announce a slide by its own heading and only fall back to a11yTitle when
    // set (server/export/html.js slideA11yLabel). So an empty section does NOT
    // mean "undescribed" — the summary reflects the honest state instead of
    // nagging, and force-opens only when a custom override exists.
    const hasA11yValue =
      Boolean(String(slide?.content?.a11yTitle || '').trim()) ||
      Boolean(String(slide?.content?.a11ySummary || '').trim());
    // Heading proxy: export announces a slide by the first non-empty h1/h2/h3
    // it finds in the rendered slide (server/export/html.js readHeadingFromSlideEl),
    // so the proxy must mirror every field that renders AS such a heading — not
    // just `title`. Most core types use `title`, but poll/likert/likert-slider
    // render their `<h2 class="heading">` from `question`, and comparison uses
    // `leftTitle`/`rightTitle`. Types that render NO heading (payoff,
    // follow-invite, quote, image without a title) announce as bare
    // "Slide N of M" until an a11yTitle is set — exactly where the override
    // earns its keep, so only those get the nudge.
    const HEADING_FIELDS = ['title', 'question', 'leftTitle', 'rightTitle'];
    const hasHeading = HEADING_FIELDS.some((f) =>
      Boolean(String(slide?.content?.[f] || '').trim())
    );
    const a11yState = hasA11yValue ? 'custom' : hasHeading ? 'auto' : 'no-heading';
    const a11yDetails = h('details', { class: 'editor-advanced editor-a11y-section' });
    if (hasA11yValue) a11yDetails.open = true;
    const a11yStatusText = {
      custom: t('editor.slide.accessibility.status.custom', 'custom description'),
      auto: t('editor.slide.accessibility.status.auto', 'auto (from the heading)'),
      'no-heading': t('editor.slide.accessibility.status.noHeading', 'no heading — add a title'),
    }[a11yState];
    const a11ySummary = h('summary', {
      class: 'editor-advanced-summary',
      title: t('editor.slide.accessibility.title', 'Optional fields to improve screen-reader output and exports.'),
    });
    a11ySummary.append(
      h('span', { text: t('editor.slide.accessibility', 'Accessibility') }),
      h('span', {
        class: `editor-a11y-status is-${a11yState}`,
        text: a11yStatusText,
      })
    );
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
    // Migrate-on-edit: fold a title slide's legacy bgImage into the canonical
    // slideBgImage before the background controls read it, so the shared picker
    // shows the (now single) background and the legacy render fallback stops
    // firing. Idempotent; inspector mode only (the bulk modal never renders bg).
    if (!contentOnly && slide?.type === 'title-slide') {
      ensureTitleSlideBackground(slide.content);
    }

    // Deck slides (minus the current one) for in-deck card-link pickers, in
    // both the per-type forms and the generic collection editor.
    const deckSlides = buildDeckSlideOptions(pres, slide?.id);

    const renderField = createRenderField({
      h,
      pres,
      slide,
      def,
      PARTNER_LOGOS,
      deckSlides,
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
      // Inspector only: the csv-grid widget renders an "Edit data…" entry
      // point into the bottom-panel Data tab; the bulk modal (contentOnly)
      // has no bottom panel and keeps the inline grid.
      onEditData: contentOnly ? null : onEditChartData,
    });

    const isA11yFieldKey = (key) => key === 'a11yTitle' || key === 'a11ySummary';

    /**
     * Render one schema field into the form.
     *
     * `target` is an optional sink — anything with `append()` — used by the
     * row grouping in renderFieldRows() to collect a declared `formLayout`
     * pair before wrapping it. It only redirects the *default* destination:
     * a key that is gated out renders nowhere, and an a11y key still goes to
     * the Accessibility section, because those routings are about what the
     * field is, not about who asked for it.
     *
     * @param {string} key
     * @param {{ append: (el: Node) => void }} [target]
     */
    const add = (key, target) => {
      const f = fieldByKey.get(key);
      if (!f) return;
      // Hidden fields are carried data, not editor surface; deprecated fields
      // are legacy mirrors (numbered card1Title…, count enums) kept for old
      // decks — the canonical array is the edited shape. Neither renders.
      if (f.hidden || f.deprecated) {
        used.add(key);
        return;
      }
      // Slide-wide background fields have their own surfaces (colour group +
      // image section), built below.
      if (isBackgroundFieldKey(key)) {
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
      (target || form).append(el);
    };

    /**
     * Render a run of schema fields in definition order, honouring the
     * `formLayout: 'pair'` declaration: a run of consecutive paired fields
     * lands in one `.field-grid` row, everything else gets its own line.
     *
     * The single generic form loop, shared by the bulk modal (via
     * renderSlideFormByType) and the inspector's remaining-keeps pass — so one
     * declaration on the type means one thing on both surfaces.
     *
     * @param {Array<Object>} fields - schema fields, in the order to render
     */
    const renderFieldRows = (fields) => {
      for (const row of fieldFormRows(fields)) {
        if (!row.pair) {
          for (const key of row.keys) add(key);
          continue;
        }
        // Collect first, wrap after: a paired key can be gated out (background,
        // a non-keep in the inspector), and a row of nothing must not leave an
        // empty grid behind.
        const nodes = [];
        const sink = { append: (el) => nodes.push(el) };
        for (const key of row.keys) add(key, sink);
        const grid = fieldGrid(nodes);
        if (grid) form.append(grid);
      }
    };

    // Background, split by how often you reach for it: the colour is a plain
    // field among the type's settings, the image (and everything that only
    // matters once one is set) is a collapsed section. Inspector-only — the
    // bulk modal renders content fields and nothing here.
    const background = contentOnly
      ? { colorGroup: null, imageSection: null }
      : buildBackgroundControls({
          h,
          slide,
          pres,
          theme,
          fieldByKey,
          renderField,
          fieldGrid,
          markDirty,
          scheduleUiRefresh,
        });

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
      // The generic branch of the router renders through this, so the bulk
      // modal and the inspector share one form loop and one reading of the
      // type's `formLayout` declarations.
      renderFieldRows,
      used,
      fieldByKey,
      renderField,
      deckSlides,
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
      onEditChartData,
    };

    if (contentOnly) {
      // Bulk modal: the full per-type content form (parity by construction).
      renderSlideFormByType(formTypeCtx);
    } else {
      // Inspector: only the per-type widgets a flat keeps-list can't express
      // (chart config, focus pickers, per-card icon/link, per-column image
      // settings); the loop below renders the remaining keeps.
      renderInspectorExtrasByType(formTypeCtx);
      // Type-agnostic: a selected text field gets a "This text" element tab
      // with block-level alignment/colour (editing-surfaces text step 3).
      if (elementActive && selectedElement?.kind === 'text') {
        renderTextElementCard({
          h,
          container: elementForm,
          slide,
          fieldKey: selectedElement.fieldKey,
          theme,
          fieldRenderers: { fieldEnum },
          markDirty,
          rerenderPreview,
          scheduleUiRefresh,
        });
      }
    }

    // Add any remaining fields not handled above. In inspector mode add()
    // gates on the keeps set, so this renders keeps in schema order and
    // routes a11y/background keys to their sections.
    // `def?.` because a stored slide can outlive its type: a removed core type
    // or a fork's type this install doesn't have resolves to nothing, and the
    // inspector has to degrade rather than take the whole editor down with it.
    renderFieldRows((def?.fields || []).filter((f) => !used.has(f.key)));

    // Rail order, settled 2026-07-26: the type's own settings lead, then the
    // background colour (a frequent one-click choice), then the two collapsed
    // sections. Accessibility now sits within a screen of the top instead of
    // below a background panel that filled the rail.
    if (background.colorGroup) form.append(background.colorGroup);
    if (background.imageSection) form.append(background.imageSection);

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
      // The collapse control goes after the tab bar so it floats over the
      // form's first row instead of over the "Slide" tab.
      if (closeSlot) editorMount.append(closeSlot);
      editorMount.append(elementForm, form);
    } else {
      if (closeSlot) editorMount.append(closeSlot);
      editorMount.append(form);
    }
  }

  return { rerender: rerenderEditor, detach: detachHeaderActions };
}
