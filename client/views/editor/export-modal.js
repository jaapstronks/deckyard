/**
 * Export modal - the unified "Export to file" dialog for the editor topbar.
 *
 * Replaces the old flat export dropdown. Formats are grouped (Slides /
 * Documents / Data & bundle), each with a colour-coded icon and a one-line
 * description, so a reader can tell PPTX from a handoff ZIP without guessing
 * from a bare label. A single language toggle at the top drives every export
 * URL, replacing the dropdown's duplicated "other language" section.
 *
 * PDF is deliberately a *single* entry. It downloads the deterministic
 * server-rendered PDF and only reveals the browser-print page as a fallback
 * when that render fails or times out. The two used to be two co-equal menu
 * items ("PDF" and "PDF (print in browser)"), which conflated an
 * implementation detail (which renderer) with a user choice.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { openModal } from '../../lib/dom/modal.js';
import { toast } from '../../lib/dom/toast.js';
import { normalizeLang, hasLangVersion, otherLang } from '../../lib/format/i18n.js';
import { createSegmented } from '../../lib/dom/segmented.js';
import { buildExportUrl } from './publish-export/urls.js';

const LUCIDE = (name) => `/client/vendor/lucide-icons/${name}.svg`;

// Client-side ceiling for the synchronous PDF render before we offer the
// browser-print fallback. The server's own cap is PDF_EXPORT_TIMEOUT_MS (120s);
// we bail a little sooner so the user isn't left staring at a dead spinner.
const PDF_FETCH_TIMEOUT_MS = 90_000;

/**
 * Describe the export format groups. Called at open time so labels pick up the
 * current locale. `path` is the export route segment; `open` is how a plain
 * export is triggered ('tab' → new tab, 'download' → same-tab navigation).
 * PDF and Notes are special-cased in the row builder.
 * @returns {Array<{key:string,title:string,formats:Array<object>}>}
 */
function exportGroups() {
  return [
    {
      key: 'slides',
      title: t('editor.export.groupSlides', 'Slides'),
      formats: [
        { key: 'pdf', name: 'PDF', desc: t('editor.export.descPdf', 'One slide per page (16:9)'), icon: 'file-text', color: 'red' },
        { key: 'png', name: 'PNG', desc: t('editor.export.descPng', 'Image of each slide'), icon: 'image', color: 'green', path: 'png', open: 'tab' },
        { key: 'pptx', name: 'PPTX', desc: t('editor.export.descPptx', 'PowerPoint file'), icon: 'presentation', color: 'amber', path: 'pptx', open: 'tab' },
        { key: 'html', name: 'HTML', desc: t('editor.export.descHtml', 'Self-contained web page'), icon: 'code-xml', color: 'blue', path: 'html', open: 'download' },
      ],
    },
    {
      key: 'documents',
      title: t('editor.export.groupDocuments', 'Documents'),
      formats: [
        { key: 'textpdf', name: t('editor.export.textPdf', 'Text handout'), desc: t('editor.export.descTextPdf', 'Readable handout, no slide layout'), icon: 'sticky-note', color: 'teal', path: 'pdf', open: 'tab' },
        {
          key: 'notes',
          name: t('editor.export.notes', 'Notes'),
          desc: t('editor.export.descNotes', 'Speaker notes'),
          icon: 'notebook',
          color: 'purple',
          actions: [
            { label: 'Markdown', path: 'notes.md', open: 'tab' },
            { label: t('editor.export.notesWordShort', 'Word'), path: 'notes.docx', open: 'tab' },
          ],
        },
      ],
    },
    {
      key: 'data',
      title: t('editor.export.groupData', 'Data & bundle'),
      formats: [
        { key: 'json', name: 'JSON', desc: t('editor.export.descJson', 'Raw deck data'), icon: 'database', color: 'slate', path: 'json', open: 'download' },
        { key: 'handoff', name: t('editor.export.handoff', 'Handoff ZIP'), desc: t('editor.export.descHandoff', 'Everything bundled (PDF, PPTX, PNG, notes)'), icon: 'package', color: 'indigo', path: 'handoff.zip', open: 'tab' },
      ],
    },
  ];
}

