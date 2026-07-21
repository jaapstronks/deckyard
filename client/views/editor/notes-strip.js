import { t } from '../../lib/ui-i18n.js';
import { chevronDownIcon } from '../../lib/icons.js';
import { createCsvGridEditor } from './fields/csv-grid.js';

const COLLAPSE_KEY = 'deckyard.notesStrip.collapsed';

/**
 * Collapsible strip under the slide preview (Keynote / PowerPoint convention).
 * It is the editor's "own surface" bottom zone: it hosts presenter notes and,
 * for chart slides, the chart-data editor on a sibling "Data" tab. Both belong
 * beneath the slide rather than in the narrow inspector rail — notes are not
 * position-bound, and a data grid does not fit a narrow column (editing-surfaces
 * §4.3). The strip fills the otherwise-empty space beneath the 16:9 stage.
 *
 * Tabs only appear when there is a second surface to offer: on a chart slide
 * the header shows [Notes | Data]; on every other slide it is notes-only and
 * looks exactly like before (just the "Presenter notes" title). The Data tab's
 * grid is (re)mounted from the controller's slide-change path via `syncData`,
 * and opened on demand from the inspector's "Edit data…" button via
 * `openDataTab`.
 *
 * Collapsible: when collapsed only the header bar shows and the slide reclaims
 * the full canvas height. The collapsed state is remembered across slides and
 * reloads (localStorage).
 *
 * The notes textarea keeps the seams the old pane carried:
 * - `data-collab-field-key="notes"` for presence focus rings, and
 * - the element itself is handed to the live-edits binder / search focus as
 *   `previewNotesTa` (the strip is persistent DOM, so the reference holds).
 *
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Object} options.pres - Presentation model
 * @param {Function} options.getSelectedSlideId
 * @param {Function} options.markDirty
 * @param {Function} [options.scheduleUiRefresh] - Debounced preview repaint,
 *   called after a chart-data edit so the slide re-renders live.
 * @param {Function} [options.onOpenQr] - Opens the phone companion (QR) view
 * @returns {{
 *   el: HTMLElement,
 *   textarea: HTMLTextAreaElement,
 *   syncData: (slide: Object|null) => void,
 *   openDataTab: () => void,
 * }}
 */
