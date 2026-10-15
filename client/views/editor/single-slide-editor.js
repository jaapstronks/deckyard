/**
 * Single-slide editor: the Fields form for one slide that belongs to no deck
 * (D171, B703).
 *
 * The form, its field renderers, the image picker seam and the undo manager
 * all work on a plain `pres` object and never ask for a saved deck, so this
 * adapter wraps one slide in a presentation that lives only in memory and
 * mounts the Fields form the deck editor shows in its canvas column, in its
 * `library` context (fields-view.js): no canvas and no inspector stand beside
 * it here, so the form carries the slide's settings too. It knows nothing
 * about the slide library: it takes content and gives content back. Saving is
 * the caller's job.
 *
 * It never talks to `/api/presentations` - there is no deck to talk about, and
 * a hidden working deck is exactly what D171 rules out
 * (tests/single-slide-editor.test.js pins that on the source).
 */

import { createRerenderEditor } from './editor-form/index.js';
import { createFieldsView } from './fields-view.js';
import { openChartDataModal } from './chart-data-modal.js';
import { createFieldRenderers } from './fields/index.js';
import { createImagePickers } from './image-pickers.js';
import { readFileAsDataUrl } from '../../lib/net/file.js';
import { loadEditorAssets } from './bootstrap.js';
import { createUndoActions } from './slide-list/undo-actions.js';
import { createEditorStateUpdater } from '../../lib/state/editor-state.js';
import { createUndoManager } from '../../lib/state/undo-manager.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import { RENDER_VIA_THEME } from '../../lib/slide-runtime/slide-render.js';
import { h } from '../../lib/dom/index.js';

const SLIDE_ID = 'single-slide';

/**
 * @typedef {object} SingleSlideEditor
 * @property {HTMLElement} el - toolbar and the Fields form with its live
 *   preview
 * @property {() => object} getContent - a copy of the current content
 * @property {() => boolean} isDirty - whether the content differs from the start
 * @property {() => boolean} undo
 * @property {() => boolean} redo
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => void} detach
 */

/**
 * Mount the slide form for one deckless slide.
 *
 * @param {object} opts
 * @param {string} opts.slideType
 * @param {object} opts.content - the slide content; cloned, never mutated
 * @param {string} [opts.lang] - the language the content is written in
 * @param {string} [opts.themeId] - theme to render and resolve locks against
 * @param {Function} opts.api - API client
 * @param {object} [opts.user]
 * @param {object} [opts.features]
 * @param {object} opts.SLIDE_TYPES - slide-type meta (as the editor loads it)
 * @param {() => void} [opts.onChange] - after every edit, undo and redo
 * @returns {Promise<SingleSlideEditor>}
 */
export async function createSingleSlideEditor({
  slideType,
  content,
  lang,
  themeId,
  api,
  user,
  features,
  SLIDE_TYPES,
  onChange,
} = {}) {
  const [theme, { PARTNER_LOGOS, BACKGROUNDS }, { openImagePicker }] =
    await Promise.all([
      loadThemeById(themeId),
      loadEditorAssets({ api }),
      createImagePickers({ root: document.body, user, api, features }),
    ]);

  const deckLang = normalizeLang(lang) || '';
  // The one presentation this editor holds. It exists only here: `id` is
  // empty, so nothing downstream can mistake it for a stored deck, and
  // `versions` is empty, so the form shows no translation hints.
  const pres = {
    id: '',
    title: '',
    theme: themeId || '',
    lang: deckLang,
    settings: {},
    i18n: { active: deckLang, dominant: deckLang, versions: {} },
    slides: [
      {
        id: SLIDE_ID,
        type: slideType,
        content: structuredClone(content || {}),
      },
    ],
  };
  const currentSlide = () => pres.slides[0];

  const toolbarEl = h('div', { class: 'row single-slide-editor-toolbar' });
  const el = h('div', { class: 'single-slide-editor' });

  let notify = () => {};
  const undoManager = createUndoManager({ onChange: () => notify() });

  // Both late-bound: the Fields view below owns the preview and the form.
  let rerenderEditor = () => {};
  let refreshPreview = () => {};
  const rerenderPreview = () => refreshPreview();
  const markDirty = () => {
    undoManager.captureSnapshot(pres, { slideId: SLIDE_ID });
    notify();
  };
  const editorState = createEditorStateUpdater({
    markDirty,
    rerenderEditor: () => rerenderEditor(),
    rerenderPreview,
  });

  const fieldRenderers = createFieldRenderers({
    api,
    user,
    features,
    BACKGROUNDS,
    theme,
    pres,
    normalizeLang,
    openImagePicker,
    readFileAsDataUrl,
    markDirty,
    scheduleUiRefresh: rerenderPreview,
    rerenderEditor: () => rerenderEditor(),
  });

  let form = null;
  const fieldsView = createFieldsView({
    context: 'library',
    pres,
    getSelectedSlideId: () => SLIDE_ID,
    getTheme: () => theme,
    renderVia: RENDER_VIA_THEME,
    createFormRenderer: (formMount, { surface, onRendered }) => {
      form = createRerenderEditor({
        surface,
        editorMount: formMount,
        onRendered,
        pres,
        SLIDE_TYPES,
        api,
        getSelectedSlideId: () => SLIDE_ID,
        editorState,
        markDirty,
        rerenderPreview,
        scheduleUiRefresh: rerenderPreview,
        PARTNER_LOGOS,
        fieldRenderers,
        theme,
        user,
        features,
        slideToolbar: { leftEl: toolbarEl },
        // The one data editor (D338), live; the session is one undo step.
        onEditChartData: (fieldKey) =>
          openChartDataModal({
            root: document.body,
            slide: currentSlide(),
            fieldKey,
            theme,
            renderVia: RENDER_VIA_THEME,
            lang: deckLang || null,
            markDirty,
            rerenderPreview,
            undoGroup: {
              begin: () => undoManager.beginGroup(pres),
              end: () => undoManager.endGroup(pres),
            },
            onClosed: () => rerenderEditor(),
          }),
      });
      return form.rerender;
    },
  });
  refreshPreview = fieldsView.refreshPreview;
  // Undo, redo and a structural edit rebuild the form even while a field in
  // it has focus: there is no second surface whose edit it would catch up on.
  rerenderEditor = () => {
    form.rerender();
    refreshPreview();
  };
  el.append(toolbarEl, fieldsView.el);

  const { performUndo, performRedo } = createUndoActions({
    pres,
    undoManager,
    getSelectedSlideId: () => SLIDE_ID,
    markDirty,
    editorState,
    // The caller renders labelled Undo/Redo buttons; the form shows the rest.
    announce: false,
  });

  // Showing renders the form and the preview. The first render folds legacy
  // content into its canonical shape (the type's normalize step, the
  // background migration). That is not an edit, so the baseline for "dirty"
  // and for undo is taken after it.
  fieldsView.show();
  const baseline = JSON.stringify(currentSlide().content);
  undoManager.init(pres);
  notify = () => onChange?.();

  return {
    el,
    getContent: () => structuredClone(currentSlide().content),
    isDirty: () => JSON.stringify(currentSlide().content) !== baseline,
    undo: performUndo,
    redo: performRedo,
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    detach() {
      notify = () => {};
      fieldsView.detach();
      form.detach();
      undoManager.clear();
    },
  };
}
