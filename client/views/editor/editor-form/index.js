import { createRenderField } from './render-field.js';
import { renderSlideFormByType } from './slide-form-router.js';
import { buildDeckSlideOptions } from '../fields/card-link-field.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast as defaultToast } from '../../../lib/dom/toast.js';
import { isOrgDisabledSlideType } from '../../../../shared/slide-types/policy.js';
import { needsNativeComposition } from '../../../../shared/slide-types/fidelity.js';
import { buildDataSourceIndicator } from '../data-source-panel.js';
import { icon } from '../../../lib/dom/icons.js';
import { buildTypeMenu } from './type-menu.js';
import { createLayoutRow } from '../layout-switcher.js';
import {
  getInspectorKeepKeys,
  renderInspectorExtrasByType,
} from './inspector-form.js';
import { renderTextElementCard } from './text-element-card.js';
import { fieldFormRows } from '../../../../shared/slide-types/form-layout.js';
import { normalizeSlideContent } from '../../../../shared/slide-types/normalize-content.js';
import {
  describeUnresolvedType,
  unresolvedNotes,
} from '../../../../shared/slide-types/unresolved.js';
import { elementAppliesToSlide, elementTabLabel } from './element-tab.js';
import {
  buildBackgroundControls,
  isBackgroundFieldKey,
} from './background-section.js';
import { buildSlideDurationControl } from './slide-duration.js';
import {
  buildAiReasoningPanel,
  buildAiWarningsPanel,
} from './ai-slide-notes.js';
import { buildAiIteratePanel } from './ai-iterate-panel.js';
import { h } from '../../../lib/dom/index.js';
import { surfaceCapabilities } from './surfaces.js';
import { isSettingsField } from '../../../../shared/slide-types/settings-fields.js';
import { featureEnabled } from '../../../lib/state/features.js';

