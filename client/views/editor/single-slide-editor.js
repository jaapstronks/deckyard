/**
 * Single-slide editor: the full slide form for one slide that belongs to no
 * deck (D171).
 *
 * The form, its field renderers, the image picker seam and the undo manager
 * all work on a plain `pres` object and never ask for a saved deck, so this
 * adapter wraps one slide in a presentation that lives only in memory and
 * mounts the same machinery the deck editor uses, on the `library` surface
 * (editor-form/surfaces.js). It knows nothing about the slide library: it takes
 * content and gives content back. Saving is the caller's job.
 *
 * It never talks to `/api/presentations` - there is no deck to talk about, and
 * a hidden working deck is exactly what D171 rules out
 * (tests/single-slide-editor.test.js pins that on the source).
 */

import { createRerenderEditor } from './editor-form.js';
import { createFieldRenderers } from './fields.js';
import { createImagePickers } from './image-pickers.js';
import { readFileAsDataUrl } from './image-library-picker.js';
import { loadEditorAssets } from './bootstrap.js';
import { createUndoActions } from './slide-list/undo-actions.js';
import { createEditorStateUpdater } from '../../lib/state/editor-state.js';
import { createUndoManager } from '../../lib/state/undo-manager.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import {
  mountSlideInto,
  RENDER_VIA_THEME,
} from '../../lib/slide-runtime/slide-render.js';
import { attachThumbScaleContain } from '../../lib/slide-runtime/thumb-scale.js';
import { h } from '../../lib/dom.js';

const SLIDE_ID = 'single-slide';

/**
 * @typedef {object} SingleSlideEditor
 * @property {HTMLElement} el - toolbar, form pane and live preview
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
  const formMount = h('div', { class: 'bulk-edit-form' });
  const previewStage = h('div', { class: 'bulk-edit-preview' });
  const previewThumb = h('div', { class: 'thumb bulk-edit-thumb' });
  previewStage.append(previewThumb);
  const body = h('div', { class: 'bulk-edit-body' });
  body.append(formMount, previewStage);
  const el = h('div', { class: 'single-slide-editor' });
  el.append(toolbarEl, body);

  let previewRaf = 0;
  const rerenderPreview = () => {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      mountSlideInto(previewThumb, currentSlide(), {
        theme,
        renderVia: RENDER_VIA_THEME,
        lang: deckLang || undefined,
      });
    });
  };

  let notify = () => {};
  const undoManager = createUndoManager({ onChange: () => notify() });

  let rerenderEditor = () => {};
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

  const form = createRerenderEditor({
    surface: 'library',
    editorMount: formMount,
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
  });
  rerenderEditor = form.rerender;

  const { performUndo, performRedo } = createUndoActions({
    pres,
    undoManager,
    getSelectedSlideId: () => SLIDE_ID,
    markDirty,
    editorState,
    // The caller renders labelled Undo/Redo buttons; the form shows the rest.
    announce: false,
  });

  rerenderEditor();
  rerenderPreview();
  // The first render folds legacy content into its canonical shape (the
  // type's normalize step, the background migration). That is not an edit, so
  // the baseline for "dirty" and for undo is taken after it.
  const baseline = JSON.stringify(currentSlide().content);
  undoManager.init(pres);
  notify = () => onChange?.();

  const detachScale = attachThumbScaleContain(previewThumb, {
    containerEl: previewStage,
    padding: 16,
  });

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
      if (previewRaf) cancelAnimationFrame(previewRaf);
      previewRaf = 0;
      detachScale();
      form.detach();
      undoManager.clear();
    },
  };
}
