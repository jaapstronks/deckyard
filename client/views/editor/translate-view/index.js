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
 * Navigation follows the editor selection through its lock-aware seam.
 */
import { attachThumbScale } from '../../../lib/slide-runtime/thumb-scale.js';
import { createTranslateNavigation } from './navigation.js';
import {
  mountSlideInto,
  cleanupSlideRuntimes,
} from '../../../lib/slide-runtime/slide-render.js';
import { h } from '../../../lib/dom/index.js';
import { icon } from '../../../lib/dom/icons.js';
import { createModal } from '../../../lib/dom/modal.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { t } from '../../../lib/ui-i18n.js';
import { featureEnabled } from '../../../lib/state/features.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { fieldLabel, fieldMetaForPath } from '../inline-edit/field-path.js';
import { slideTypeLabel } from '../convert-slide-action.js';
import {
  defaultLanguagePair,
  isEmptyTarget,
  filterTranslationRows,
  translateViewModel,
  versionOf,
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
 * @param {string} [opts.targetLang] - target selected when adding a language
 * @param {Function} [opts.api] - translation preview endpoint
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
 * @param {() => Object} [opts.getTheme] - current theme for on-demand previews
 * @param {Function} [opts.onClosed]
 * @returns {{close: Function, sync: Function}}
 */
export function openTranslateView({
  root,
  pres,
  slideTypes,
  normalizeLang,
  targetLang,
  api,
  write,
  canWrite,
  subscribe,
  getSlideLockKind,
  isReadOnly,
  getSelectedSlideId,
  selectSlide,
  history,
  onClosed,
  getTheme,
} = {}) {
  const activeLang = () => normalizeLang(pres?.i18n?.active);
  const pair = defaultLanguagePair(pres, activeLang());
  const state = {
    source: pair?.source || null,
    target:
      pair?.langs.includes(targetLang) && targetLang !== pair.source
        ? targetLang
        : pair?.target || null,
    filter: '',
  };
  /** Row keys the filter keeps, frozen while typing (see `freezeFilter`). */
  let filterKeep = null;
  /** addressKey → { el, slideId, path, lang, stored, error } */
  let controls = new Map();
  let renderedShape = '';
  let unsubscribe = null;
  let navigation = null;
  let previewCleanups = [];
  const proposals = new Map();
  const failures = new Map();
  const working = new Set();
  let runId = 0;
  let progress = null;
  let closed = false;
  const clearPreviews = () => {
    for (const cleanup of previewCleanups) cleanup();
    previewCleanups = [];
    cleanupSlideRuntimes(body);
  };

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
      closed = true;
      runId += 1;
      navigation?.detach();
      clearPreviews();
      unsubscribe?.();
      unsubscribe = null;
      controls = new Map();
      onClosed?.();
    },
  });

  const pairEl = h('div', { class: 'translate-view-pair' });
  const filterSelect = h(
    'select',
    {
      class: 'translate-view-filter',
      'aria-label': t('editor.translateView.filter', 'Filter fields'),
    },
    [
      h('option', {
        value: '',
        text: t('editor.translateView.allFields', 'All fields'),
      }),
      h('option', {
        value: 'empty',
        text: t('editor.translateView.onlyEmpty', 'Only empty fields'),
      }),
      h('option', {
        value: 'changed',
        text: t('editor.translateView.fieldStatus.changed', 'Source changed'),
      }),
      h('option', {
        value: 'same',
        text: t('editor.translateView.fieldStatus.same', 'Same as source'),
      }),
    ],
  );
  filterSelect.addEventListener('change', () => {
    state.filter = filterSelect.value;
    filterKeep = null;
    render();
  });
  const fieldStatusLabel = (status) =>
    ({
      empty: t('editor.translateView.fieldStatus.empty', 'Empty'),
      same: t('editor.translateView.fieldStatus.same', 'Same as source'),
      changed: t('editor.translateView.fieldStatus.changed', 'Source changed'),
      current: t('editor.translateView.fieldStatus.current', 'Current'),
      untracked: t('editor.translateView.fieldStatus.untracked', 'No history'),
    })[status];
  const refreshFieldStatuses = (model) => {
    const rows = [model.deck, ...model.slides.flatMap((s) => s.rows)].filter(
      Boolean,
    );
    for (const r of rows) {
      const entry = controls.get(addressKey(state.target, r.slideId, r.path));
      if (entry?.statusEl)
        entry.statusEl.textContent = fieldStatusLabel(r.status);
    }
  };
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
  const proposalProgress = featureEnabled('ai')
    ? h('div', {
        class: 'translate-view-proposal-progress help',
        role: 'status',
      })
    : null;
  const proposeEmptyBtn = featureEnabled('ai')
    ? h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t(
          'editor.translateView.proposeEmpty',
          'Suggest all empty fields',
        ),
        onclick: () => proposeAllEmpty(),
      })
    : null;
  const acceptEmptyBtn = featureEnabled('ai')
    ? h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t(
          'editor.translateView.acceptEmpty',
          'Accept suggestions in empty fields',
        ),
        onclick: () => acceptEmpty(),
      })
    : null;
  const toolbar = h('div', { class: 'translate-view-toolbar' }, [
    pairEl,
    filterSelect,
    proposeEmptyBtn,
    acceptEmptyBtn,
    h('div', { class: 'translate-view-history' }, [undoBtn, redoBtn]),
  ]);
  const body = h('div', { class: 'translate-view-body' });
  const index = h('nav', {
    class: 'translate-view-index',
    'aria-label': t('editor.translateView.slideIndex', 'Slides'),
  });
  modal.append(
    h(
      'div',
      { class: `translate-view-frame${featureEnabled('ai') ? ' has-ai' : ''}` },
      [
        toolbar,
        statusEl,
        proposalProgress,
        h('div', { class: 'translate-view-content' }, [index, body]),
      ],
    ),
  );

  // ── language pair ────────────────────────────────────────────────────────

  const langOptions = () =>
    defaultLanguagePair(pres, activeLang())?.langs || [];

  const setPair = (source, target) => {
    runId += 1;
    proposals.clear();
    failures.clear();
    working.clear();
    progress = null;
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

  /**
   * Write one field. Only an accepted suggestion passes `sourceLang`, which
   * stamps provenance; a typed write in either column stamps nothing and
   * leaves an existing stamp where it is (B817).
   */
  const writeValue = (
    entry,
    value,
    { refresh = true, sourceLang = null } = {},
  ) => {
    const inert = inertReason();
    if (inert) {
      showRefusal(entry, inert);
      return false;
    }
    const lock = lockOf(entry.slideId);
    if (lock) {
      showRefusal(entry, lockMessage(lock));
      return false;
    }
    // A write into the active language is an edit of that slide: select it
    // first, so the lock the edit takes is this slide's (review rule 1).
    if (
      entry.slideId &&
      entry.lang === activeLang() &&
      getSelectedSlideId?.() !== entry.slideId
    )
      selectSlide?.(entry.slideId);
    if (!write(entry.lang, entry.slideId, entry.path, value, { sourceLang })) {
      showRefusal(
        entry,
        entry.slideId && lockOf(entry.slideId)
          ? lockMessage(lockOf(entry.slideId))
          : t(
              'editor.translateView.writeRefused',
              'This change could not be saved. The field shows what is stored.',
            ),
      );
      return false;
    }
    entry.el.value = value;
    entry.stored = value;
    entry.error?.clear();
    if (refresh && proposals.has(rowKey(entry.slideId, entry.path))) {
      render();
      return true;
    }
    // An own write emits no change signal (the view already holds the text),
    // but the index's status dots are derived: refresh them, or filling the
    // last empty field of a slide would leave it marked incomplete.
    if (refresh) {
      const model = currentModel();
      refreshIndex(model);
      refreshFieldStatuses(model);
      syncHistory();
    }
    return true;
  };
  const onInput = (entry) => writeValue(entry, entry.el.value);

  // ── rendering ────────────────────────────────────────────────────────────

  const currentModel = () =>
    translateViewModel({
      pres,
      source: state.source,
      target: state.target,
      activeLang: activeLang(),
      slideTypes,
    });

  const modelRow = (model, slideId, path) => {
    if (!slideId) return model.deck;
    const slide = model.slides.find((s) => s.slideId === slideId);
    if (slide?.only) return null;
    return slide?.rows.find(
      (r) => rowKey(slideId, r.path) === rowKey(slideId, path),
    );
  };

  const proposalIsFresh = (proposal, model = currentModel()) => {
    if (
      proposal.sourceLang !== state.source ||
      proposal.targetLang !== state.target
    )
      return false;
    const row = modelRow(model, proposal.slideId, proposal.path);
    return (
      !!row && row.source === proposal.source && row.target === proposal.target
    );
  };

  const updateProposalChrome = () => {
    if (!featureEnabled('ai')) return;
    const model = currentModel();
    const validEmpty = [...proposals.values()].some(
      (p) =>
        proposalIsFresh(p, model) &&
        !modelRow(model, p.slideId, p.path).target.trim(),
    );
    proposeEmptyBtn.disabled = !!progress || !!working.size || !!inertReason();
    acceptEmptyBtn.disabled = !validEmpty || !!inertReason();
    proposalProgress.textContent = progress
      ? t(
          'editor.translateView.proposalProgress',
          'Suggestions: {done} of {total} requests',
          progress,
        )
      : '';
    for (const item of index.querySelectorAll('[data-slide-id]')) {
      const id = item.dataset.slideId;
      item.classList.toggle('has-proposal-failure', failures.has(id));
      item.classList.toggle('is-proposing', working.has(id));
      const count = [...proposals.values()].filter(
        (p) => p.slideId === id && proposalIsFresh(p, model),
      ).length;
      const indicator = item.querySelector('.translate-view-proposal-count');
      if (indicator)
        indicator.textContent = working.has(id)
          ? '…'
          : failures.has(id)
            ? '!'
            : count
              ? String(count)
              : '';
      const note = working.has(id)
        ? t('editor.translateView.proposalWorking', 'Requesting suggestions')
        : failures.has(id)
          ? t(
              'editor.translateView.proposalFailed',
              'Suggestion failed; retry on slide',
            )
          : count
            ? t('editor.translateView.proposalCount', '{count} suggestions', {
                count,
              })
            : '';
      item.setAttribute(
        'aria-label',
        `${item.dataset.baseLabel}${note ? `, ${note}` : ''}`,
      );
    }
  };

  /** One request carries one slide's text fields, keyed by their exact path. */
  async function proposeRows(slideId, rows, generation = runId) {
    if (!rows.length || !api || closed || working.has(slideId || 'deck'))
      return;
    const fields = Object.fromEntries(
      rows.map((r) => [JSON.stringify(r.path), r.source]),
    );
    working.add(slideId || 'deck');
    failures.delete(slideId || 'deck');
    updateProposalChrome();
    try {
      const vendor = readPreferredLlmVendor();
      const response = await api(
        `/api/presentations/${pres.id}/translate/fields`,
        {
          method: 'POST',
          body: {
            from: state.source,
            to: state.target,
            fields,
            ...(vendor ? { vendor } : {}),
          },
        },
      );
      if (closed || generation !== runId) return;
      const model = currentModel();
      const missing = [];
      for (const row of rows) {
        const value = response?.translations?.[JSON.stringify(row.path)];
        const proposal = {
          slideId,
          path: row.path,
          source: row.source,
          target: row.target,
          sourceLang: state.source,
          targetLang: state.target,
          value,
        };
        if (
          typeof value === 'string' &&
          value.trim() &&
          proposalIsFresh(proposal, model)
        )
          proposals.set(rowKey(slideId, row.path), proposal);
        else if (proposalIsFresh(proposal, model))
          missing.push(rowKey(slideId, row.path));
      }
      if (missing.length)
        failures.set(slideId || 'deck', {
          message: t(
            'editor.translateView.incompleteProposal',
            'Some suggestions were missing from the response.',
          ),
          paths: missing,
        });
    } catch (error) {
      if (!closed && generation === runId)
        failures.set(slideId || 'deck', {
          message: error?.message || String(error),
          paths: rows.map((r) => rowKey(slideId, r.path)),
        });
    } finally {
      if (!closed && generation === runId) {
        working.delete(slideId || 'deck');
        render();
      }
    }
  }

  async function proposeAllEmpty() {
    if (progress || working.size || inertReason()) return;
    const model = currentModel();
    const groups = [
      ...(model.deck && isEmptyTarget(model.deck) ? [null] : []),
      ...model.slides
        .filter((s) => !s.only)
        .filter((s) => s.rows.some(isEmptyTarget))
        .map((s) => s.slideId),
    ];
    const generation = ++runId;
    progress = { done: 0, total: groups.length };
    updateProposalChrome();
    for (const slideId of groups) {
      if (closed || generation !== runId) break;
      const current = currentModel();
      const rows = (
        slideId
          ? current.slides.find((s) => s.slideId === slideId)?.rows || []
          : [current.deck]
      ).filter((r) => r && isEmptyTarget(r));
      await proposeRows(slideId, rows, generation);
      progress.done += 1;
      updateProposalChrome();
    }
    if (!closed && generation === runId) {
      progress = null;
      updateProposalChrome();
    }
  }

  function acceptProposal(
    proposal,
    { onlyEmpty = false, refresh = true } = {},
  ) {
    const model = currentModel();
    if (!proposalIsFresh(proposal, model)) return false;
    const row = modelRow(model, proposal.slideId, proposal.path);
    if (onlyEmpty && row.target.trim()) return false;
    const entry = controls.get(
      addressKey(state.target, proposal.slideId, proposal.path),
    );
    if (
      !entry ||
      !writeValue(entry, proposal.value, {
        refresh,
        sourceLang: proposal.sourceLang,
      })
    )
      return false;
    proposals.delete(rowKey(proposal.slideId, proposal.path));
    if (refresh) render();
    return true;
  }

  function acceptEmpty() {
    for (const proposal of [...proposals.values()])
      acceptProposal(proposal, { onlyEmpty: true, refresh: false });
    render();
  }

  /**
   * Which rows the filter shows. Computed when the filter or the pair
   * changes, then kept while you type: filling an empty field must not make
   * it vanish under the caret. A structural change adds the rows that are
   * empty now and keeps the ones already shown.
   */
  const freezeFilter = (model) => {
    const keep = new Set(filterKeep || []);
    const filtered = filterTranslationRows(model, state.filter);
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

  /** The index's numbers and status dots; the rows on screen stay as they are. */
  const refreshIndex = (model = currentModel()) =>
    navigation?.update(visibleModel(model).slides, model.slides);

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

  const fieldRow = ({ slideId, path, label, meta, source, target, status }) => {
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
    tgt.statusEl = h('span', {
      class: 'translate-view-field-status help',
      text: fieldStatusLabel(status),
    });
    const labelEl = h('div', { class: 'translate-view-label', text: label });
    const srcName = getLangDisplayName(state.source);
    const tgtName = getLangDisplayName(state.target);
    src.el.setAttribute('aria-label', `${label} (${srcName})`);
    tgt.el.setAttribute('aria-label', `${label} (${tgtName})`);
    const proposal = proposals.get(rowKey(slideId, path));
    const requestRow = { slideId, path, source, target };
    const proposalCell = featureEnabled('ai')
      ? h('div', { class: 'translate-view-cell translate-view-proposal' }, [
          proposal
            ? h('div', {
                class: 'translate-view-proposal-text',
                text: proposal.value,
              })
            : h('span', {
                class: 'help',
                text: t('editor.translateView.noProposal', 'No suggestion yet'),
              }),
          proposal && !proposalIsFresh(proposal)
            ? h('span', {
                class: 'help',
                text: t(
                  'editor.translateView.proposalStale',
                  'Text changed; request a new suggestion',
                ),
              })
            : null,
          proposal && proposalIsFresh(proposal)
            ? h('button', {
                type: 'button',
                class: 'btn btn-primary btn-sm',
                text: t('editor.translateView.acceptProposal', 'Accept'),
                disabled: !!inertReason() || !!lockOf(slideId),
                onclick: () => acceptProposal(proposal),
              })
            : null,
          source.trim() && (!proposal || !proposalIsFresh(proposal))
            ? h('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: t('editor.translateView.proposeField', 'Suggest field'),
                disabled: !!inertReason() || working.has(slideId || 'deck'),
                onclick: () => proposeRows(slideId, [requestRow]),
              })
            : null,
        ])
      : null;
    const row = h(
      'div',
      {
        class: `translate-view-row${isEmptyTarget({ source, target }) ? ' is-empty-target' : ''}`,
      },
      [
        labelEl,
        h('div', { class: 'translate-view-cell' }, [src.el]),
        h('div', { class: 'translate-view-cell' }, [tgt.el, tgt.statusEl]),
        proposalCell,
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
    const preview = h('div', {
      class: 'translate-view-preview thumb',
      hidden: true,
    });
    const previewBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      text: t('editor.translateView.preview', 'Preview slide'),
      'aria-expanded': 'false',
      onclick: () => {
        preview.hidden = !preview.hidden;
        previewBtn.setAttribute('aria-expanded', String(!preview.hidden));
        cleanupSlideRuntimes(preview);
        preview.replaceChildren();
        if (!preview.hidden) {
          const lang = s.only === 'target' ? state.target : state.source;
          const version = versionOf(pres, lang, activeLang());
          if (!preview.dataset.scaled) {
            previewCleanups.push(attachThumbScale(preview));
            preview.dataset.scaled = 'true';
          }
          mountSlideInto(
            preview,
            version.slides.find((slide) => slide.id === s.slideId),
            {
              mode: 'thumb',
              theme: getTheme?.(),
              presentationId: pres.id,
              renderVia: { kind: 'deck', id: pres.id },
              lang,
            },
          );
        }
      },
    });
    const children = [
      h('div', { class: 'translate-view-slide-heading' }, [
        heading,
        previewBtn,
        featureEnabled('ai') && !s.only && s.rows.some((r) => r.source.trim())
          ? h('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm translate-view-propose-slide',
              text: t('editor.translateView.proposeSlide', 'Suggest slide'),
              disabled: !!inertReason() || working.has(s.slideId),
              onclick: () =>
                proposeRows(
                  s.slideId,
                  s.rows.filter((r) => r.source.trim()),
                ),
            })
          : null,
      ]),
      preview,
    ];
    if (failures.has(s.slideId))
      children.push(
        h('div', { class: 'translate-view-proposal-failure', role: 'alert' }, [
          h('span', { text: failures.get(s.slideId).message }),
          h('button', {
            type: 'button',
            class: 'btn btn-secondary btn-sm',
            text: t('editor.translateView.retry', 'Retry slide'),
            onclick: () => {
              const paths = new Set(failures.get(s.slideId)?.paths || []);
              const rows =
                currentModel().slides.find((x) => x.slideId === s.slideId)
                  ?.rows || [];
              proposeRows(
                s.slideId,
                rows.filter(
                  (r) =>
                    paths.has(rowKey(s.slideId, r.path)) && r.source.trim(),
                ),
              );
            },
          }),
        ]),
      );
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
            status: r.status,
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

    clearPreviews();
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
      featureEnabled('ai')
        ? h('div', { text: t('editor.translateView.proposal', 'Suggestion') })
        : null,
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
            status: shown.deck.status,
          }),
          failures.has('deck')
            ? h(
                'div',
                { class: 'translate-view-proposal-failure', role: 'alert' },
                [
                  h('span', { text: failures.get('deck').message }),
                  h('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: t('editor.translateView.retry', 'Retry slide'),
                    onclick: () => proposeRows(null, [currentModel().deck]),
                  }),
                ],
              )
            : null,
        ]),
      );
    }
    for (const s of shown.slides) parts.push(slideSection(s));
    if (state.filter && !shown.deck && !shown.slides.length) {
      parts.push(
        h('div', {
          class: 'empty-note',
          text: t(
            'editor.translateView.noneMatching',
            'No fields match this filter.',
          ),
        }),
      );
    }
    body.replaceChildren(...parts);
    navigation?.update(shown.slides, model.slides);
    updateProposalChrome();

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
    updateProposalChrome();
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
    if (
      [...proposals.values()].some(
        (proposal) => !proposalIsFresh(proposal, model),
      )
    ) {
      render();
      return;
    }
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
    refreshIndex(model);
    refreshFieldStatuses(model);
    updateProposalChrome();
    applyWriteState();
  }

  navigation = createTranslateNavigation({
    body,
    index,
    getSelectedSlideId,
    selectSlide,
  });
  renderPair();
  render();
  unsubscribe = subscribe?.(sync) || null;
  modal.show(root);
  navigation.go(getSelectedSlideId?.());
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
