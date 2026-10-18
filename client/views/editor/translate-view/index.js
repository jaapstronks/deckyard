/**
 * The translation view (B763, D226): the whole deck as two columns of text,
 * source | target per field, both editable. Full-screen above the editor
 * rather than a canvas tab: two columns need the width the inspector takes,
 * and translating is a task over the deck, not a stance on one slide.
 *
 * Every write, in either column, goes through the editor's one seam for text
 * in a given language (`writeVersionText`, B762). Around it this view keeps
 * the five rules the B762 review set (brief § Reviewbeslissingen B762):
 *
 * 1. The lock asked is the lock of the slide being written, before every
 *    write, in both columns; a write into the active language selects that
 *    slide through the lock-aware seam first, so the lock it takes is the
 *    right one. The deck title is no slide edit and asks no slide lock.
 * 2. A refused write leaves no optimistic text: the field goes back to what
 *    is stored and says why.
 * 3. One signal (`subscribe`) tells the view a language buffer, the write
 *    readiness or a lock changed; rows without focus follow it, the focused
 *    field keeps its value and caret. Closing drops the subscription.
 * 4. Before the live document is ready both columns are inert and say so.
 * 5. Whether a target slide exists is matched on id (model.js).
 *
 * Navigation through the deck (an index, the keyboard, opening on the
 * selected slide) is B764; machine proposals are B478.
 */
import { h } from '../../../lib/dom/index.js';
import { icon } from '../../../lib/dom/icons.js';
import { createModal } from '../../../lib/dom/modal.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { labeledCheckbox } from '../../../lib/dom/labeled-checkbox.js';
import { t } from '../../../lib/ui-i18n.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { fieldLabel, fieldMetaForPath } from '../inline-edit/field-path.js';
import { slideTypeLabel } from '../convert-slide-action.js';
import {
  defaultLanguagePair,
  isEmptyTarget,
  onlyEmptyTargets,
  translateViewModel,
} from './model.js';

const MULTILINE_TYPES = new Set(['markdown', 'csv']);

/** A stable address for one text: language, slide (null = deck), path. */
const addressKey = (lang, slideId, path) =>
  JSON.stringify([lang, slideId || null, path]);

/** The row's own key, independent of the language pair. */
const rowKey = (slideId, path) => JSON.stringify([slideId || null, path]);

/**
 * "Cards 2 · Title" for `['items', 1, 'title']`: each items level names its
 * list and the item's number, the last segment the field.
 * @param {Object} def - the slide type definition
 * @param {Array<string|number>} path
 * @returns {string}
 */
function rowLabel(def, path) {
  const parts = [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    const listPath = path.slice(0, i + 1).join('.');
    const meta = fieldMetaForPath(def, listPath);
    parts.push(
      `${fieldLabel(String(path[i]), meta)} ${Number(path[i + 1]) + 1}`,
    );
  }
  const leaf = path[path.length - 1];
  parts.push(fieldLabel(String(leaf), fieldMetaForPath(def, path.join('.'))));
  return parts.join(' · ');
}

/**
 * Whether a field is edited in a textarea: the type says so (markdown, csv),
 * and a field no type declares takes one as soon as it holds a line break.
 */
function isMultiline(meta, ...values) {
  if (MULTILINE_TYPES.has(meta?.type)) return true;
  if (meta?.type === 'string') return false;
  return values.some((v) => typeof v === 'string' && v.includes('\n'));
}

/**
 * Open the translation view over the editor.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.root - where the modal mounts
 * @param {Object} opts.pres - the editor's live presentation (read live)
 * @param {Object} opts.slideTypes - slide-type registry
 * @param {Function} opts.normalizeLang
 * @param {(lang: string, slideId: string|null, path: Array<string|number>,
 *   value: string) => boolean} opts.write - the editor's writeVersionText
 * @param {() => boolean} opts.canWrite - false until the live document is
 *   ready (collab); always true without collab
 * @param {(fn: Function) => Function} opts.subscribe - the change signal;
 *   returns the unsubscribe
 * @param {(slideId: string) => ('author'|'other'|null)} opts.getSlideLockKind
 * @param {() => boolean} opts.isReadOnly - the deck is read-only right now
 * @param {() => string|null} opts.getSelectedSlideId
 * @param {(slideId: string) => void} opts.selectSlide - the lock-aware
 *   selection seam
 * @param {{undo: Function, redo: Function, canUndo: Function,
 *   canRedo: Function}} [opts.history] - the editor's undo/redo
 * @param {Function} [opts.onClosed]
 * @returns {{close: Function, sync: Function}}
 */