/** Trigger a plain (non-PDF) export in a new tab or same-tab download. */
function runExport(id, path, lang, open) {
  const url = buildExportUrl(`/api/presentations/${id}/export/${path}`, lang);
  if (open === 'download') {
    location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Pull a filename out of a Content-Disposition header, else a fallback. */
function filenameFromDisposition(cd, fallback) {
  if (!cd) return fallback;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Save a blob to disk via a transient anchor. */
function saveBlob(blob, filename) {
  const objUrl = URL.createObjectURL(blob);
  const a = h('a', { href: objUrl, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
}

/**
 * The PDF flow: fetch the server-rendered PDF synchronously (so we can detect
 * success/failure directly), download it, and only on error/timeout reveal the
 * browser-print fallback.
 */
async function exportPdf({ id, getLang, title, button, fallbackWrap }) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = t('editor.export.pdfBusy', 'Generating PDF…');
  fallbackWrap.hidden = true;
  fallbackWrap.replaceChildren();

  const lang = getLang();
  // ?sync=1 forces the synchronous render path, so the response is the PDF
  // bytes (or an error) rather than a 202 job hand-off we'd have to poll.
  const url = buildExportUrl(`/api/presentations/${id}/export/pdf-slides.pdf?sync=1`, lang);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const filename = filenameFromDisposition(
      res.headers.get('Content-Disposition'),
      `${title || 'export'}.pdf`
    );
    saveBlob(blob, filename);
  } catch (err) {
    // Reveal the browser-print fallback: open the printable slide page in a new
    // tab, where the user does Cmd/Ctrl-P → Save as PDF.
    const printUrl = buildExportUrl(`/api/presentations/${id}/export/pdf-slides`, getLang());
    const fallbackBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.export.pdfFallbackBtn', 'Print in browser'),
      onclick: () => window.open(printUrl, '_blank', 'noopener,noreferrer'),
    });
    fallbackWrap.replaceChildren(
      h('span', { class: 'help', text: t('editor.export.pdfFailed', 'PDF render failed or timed out. Print it in the browser instead:') }),
      fallbackBtn
    );
    fallbackWrap.hidden = false;
    if (err?.name !== 'AbortError') {
      toast(t('editor.export.pdfError', 'Could not generate the PDF.'), 'error');
    }
  } finally {
    clearTimeout(timer);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/** Build one format row (icon + meta + action button(s)). */
function buildFormatRow(fmt, { id, getLang, title }) {
  const icon = h('span', {
    class: 'export-format-icon',
    'data-color': fmt.color,
    'aria-hidden': 'true',
    style: `--fmt-icon: url('${LUCIDE(fmt.icon)}');`,
  });
  const meta = h('span', { class: 'export-format-meta' }, [
    h('span', { class: 'export-format-name', text: fmt.name }),
    h('span', { class: 'export-format-desc', text: fmt.desc }),
  ]);
  const actions = h('span', { class: 'export-format-actions' });
  const row = h('div', { class: 'export-format-row' }, [icon, meta, actions]);

  // Make the whole strip trigger a single primary action, so the reader doesn't
  // have to hunt for the small button. Rows with two actions (Notes) opt out —
  // there is no unambiguous primary there. Clicks that land on the button/link
  // itself are ignored here so the action never fires twice.
  const makeClickable = (trigger) => {
    row.classList.add('is-clickable');
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      trigger();
    });
  };

  if (fmt.key === 'pdf') {
    const fallbackWrap = h('div', { class: 'export-format-fallback', hidden: true });
    const btn = h('button', {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      text: t('editor.export.exportAction', 'Export'),
      onclick: () => exportPdf({ id, getLang, title, button: btn, fallbackWrap }),
    });
    actions.append(btn);
    makeClickable(() => btn.click());
    return h('div', { class: 'export-format-rowwrap' }, [row, fallbackWrap]);
  }

  if (Array.isArray(fmt.actions)) {
    for (const action of fmt.actions) {
      actions.append(
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: action.label,
          onclick: () => runExport(id, action.path, getLang(), action.open),
        })
      );
    }
    return row;
  }

  actions.append(
    h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.export.exportAction', 'Export'),
      onclick: () => runExport(id, fmt.path, getLang(), fmt.open),
    })
  );
  makeClickable(() => runExport(id, fmt.path, getLang(), fmt.open));

  // The self-contained HTML export is the offline twin of Publish (same build).
  // Point users at the hosted, always-current alternative so they can choose.
  if (fmt.key === 'html') {
    const hint = h('div', {
      class: 'export-format-hint',
      text: t(
        'editor.export.publishHint',
        'Want a link that stays current and revocable? Publish it from the Share menu.'
      ),
    });
    return h('div', { class: 'export-format-rowwrap' }, [row, hint]);
  }

  return row;
}

/**
 * Open the export modal for a presentation.
 *
 * @param {Object} opts
 * @param {Object} opts.pres - Presentation data
 * @param {string} opts.id - Presentation ID
 * @param {HTMLElement} opts.root - Element to append the modal to
 * @param {Set} [opts.overlayClosers] - Overlay-closer set for cleanup
 * @returns {Object} Modal API
 */
export function openExportModal({ pres, id, root, overlayClosers }) {
  const activeLang = normalizeLang(pres?.i18n?.active) || 'nl';
  const other = otherLang(activeLang);
  const hasOther = other && hasLangVersion(pres, other);
  const title = pres?.title || pres?.meta?.title || 'export';

  let currentLang = activeLang;
  const getLang = () => currentLang;

  const modal = openModal(
    h,
    root,
    {
      title: t('editor.export.title', 'Export to file'),
      modalClass: 'export-modal',
    },
    overlayClosers
  );

  // Language toggle - only when the deck actually has both languages.
  if (hasOther) {
    const langRow = h('div', { class: 'export-lang-row' });
    const label = h('span', { class: 'field-label', text: t('editor.export.langLabel', 'Language') });
    const seg = createSegmented({
      h,
      ariaLabel: t('editor.export.langLabel', 'Language'),
      value: activeLang,
      segments: [
        { value: 'nl', label: 'NL' },
        { value: 'en', label: 'EN' },
      ],
      onSelect: (val) => {
        currentLang = val;
      },
    });
    langRow.append(label, seg.el);
    modal.append(langRow);
  }

  const list = h('div', { class: 'export-format-list' });
  for (const group of exportGroups()) {
    list.append(h('div', { class: 'export-format-group', text: group.title }));
    for (const fmt of group.formats) {
      list.append(buildFormatRow(fmt, { id, getLang, title }));
    }
  }
  modal.append(list);

  return modal;
}