export function createNotesStrip({
  h,
  pres,
  getSelectedSlideId,
  markDirty,
  scheduleUiRefresh,
  onOpenQr,
} = {}) {
  // On a narrow screen the strip shares one stacked row with the canvas, and
  // an expanded strip leaves the slide too little height to read. Start
  // collapsed there — the header stays tappable, and an explicit choice is
  // still remembered, so this only decides the first visit.
  let collapsed = window.innerWidth <= 820;
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) collapsed = stored === '1';
  } catch {
    /* private mode / storage disabled: keep the width-based default */
  }

  let activeTab = 'notes'; // 'notes' | 'data'
  let dataTabAvailable = false;
  // Signature of what the mounted grid was built for; a fresh chart slide or a
  // chartType change (which alters the column model) forces a remount, but a
  // plain data edit keeps the grid (and the user's caret) in place.
  let lastDataSig = null;

  const el = h('div', { class: 'notes-strip' });

  const toggleBtn = h('button', {
    class: 'notes-strip-toggle',
    type: 'button',
    'aria-expanded': String(!collapsed),
  });
  const chevron = chevronDownIcon({ size: 16 });
  chevron.classList.add('notes-strip-chevron');
  const titleSpan = h('span', {
    class: 'notes-strip-title',
    text: t('editor.notes.title', 'Presenter notes'),
  });
  toggleBtn.append(chevron, titleSpan);

  // Tab bar: only rendered visible for chart slides (dataTabAvailable). The
  // chevron/toggle stays the collapse control; the tabs sit beside it and, when
  // shown, replace the standalone title (they carry the labels themselves).
  const notesTabBtn = h('button', {
    class: 'notes-strip-tab is-active',
    type: 'button',
    role: 'tab',
    'aria-selected': 'true',
    text: t('editor.notes.tabNotes', 'Notes'),
  });
  const dataTabBtn = h('button', {
    class: 'notes-strip-tab',
    type: 'button',
    role: 'tab',
    'aria-selected': 'false',
    text: t('editor.notes.tabData', 'Data'),
  });
  const tabs = h('div', { class: 'notes-strip-tabs', role: 'tablist' }, [
    notesTabBtn,
    dataTabBtn,
  ]);
  tabs.hidden = true;

  const headerLeft = h('div', { class: 'row notes-strip-header-left' }, [
    toggleBtn,
    tabs,
  ]);

  const headerActions = h('div', { class: 'row notes-strip-actions' });
  if (typeof onOpenQr === 'function') {
    headerActions.append(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('editor.notes.qr', 'Notes (QR)'),
        title: t('editor.companion.title', 'Open speaker notes companion on your phone (QR code).'),
        onclick: () => onOpenQr(),
      })
    );
  }

  const header = h('div', { class: 'row spread notes-strip-header' }, [
    headerLeft,
    headerActions,
  ]);

  // --- Notes panel (the original body) --------------------------------------
  const textarea = h('textarea', {
    class: 'form-input notes-strip-input',
    // Collab presence: focus in the notes is reported/decorated under the
    // 'notes' field path (see presence/presence-ui.js). Inert without collab.
    'data-collab-field-key': 'notes',
    placeholder: t(
      'editor.notes.placeholder',
      "Text you write here shows on your phone. Click 'Notes (QR)' to show a QR code for your phone."
    ),
  });
  textarea.addEventListener('input', () => {
    const slide = currentSlide();
    if (!slide) return;
    slide.notes = textarea.value;
    markDirty?.();
  });
  const notesPanel = h('div', { class: 'notes-strip-pane notes-strip-notes' }, [textarea]);

  // --- Data panel (chart-data grid, mounted per slide) ----------------------
  const dataHost = h('div', { class: 'csv-grid-mount' });
  const dataPanel = h('div', { class: 'notes-strip-pane notes-strip-data' }, [dataHost]);
  dataPanel.hidden = true;

  const body = h('div', { class: 'notes-strip-body' }, [notesPanel, dataPanel]);
  el.append(header, body);

  function currentSlide() {
    const sid = getSelectedSlideId?.();
    return (pres?.slides || []).find((s) => s?.id === sid) || null;
  }

  /**
   * (Re)mount the chart-data grid for `slide`. No-op for non-chart slides. The
   * grid is only rebuilt when the slide id or chartType changes (the signature),
   * so typing in the grid — which fires onChange → scheduleUiRefresh → a
   * slide-change sync — never yanks the caret. Pass `force` to rebuild from the
   * slide's current data (used when opening the tab, so it reflects edits made
   * on another surface).
   */
  function mountDataGrid(slide, { force = false } = {}) {
    if (!slide || slide.type !== 'chart-slide') {
      dataHost.replaceChildren();
      lastDataSig = null;
      return;
    }
    const chartType = String(slide.content?.chartType || 'bar');
    const sig = `${slide.id}::${chartType}`;
    if (!force && sig === lastDataSig && dataHost.firstChild) return;
    lastDataSig = sig;
    const editor = createCsvGridEditor({
      h,
      chartType,
      value: slide.content?.data || '',
      label: t('editor.chart.dataLabel', 'Data (CSV/TSV)'),
      onChange: (csv) => {
        // Re-fetch the slide at edit time (mirrors the notes input): the closure
        // could outlive the selection if a stale rerender left the grid mounted.
        const s = currentSlide();
        if (!s || s.type !== 'chart-slide') return;
        s.content.data = csv;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    });
    dataHost.replaceChildren(editor.el);
  }

  function setActiveTab(tab) {
    activeTab = tab === 'data' && dataTabAvailable ? 'data' : 'notes';
    const dataActive = activeTab === 'data';
    notesTabBtn.classList.toggle('is-active', !dataActive);
    dataTabBtn.classList.toggle('is-active', dataActive);
    notesTabBtn.setAttribute('aria-selected', String(!dataActive));
    dataTabBtn.setAttribute('aria-selected', String(dataActive));
    notesPanel.hidden = dataActive;
    dataPanel.hidden = !dataActive;
    // The QR companion is a notes-only action; hide it while editing data.
    headerActions.hidden = dataActive;
  }

  function setDataTabAvailable(avail) {
    dataTabAvailable = !!avail;
    tabs.hidden = !dataTabAvailable;
    titleSpan.hidden = dataTabAvailable;
    if (!dataTabAvailable && activeTab === 'data') setActiveTab('notes');
  }

  notesTabBtn.addEventListener('click', () => setActiveTab('notes'));
  // Same path as the inspector's "Edit data…": expand if collapsed, mount fresh,
  // activate — so the tab always shows something when clicked.
  dataTabBtn.addEventListener('click', () => openDataTab());

  const applyCollapsed = () => {
    el.classList.toggle('is-collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleBtn.title = collapsed
      ? t('editor.notes.expand', 'Show presenter notes')
      : t('editor.notes.collapse', 'Hide presenter notes');
  };
  applyCollapsed();

  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    applyCollapsed();
  });

  /**
   * Reconcile the Data surface with the selected slide. Called from the
   * controller's slide-change / preview-refresh path: it toggles the Data tab's
   * availability and keeps the grid mounted for the current chart slide. The
   * selected slide's notes are still loaded into `textarea.value` by that same
   * path (previewNotesTa), so this only owns the data half.
   *
   * @param {Object|null} slide - The currently selected slide.
   */
  function syncData(slide) {
    const isChart = slide?.type === 'chart-slide';
    setDataTabAvailable(isChart);
    if (!isChart) {
      dataHost.replaceChildren();
      lastDataSig = null;
      return;
    }
    mountDataGrid(slide);
  }

  /**
   * Open (and expand) the strip on the Data tab for the current chart slide.
   * The inspector's "Edit data…" button is the entry point per editing-surfaces
   * §4.3 (the edit opens elsewhere, but the inspector stays the one place to
   * reach it).
   */
  function openDataTab() {
    const slide = currentSlide();
    if (!slide || slide.type !== 'chart-slide') return;
    if (collapsed) {
      collapsed = false;
      try {
        localStorage.setItem(COLLAPSE_KEY, '0');
      } catch {
        /* ignore */
      }
      applyCollapsed();
    }
    setDataTabAvailable(true);
    mountDataGrid(slide, { force: true });
    setActiveTab('data');
  }

  // The selected slide's notes are loaded into `textarea.value` by the
  // controller's slide-change path (previewNotesTa), same as the old pane.
  return { el, textarea, syncData, openDataTab };
}