export function openTranslateView({
  root,
  pres,
  slideTypes,
  normalizeLang,
  write,
  canWrite,
  subscribe,
  getSlideLockKind,
  isReadOnly,
  getSelectedSlideId,
  selectSlide,
  history,
  onClosed,
} = {}) {
  const activeLang = () => normalizeLang(pres?.i18n?.active);
  const pair = defaultLanguagePair(pres, activeLang());
  const state = {
    source: pair?.source || null,
    target: pair?.target || null,
    filter: false,
  };
  /** Row keys the filter keeps, frozen while typing (see `freezeFilter`). */
  let filterKeep = null;
  /** addressKey → { el, slideId, path, lang, stored, error } */
  let controls = new Map();
  let renderedShape = '';
  let unsubscribe = null;

  // ── chrome ───────────────────────────────────────────────────────────────

  const modal = createModal({
    title: t('editor.translateView.title', 'Translate'),
    hint: t(
      'editor.translateView.hint',
      'Every text of the deck in two languages, side by side. Changes are saved as you type.',
    ),
    modalClass: 'translate-view-modal',
    fill: true,
    closeButton: 'icon',
    onClose: () => {
      unsubscribe?.();
      unsubscribe = null;
      controls = new Map();
      onClosed?.();
    },
  });

  const pairEl = h('div', { class: 'translate-view-pair' });
  const filterBox = labeledCheckbox({
    text: t('editor.translateView.onlyEmpty', 'Only empty fields'),
    className: 'translate-view-filter',
    onChange: (on) => {
      state.filter = on;
      filterKeep = null;
      render();
    },
  });
  const undoBtn = history
    ? h(
        'button',
        {
          class: 'ghost-icon-btn',
          type: 'button',
          title: t('editor.undo', 'Undo'),
          'aria-label': t('editor.undo', 'Undo'),
          onclick: () => {
            history.undo();
            sync();
          },
        },
        [icon('undo', { size: 16 })],
      )
    : null;
  const redoBtn = history
    ? h(
        'button',
        {
          class: 'ghost-icon-btn',
          type: 'button',
          title: t('editor.redo', 'Redo'),
          'aria-label': t('editor.redo', 'Redo'),
          onclick: () => {
            history.redo();
            sync();
          },
        },
        [icon('redo', { size: 16 })],
      )
    : null;
  const statusEl = h('div', {
    class: 'translate-view-status help',
    role: 'status',
    hidden: true,
  });
  const toolbar = h('div', { class: 'translate-view-toolbar' }, [
    pairEl,
    filterBox.el,
    h('div', { class: 'translate-view-history' }, [undoBtn, redoBtn]),
  ]);
  const body = h('div', { class: 'translate-view-body' });
  modal.append(
    h('div', { class: 'translate-view-frame' }, [toolbar, statusEl, body]),
  );

  // ── language pair ────────────────────────────────────────────────────────

  const langOptions = () =>
    defaultLanguagePair(pres, activeLang())?.langs || [];

  const setPair = (source, target) => {
    state.source = source;
    state.target = target;
    filterKeep = null;
    renderPair();
    render();
  };

  const langSelect = (value, label, onPick) => {
    const select = h(
      'select',
      { class: 'translate-view-lang', 'aria-label': label },
      langOptions().map((l) =>
        h('option', { value: l, text: getLangDisplayName(l) }),
      ),
    );
    select.value = value;
    select.addEventListener('change', () => onPick(select.value));
    return select;
  };

  function renderPair() {
    const langs = langOptions();
    const swap = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.translateView.swap', 'Swap'),
      title: t('editor.translateView.swapTitle', 'Swap source and target'),
      onclick: () => setPair(state.target, state.source),
    });
    // Two languages need no choice beyond the direction; more get a choice
    // per column (D226 point 5).
    const side = (lang, label, onPick) =>
      langs.length > 2
        ? langSelect(lang, label, onPick)
        : h('span', {
            class: 'translate-view-lang-name',
            text: getLangDisplayName(lang),
          });
    pairEl.replaceChildren(
      side(state.source, t('editor.translateView.sourceLang', 'From'), (l) =>
        setPair(l, l === state.target ? state.source : state.target),
      ),
      h('span', { class: 'translate-view-arrow', 'aria-hidden': 'true' }, [
        icon('arrow-right', { size: 14 }),
      ]),
      side(state.target, t('editor.translateView.targetLang', 'To'), (l) =>
        setPair(l === state.source ? state.target : state.source, l),
      ),
      swap,
    );
  }

  // ── state that decides whether a field can be written ────────────────────

  /** Why the whole view is inert, or null. */
  const inertReason = () => {
    if (isReadOnly?.())
      return t(
        'editor.translateView.readOnly',
        'This deck is read-only right now, so nothing can be changed here.',
      );
    if (!canWrite?.())
      return t(
        'editor.translateView.connecting',
        'Connecting to the live document. You can edit as soon as it has loaded.',
      );
    return null;
  };

  const lockMessage = (kind) =>
    kind === 'author'
      ? t('editor.authorLocked.banner', 'This slide is locked by the author')
      : t(
          'editor.translateView.lockedByOther',
          'Someone else is editing this slide.',
        );

  const lockOf = (slideId) => (slideId ? getSlideLockKind?.(slideId) : null);

  // ── writing ──────────────────────────────────────────────────────────────

  const showRefusal = (entry, message) => {
    entry.el.value = entry.stored;
    if (!entry.error) {
      entry.error = createInlineError();
      entry.el.closest('.translate-view-cell')?.append(entry.error.el);
    }
    entry.error.show(message, { control: entry.el, focus: false });
  };

  const onInput = (entry) => {
    const inert = inertReason();
    if (inert) return showRefusal(entry, inert);
    const lock = lockOf(entry.slideId);
    if (lock) return showRefusal(entry, lockMessage(lock));
    // A write into the active language is an edit of that slide: select it
    // first, so the lock the edit takes is this slide's (review rule 1).
    if (
      entry.slideId &&
      entry.lang === activeLang() &&
      getSelectedSlideId?.() !== entry.slideId
    )
      selectSlide?.(entry.slideId);
    const value = entry.el.value;
    if (!write(entry.lang, entry.slideId, entry.path, value))
      return showRefusal(
        entry,
        entry.slideId && lockOf(entry.slideId)
          ? lockMessage(lockOf(entry.slideId))
          : t(
              'editor.translateView.writeRefused',
              'This change could not be saved. The field shows what is stored.',
            ),
      );
    entry.stored = value;
    entry.error?.clear();
    syncHistory();
    return undefined;
  };

  // ── rendering ────────────────────────────────────────────────────────────

  const currentModel = () =>
    translateViewModel({
      pres,
      source: state.source,
      target: state.target,
      activeLang: activeLang(),
      slideTypes,
    });

  /**
   * Which rows the filter shows. Computed when the filter or the pair
   * changes, then kept while you type: filling an empty field must not make
   * it vanish under the caret. A structural change adds the rows that are
   * empty now and keeps the ones already shown.
   */
  const freezeFilter = (model) => {
    const keep = new Set(filterKeep || []);
    const filtered = onlyEmptyTargets(model);
    if (filtered.deck) keep.add(rowKey(null, filtered.deck.path));
    for (const s of filtered.slides) {
      keep.add(`slide:${s.slideId}`);
      for (const r of s.rows) keep.add(rowKey(s.slideId, r.path));
    }
    filterKeep = keep;
  };

  /** The model as shown: the whole deck, or the frozen filter on top of it. */
  const visibleModel = (model) => {
    if (!state.filter) return model;
    if (!filterKeep) freezeFilter(model);
    const keepRow = (slideId, r) => filterKeep.has(rowKey(slideId, r.path));
    return {
      deck: model.deck && keepRow(null, model.deck) ? model.deck : null,
      slides: model.slides
        .filter((s) => filterKeep.has(`slide:${s.slideId}`))
        .map((s) => ({
          ...s,
          rows: s.rows.filter((r) => keepRow(s.slideId, r)),
        })),
    };
  };

  /** Everything a re-render would change apart from the text values. */
  const shapeOf = (model) =>
    JSON.stringify([
      state.source,
      state.target,
      model.deck?.path || null,
      model.slides.map((s) => [
        s.slideId,
        s.type,
        s.only,
        s.rows.map((r) => r.path),
      ]),
    ]);

  const createControl = ({ lang, slideId, path, value, meta, otherValue }) => {
    const multiline = isMultiline(meta, value, otherValue);
    const el = multiline
      ? h('textarea', {
          class: 'translate-view-input',
          rows: '2',
          lang,
          'aria-label': '',
        })
      : h('input', { class: 'translate-view-input', type: 'text', lang });
    el.value = value;
    const entry = { el, lang, slideId, path, stored: value, error: null };
    el.addEventListener('input', () => onInput(entry));
    controls.set(addressKey(lang, slideId, path), entry);
    return entry;
  };

  const fieldRow = ({ slideId, path, label, meta, source, target }) => {
    const src = createControl({
      lang: state.source,
      slideId,
      path,
      value: source,
      meta,
      otherValue: target,
    });
    const tgt = createControl({
      lang: state.target,
      slideId,
      path,
      value: target,
      meta,
      otherValue: source,
    });
    const labelEl = h('div', { class: 'translate-view-label', text: label });
    const srcName = getLangDisplayName(state.source);
    const tgtName = getLangDisplayName(state.target);
    src.el.setAttribute('aria-label', `${label} (${srcName})`);
    tgt.el.setAttribute('aria-label', `${label} (${tgtName})`);
    const row = h(
      'div',
      {
        class: `translate-view-row${isEmptyTarget({ source, target }) ? ' is-empty-target' : ''}`,
      },
      [
        labelEl,
        h('div', { class: 'translate-view-cell' }, [src.el]),
        h('div', { class: 'translate-view-cell' }, [tgt.el]),
      ],
    );
    return row;
  };

  const slideSection = (s) => {
    const def = slideTypes?.[s.type];
    const number = s.index == null ? '' : `${s.index + 1} · `;
    const heading = h('h3', {
      class: 'translate-view-slide-title',
      text: `${number}${slideTypeLabel(s.type, slideTypes)}`,
    });
    const children = [heading];
    if (s.only) {
      const lang = s.only === 'source' ? state.source : state.target;
      children.push(
        h('div', {
          class: 'empty-note translate-view-only',
          text: t(
            'editor.translateView.onlyIn',
            'Only in {lang}: this slide is not in the other version.',
            { lang: getLangDisplayName(lang) },
          ),
        }),
      );
    } else {
      const lockEl = h('div', {
        class: 'translate-view-lock help',
        hidden: true,
      });
      children.push(lockEl);
      for (const r of s.rows) {
        children.push(
          fieldRow({
            slideId: s.slideId,
            path: r.path,
            label: rowLabel(def, r.path),
            meta: fieldMetaForPath(def, r.path.join('.')),
            source: r.source,
            target: r.target,
          }),
        );
      }
      if (!s.rows.length)
        children.push(
          h('div', {
            class: 'empty-note',
            text: t(
              'editor.translateView.noText',
              'This slide has no text to translate.',
            ),
          }),
        );
    }
    return h(
      'section',
      { class: 'translate-view-slide', 'data-slide-id': s.slideId },
      children,
    );
  };

  /** Rebuild the rows, keeping the focused field and its caret. */
  function render() {
    const focused = [...controls.values()].find(
      (c) => c.el === document.activeElement,
    );
    const caret = focused
      ? [focused.el.selectionStart, focused.el.selectionEnd]
      : null;
    const focusKey = focused
      ? addressKey(focused.lang, focused.slideId, focused.path)
      : null;

    controls = new Map();
    if (!state.source || !state.target) {
      body.replaceChildren(
        h('div', {
          class: 'empty-note',
          text: t(
            'editor.translateView.oneLanguage',
            'This deck has one language. Add a language first to translate it.',
          ),
        }),
      );
      renderedShape = '';
      return;
    }

    const model = currentModel();
    const shown = visibleModel(model);
    renderedShape = shapeOf(model);

    const head = h('div', { class: 'translate-view-row translate-view-head' }, [
      h('div', { class: 'translate-view-label' }),
      h('div', { text: getLangDisplayName(state.source) }),
      h('div', { text: getLangDisplayName(state.target) }),
    ]);
    const parts = [head];
    if (shown.deck) {
      parts.push(
        h('section', { class: 'translate-view-slide is-deck' }, [
          fieldRow({
            slideId: null,
            path: shown.deck.path,
            label: t('editor.translateView.deckTitle', 'Deck title'),
            meta: { type: 'string' },
            source: shown.deck.source,
            target: shown.deck.target,
          }),
        ]),
      );
    }
    for (const s of shown.slides) parts.push(slideSection(s));
    if (state.filter && !shown.deck && !shown.slides.length) {
      parts.push(
        h('div', {
          class: 'empty-note',
          text: t(
            'editor.translateView.noneEmpty',
            'No empty fields: every text has a translation.',
          ),
        }),
      );
    }
    body.replaceChildren(...parts);

    const again = focusKey ? controls.get(focusKey) : null;
    if (again) {
      again.el.focus();
      if (caret) again.el.setSelectionRange(caret[0], caret[1]);
    }
    applyWriteState();
  }

  /** Readonly per field from the inert reason and the slide locks. */
  function applyWriteState() {
    const inert = inertReason();
    statusEl.hidden = !inert;
    statusEl.textContent = inert || '';
    for (const section of body.querySelectorAll('.translate-view-slide')) {
      const lockEl = section.querySelector('.translate-view-lock');
      if (!lockEl) continue;
      const lock = lockOf(section.dataset.slideId);
      lockEl.hidden = !lock;
      lockEl.textContent = lock ? lockMessage(lock) : '';
    }
    for (const c of controls.values()) {
      c.el.readOnly = !!inert || !!lockOf(c.slideId);
    }
    syncHistory();
  }

  /** Undo/redo follow the editor's stacks; an own write changes them too. */
  function syncHistory() {
    if (undoBtn) undoBtn.disabled = !history.canUndo();
    if (redoBtn) redoBtn.disabled = !history.canRedo();
  }

  /**
   * Follow a change from outside (remote edit, undo/redo, readiness, lock):
   * re-render when the rows changed, else refresh the values of the fields
   * without focus.
   */
  function sync() {
    if (!state.source || !state.target) {
      const next = defaultLanguagePair(pres, activeLang());
      if (next) setPair(next.source, next.target);
      return;
    }
    const langs = langOptions();
    if (!langs.includes(state.source) || !langs.includes(state.target)) {
      const next = defaultLanguagePair(pres, activeLang());
      setPair(next?.source || null, next?.target || null);
      return;
    }
    const model = currentModel();
    if (shapeOf(model) !== renderedShape) {
      if (state.filter) freezeFilter(model);
      render();
      return;
    }
    const value = (lang, slideId, path) => {
      if (!slideId)
        return lang === state.source ? model.deck.source : model.deck.target;
      const s = model.slides.find((x) => x.slideId === slideId);
      const r = s?.rows.find(
        (x) => rowKey(slideId, x.path) === rowKey(slideId, path),
      );
      if (!r) return null;
      return lang === state.source ? r.source : r.target;
    };
    for (const c of controls.values()) {
      const next = value(c.lang, c.slideId, c.path);
      if (next == null) continue;
      c.stored = next;
      if (c.el !== document.activeElement && c.el.value !== next)
        c.el.value = next;
    }
    applyWriteState();
  }

  renderPair();
  render();
  unsubscribe = subscribe?.(sync) || null;
  modal.show(root);
  return { close: modal.close, sync };
}

/**
 * Whether the deck has two languages to pair: the menus offer the view only
 * then.
 * @param {Object} pres
 * @param {Function} normalizeLang
 * @returns {boolean}
 */
export function canOpenTranslateView(pres, normalizeLang) {
  return !!defaultLanguagePair(pres, normalizeLang(pres?.i18n?.active));
}