export function createRerenderEditor({
  editorMount,
  pres,
  SLIDE_TYPES,
  api,
  toast = defaultToast,
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
  disabledSlideTypes,
  features,
  setInspectorCollapsed,
  // Mount point in the canvas header for the slide-scoped toolbar
  // ({ leftEl }); absent on surfaces without a toolbar mount and in tests.
  slideToolbar,
  // Which surface this form renders on: a name from the declared table in
  // editor-form/surfaces.js ('inspector' | 'bulk' | 'library'). Every part of
  // the form that is not on every surface reads one capability from that row;
  // nothing here branches on the name. All surfaces share the exact same
  // field renderers, so no surface can drift from what the form can edit.
  // Required: a caller that names no surface throws, like an unknown name.
  surface,
  // Selection-aware inspector: () => {kind:'image'|'card'|'text', idx,
  // fieldKey} | null. When an
  // element is selected the inspector grows a [This element | Slide] tab bar.
  getSelectedElement,
  saveRefusal,
  // (fieldKey) => opens the chart-data editor for the selected slide
  // (editing-surfaces §4.3, D338). Every surface passes it: the form shows
  // only a data summary with this entry point.
  onEditChartData,
  // Called after every render, the form's own included (a structural edit
  // rerenders from inside). The Fields view uses it to place the title in
  // its slide head.
  onRendered = null,
} = {}) {
  const caps = surfaceCapabilities(surface);
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
    openImagePicker,
  } = fieldRenderers || {};

  // Track detachers for cleanup between re-renders. The type pill's menu
  // installs document-level pointerdown/keydown handlers, so the *last*
  // render's pair needs detaching on unmount too, not just the previous one
  // on each rerender — hence the `detach` on the returned API.
  let typeMenuDetach = null;
  const detachTypeMenu = () => {
    if (!typeMenuDetach) return;
    try {
      typeMenuDetach();
    } catch {
      /* ignore */
    }
    typeMenuDetach = null;
  };

  // Which inspector tab is active while an element is selected. A newly
  // selected element resets to its own tab; clicking "Slide" persists across
  // rerenders (so editing a slide-wide field doesn't yank you back).
  let activeElementTab = true;
  let lastElementKey = null;

  function rerenderEditor() {
    // Clean up previous dropdown listeners
    detachTypeMenu();

    editorMount.replaceChildren();
    const slide = pres.slides.find((s) => s.id === getSelectedSlideId?.());
    if (!slide) return;

    /** @type {HTMLElement|null} The floating collapse control, appended last. */
    let closeSlot = null;

    // Pane chrome (chrome re-org 2026-07-16). The type pill renders into the
    // slide toolbar above the canvas; the slide actions live in the slide
    // list (B703 PR 3).
    if (caps.headerActions) {
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
        closeBtn.append(icon('x', { size: 16 }));
        closeSlot.append(closeBtn);
      }
    }

    if (caps.toolbar) {
      // Slide toolbar above the canvas: the type pill (a menu on the deck
      // editor: Convert, AI Convert, View JSON) and its badges. Rebuilt per
      // slide; the Canvas | Fields tabs beside it are the controller's.
      const tbLeft = slideToolbar?.leftEl || null;
      if (tbLeft) {
        tbLeft.replaceChildren();
        if (caps.headerActions) {
          const typeMenu = buildTypeMenu({
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
          });
          typeMenuDetach = typeMenu.detach;
          tbLeft.append(typeMenu.el);
        } else {
          tbLeft.append(
            h('div', {
              class: 'pill',
              text: t(
                SLIDE_TYPES[slide.type]?.labelKey ||
                  `slideType.${slide.type}.label`,
                SLIDE_TYPES[slide.type]?.label || slide.type,
              ),
            }),
          );
        }

        // Show retired badge if slide type is org-disabled
        if (isOrgDisabledSlideType(slide.type, disabledSlideTypes)) {
          tbLeft.append(
            h('span', {
              class: 'slide-type-retired-badge',
              text: t('editor.slide.retiredType', 'Retired type'),
              title: t(
                'editor.slide.retiredType.title',
                'This slide type is no longer available for new slides.',
              ),
            }),
          );
        }

        // Show custom type badge
        const slideDef = SLIDE_TYPES[slide.type];
        if (slideDef?.isCustom || slide.type.startsWith('custom-')) {
          const badgeText = t('editor.slide.customType', 'Custom type');
          const badgeTitle = slideDef?.baseType
            ? t('editor.slide.customType.basedOn', 'Based on: {base}', {
                base: slideDef.baseType,
              })
            : '';
          tbLeft.append(
            h('span', {
              class: 'slide-type-custom-badge',
              text: badgeText,
              title: badgeTitle || badgeText,
            }),
          );
        }
      }
    }

    // Data source indicator (shown for bindable slide types when live data is enabled)
    if (caps.deckTools) {
      const dsBar = buildDataSourceIndicator({
        slide,
        api,
        markDirty,
        editorState,
        features,
      });
      if (dsBar) editorMount.append(dsBar);
    }

    // Per-slide duration input (shown only when auto-advance is enabled)
    const durationWrap = buildSlideDurationControl({
      pres,
      slide,
      surface,
      markDirty,
      requestSave,
    });
    if (durationWrap) editorMount.append(durationWrap);

    // Build form
    const def = SLIDE_TYPES[slide.type];
    // The type's own legacy-to-canonical fold, once per render and before any
    // widget reads content (shared/slide-types/normalize-content.js). Used to
    // happen inside the per-type forms, which tied the migration's survival to
    // the form's; both surfaces now get canonical values whatever renders.
    normalizeSlideContent(slide.type, def, slide.content);
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
        }),
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
    const selectedElement = caps.elementTabs
      ? getSelectedElement?.() || null
      : null;
    const elementActive = elementAppliesToSlide(slide, selectedElement, {
      slideTypes: SLIDE_TYPES,
    });
    const elemKey = elementActive
      ? `${selectedElement.kind}:${selectedElement.idx}`
      : null;
    if (elemKey !== lastElementKey) {
      // A fresh selection (or a deselect) resets to the element's own tab.
      activeElementTab = true;
      lastElementKey = elemKey;
    }
    const elementForm = h('div', {
      class: 'stack editor-form editor-element-form',
    });

    // Layout: the form's first row (B703 PR 3, D335), only for a type that
    // declares layout variants (type-agnostic; forks that override a type
    // control their own set).
    if (caps.layout) {
      const layoutRow = createLayoutRow({
        slide,
        pres,
        SLIDE_TYPES,
        editorState,
        typeConversion: caps.typeConversion,
      });
      if (layoutRow) form.append(layoutRow);
    }

    // AI reasoning panel (shown for AI-generated slides)
    if (caps.deckTools) {
      const aiReasoning = buildAiReasoningPanel({ slide });
      if (aiReasoning) form.append(aiReasoning);
    }

    // AI warnings panel (shown when validation found issues)
    if (caps.deckTools) {
      const aiWarnings = buildAiWarningsPanel({ slide });
      if (aiWarnings) form.append(aiWarnings);
    }

    // AI Iterate panel (slide-level AI refinement). Built here, appended at
    // the very end of the form: the inspector is a settings pane first, and
    // the refine box is a tool, not a setting. It exists only where AI does:
    // with AI off every submit would fail on /api/ai/iterate (D179).
    const aiIteratePanel =
      caps.deckTools && featureEnabled('ai')
        ? buildAiIteratePanel({
            api,
            pres,
            slide,
            getSelectedSlideId,
            setSelectedSlideId,
            editorState,
            toast,
            // "Fill slide…" (translate from the source version) sits with
            // the other AI tool on the slide (B703 PR 3).
            onFillSlide: onTranslateSlide
              ? () => onTranslateSlide({ slideId: slide.id })
              : null,
          })
        : null;

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
      Boolean(String(slide?.content?.[f] || '').trim()),
    );
    const a11yState = hasA11yValue
      ? 'custom'
      : hasHeading
        ? 'auto'
        : 'no-heading';
    const a11yDetails = h('details', {
      class: 'editor-advanced editor-a11y-section',
    });
    if (hasA11yValue) a11yDetails.open = true;
    const a11yStatusText = {
      custom: t(
        'editor.slide.accessibility.status.custom',
        'custom description',
      ),
      auto: t(
        'editor.slide.accessibility.status.auto',
        'auto (from the heading)',
      ),
      'no-heading': t(
        'editor.slide.accessibility.status.noHeading',
        'no heading — add a title',
      ),
    }[a11yState];
    const a11ySummary = h('summary', {
      class: 'editor-advanced-summary',
      title: t(
        'editor.slide.accessibility.title',
        'Optional fields to improve screen-reader output and exports.',
      ),
    });
    a11ySummary.append(
      h('span', { text: t('editor.slide.accessibility', 'Accessibility') }),
      h('span', {
        class: `editor-a11y-status is-${a11yState}`,
        text: a11yStatusText,
      }),
    );
    const a11yBody = h('div', { class: 'editor-advanced-body' });
    a11yDetails.append(a11ySummary, a11yBody);

    // `fields: 'keeps'` (the inspector): the pane renders ONLY settings/design
    // fields (the audit's "Inspector keeps"). Content lives on the slide
    // (wysiwyg) and - all of it, by construction - on the Fields form
    // (`fields: 'content'`) and the library editor (`fields: 'all'`).
    const inspectorKeeps =
      caps.fields === 'keeps' ? getInspectorKeepKeys(slide.type, def) : null;
    // `fields: 'content'` (the Fields form): no setting renders, at any
    // level; the inspector beside it is their one home (D335).
    const omitSettings = caps.fields === 'content';

    // Deck slides (minus the current one) for in-deck card-link pickers, in
    // both the per-type forms and the generic collection editor.
    const deckSlides = buildDeckSlideOptions(pres, slide?.id);

    const renderField = createRenderField({
      saveRefusal,
      pres,
      getSelectedSlideId,
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
        openImagePicker,
      },
      markDirty,
      rerenderEditor,
      scheduleUiRefresh,
      updateSelectedSlideListItem,
      onTranslateField,
      // The csv-grid widget is a summary plus an "Edit data…" entry point into
      // the host's data editor (D338); every surface passes one.
      onEditData: onEditChartData,
      omitSettings,
    });

    const isA11yFieldKey = (key) =>
      key === 'a11yTitle' || key === 'a11ySummary';

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
      // Hidden fields are carried data, not editor surface.
      if (f.hidden) {
        used.add(key);
        return;
      }
      // Slide-wide background fields have their own surfaces (colour group +
      // image section), built below.
      if (isBackgroundFieldKey(key)) {
        used.add(key);
        return;
      }
      // A surface without the Accessibility section renders a11y keys nowhere.
      if (!caps.a11y && isA11yFieldKey(key)) {
        used.add(key);
        return;
      }
      // Fields form: a setting never renders here, not even when a save was
      // refused on it - the inspector beside the form shows that refusal.
      if (omitSettings && isSettingsField(f)) {
        used.add(key);
        return;
      }
      // Inspector mode: content fields don't render here (their homes are the
      // slide surface and the Fields form); only the per-type keeps pass.
      if (
        inspectorKeeps &&
        !isA11yFieldKey(key) &&
        !inspectorKeeps.has(key) &&
        !saveRefusal?.matches(slide, f)
      ) {
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
     * The single generic form loop, shared by the Fields form (via
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
    // matters once one is set) is a collapsed section.
    const background = caps.background
      ? buildBackgroundControls({
          slide,
          def,
          pres,
          theme,
          fieldByKey,
          renderField,
          fieldGrid,
          markDirty,
          scheduleUiRefresh,
        })
      : { colorGroup: null, imageSection: null };

    const formTypeCtx = {
      form,
      // The deck, for forms that need the active language version rather than
      // anything stored on the slide (follow-invite's copy labels).
      pres,
      getSelectedSlideId,
      // Selection-aware inspector: element-scoped widgets render into
      // elementForm for the selected element; slide-wide stays in form.
      elementForm,
      selectedElement: elementActive ? selectedElement : null,
      slide,
      def,
      add,
      // The generic branch of the router renders through this, so the Fields
      // form and the inspector share one form loop and one reading of the
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
        openImagePicker,
      },
      markDirty,
      rerenderEditor,
      rerenderSlideList,
      rerenderPreview,
      scheduleUiRefresh,
      onEditChartData,
      // A per-type form (follow-invite) leaves its settings out on the
      // content-only surface, like add() does for schema fields.
      omitSettings,
    };

    if (caps.fields !== 'keeps') {
      // The full per-type form (parity by construction); `add()` drops the
      // settings on the content-only surface.
      renderSlideFormByType(formTypeCtx);
    } else {
      // Inspector: the shared image element card for any type declaring an
      // `image` element tab, plus the INSPECTOR_EXTRAS exceptions; the loop
      // below renders the remaining keeps.
      renderInspectorExtrasByType(formTypeCtx);
      // Type-agnostic: a selected text field gets a "This text" element tab
      // with the style controls its type offers, or a sentence when it offers
      // none (B464). Text clicked inside a card carries its field on the card
      // selection, so the card tab ends with the same controls (D313).
      if (
        elementActive &&
        (selectedElement?.kind === 'text' ||
          (selectedElement?.kind === 'card' && selectedElement.fieldKey))
      ) {
        renderTextElementCard({
          container: elementForm,
          slide,
          fieldKey: selectedElement.fieldKey,
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
    if (caps.a11y && a11yBody.childNodes?.length) form.append(a11yDetails);

    // What the editable PowerPoint does with this slide, read from the type's
    // `fidelity` facet on the slide-types response, never from its name: a
    // type the export photographs says so here, before the user finds out in
    // PowerPoint (D141). Deck-scoped, like the export itself.
    if (caps.deckTools && def && !needsNativeComposition(def, 'pptx')) {
      form.append(
        h('p', {
          class: 'help editor-export-hint',
          text: t(
            'editor.slide.exportsAsImage',
            'In the editable PowerPoint, this slide is an image.',
          ),
        }),
      );
    }

    // AI refine box last: tooling under the settings.
    if (aiIteratePanel) form.append(aiIteratePanel);

    // Selection-aware inspector: with an element selected and its element form
    // populated, show a [This element | Slide] tab bar over the two panels;
    // otherwise the pane is just the slide form (identical to pre-tab behavior).
    if (caps.elementTabs && elementActive && elementForm.childNodes.length) {
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
        mkTab(
          elementTabLabel(selectedElement, { slide, slideTypes: SLIDE_TYPES }),
          true,
        ),
        mkTab(t('editor.inspector.tab.slide', 'Slide'), false),
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
    // Before the refusal reveal: a host that moves a field (the Fields head
    // lifts the title) must do so before anything takes focus in it.
    onRendered?.();
    saveRefusal?.reveal();
  }

  return { rerender: rerenderEditor, detach: detachTypeMenu };
}
