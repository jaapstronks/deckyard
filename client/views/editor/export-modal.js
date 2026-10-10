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

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { openModal } from '../../lib/dom/modal.js';
import { toast } from '../../lib/dom/toast.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { downloadBlob } from '../../lib/dom/download.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import { createSegmented } from '../../lib/dom/segmented.js';
import { buildExportUrl } from './publish-export/urls.js';
import { DEFAULT_DECK_LANG } from '../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../shared/i18n-progress.js';
import { getLangShortLabel } from '../../lib/format/lang-selector.js';
import { getFeatures } from '../../lib/state/features.js';
import { IMAGE_SLIDES_HEADER } from '../../../shared/export-headers.js';

const LUCIDE = (name) => `/client/vendor/lucide-icons/${name}.svg`;

// Client-side ceiling for the synchronous PDF render before we offer the
// browser-print fallback. The server's own cap is EXPORT_RENDER_TIMEOUT_MS (120s);
// we bail a little sooner so the user isn't left staring at a dead spinner.
const PDF_FETCH_TIMEOUT_MS = 90_000;

/**
 * Describe the export format groups. Called at open time so labels pick up the
 * current locale. `path` is the export route segment; `open` is how a plain
 * export is triggered ('tab' → new tab, 'download' → same-tab navigation).
 * `allLanguages` marks a format that carries every language version itself
 * (the portable deck, D89): its URL takes no `?lang=`, since the route ignores
 * one. PDF, the editable PowerPoint and Notes are special-cased in the row
 * builder.
 * @returns {Array<{key:string,title:string,formats:Array<object>}>}
 */
function exportGroups() {
  return [
    {
      key: 'slides',
      title: t('editor.export.groupSlides', 'Slides'),
      formats: [
        {
          key: 'pdf',
          name: 'PDF',
          desc: t('editor.export.descPdf', 'One slide per page (16:9)'),
          icon: 'file-text',
          color: 'red',
        },
        {
          key: 'png',
          name: 'PNG',
          desc: t('editor.export.descPng', 'Image of each slide'),
          icon: 'image',
          color: 'green',
          path: 'png',
          open: 'tab',
        },
        // The two PowerPoint intents (D141): a file to show, and a file to
        // work in. Neither is the default, so they are two rows, not a mode.
        {
          key: 'pptx',
          name: t('editor.export.pptx', 'PowerPoint'),
          desc: t(
            'editor.export.descPptx',
            'Pixel-perfect: every slide as an image, videos play',
          ),
          icon: 'presentation',
          color: 'amber',
          path: 'pptx',
          open: 'tab',
        },
        {
          key: 'pptxEditable',
          name: t('editor.export.pptxEditable', 'PowerPoint, editable'),
          desc: t(
            'editor.export.descPptxEditable',
            "Text and pictures you can edit, on the theme's layouts",
          ),
          icon: 'presentation',
          color: 'amber',
        },
        {
          key: 'html',
          name: 'HTML',
          desc: t('editor.export.descHtml', 'Self-contained web page'),
          icon: 'code-xml',
          color: 'blue',
          path: 'html',
          open: 'download',
        },
      ],
    },
    {
      key: 'documents',
      title: t('editor.export.groupDocuments', 'Documents'),
      formats: [
        {
          key: 'textpdf',
          name: t('editor.export.textPdf', 'Text handout'),
          desc: t(
            'editor.export.descTextPdf',
            'Readable handout, no slide layout',
          ),
          icon: 'sticky-note',
          color: 'teal',
          path: 'pdf',
          open: 'tab',
        },
        {
          key: 'notes',
          name: t('editor.export.notes', 'Notes'),
          desc: t('editor.export.descNotes', 'Speaker notes'),
          icon: 'notebook',
          color: 'purple',
          actions: [
            { label: 'Markdown', path: 'notes.md', open: 'tab' },
            {
              label: t('editor.export.notesWordShort', 'Word'),
              path: 'notes.docx',
              open: 'tab',
            },
          ],
        },
      ],
    },
    {
      key: 'data',
      title: t('editor.export.groupData', 'Data & bundle'),
      formats: [
        {
          key: 'deck',
          name: '.deck',
          desc: t(
            'editor.export.descDeck',
            'Portable deck: every language, images, theme and slide types',
          ),
          icon: 'archive',
          color: 'indigo',
          path: 'deck.zip',
          open: 'download',
          allLanguages: true,
        },
        {
          key: 'json',
          name: 'JSON',
          desc: t('editor.export.descJson', 'Raw deck data'),
          icon: 'database',
          color: 'slate',
          path: 'json',
          open: 'download',
          allLanguages: true,
        },
        {
          key: 'handoff',
          name: t('editor.export.handoff', 'Handoff ZIP'),
          desc: t(
            'editor.export.descHandoff',
            'Everything bundled (PDF, PPTX, PNG, notes)',
          ),
          icon: 'package',
          color: 'indigo',
          path: 'handoff.zip',
          open: 'tab',
        },
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

/**
 * Fetch a synchronous export and save it under the server's filename.
 *
 * Binary download: the response is file bytes read as a blob, which api()'s
 * json/text contract cannot express. Resolves to the response's headers, so a
 * caller can read a finding the file itself cannot carry; throws on a failed
 * or aborted fetch.
 *
 * @param {string} url
 * @param {string} fallbackName - used when the response names no file
 * @param {AbortSignal} [signal]
 * @returns {Promise<Headers>}
 */
async function downloadExport(url, fallbackName, signal) {
  // eslint-disable-next-line no-restricted-syntax
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) {
    // The error envelope's sentence when the server sent one.
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(
      res.headers.get('Content-Disposition'),
      fallbackName,
    ),
  );
  return res.headers;
}

/**
 * The editable PowerPoint flow: fetch the file synchronously, save it, and say
 * which slides became pictures. The pixel-perfect row opens in a tab and needs
 * none of this; "editable" that is partly images has to say where (D141). A
 * failure is a state of this row, shown under it, like the PDF row's fallback.
 */
async function exportEditablePptx({ id, getLang, title, button, error }) {
  error.clear();
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = t('editor.export.pptxBusy', 'Building PowerPoint…');
  const url = buildExportUrl(
    `/api/presentations/${id}/export/pptx-editable?sync=1`,
    getLang(),
  );
  try {
    const headers = await downloadExport(
      url,
      `${title || 'export'}-editable.pptx`,
    );
    const imageSlides = (headers.get(IMAGE_SLIDES_HEADER) || '')
      .split(',')
      .filter(Boolean);
    if (imageSlides.length === 1) {
      toast.info(
        t(
          'editor.export.imageSlidesOne',
          'Slide {n} is an image: its type has no editable form yet.',
          { n: imageSlides[0] },
        ),
      );
    } else if (imageSlides.length > 1) {
      toast.info(
        t(
          'editor.export.imageSlidesMany',
          'Slides {list} are images: their type has no editable form yet.',
          { list: imageSlides.join(', ') },
        ),
      );
    }
  } catch (err) {
    error.show(err.message, { focus: false });
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
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
  const url = buildExportUrl(
    `/api/presentations/${id}/export/pdf-slides.pdf?sync=1`,
    lang,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);
  try {
    await downloadExport(url, `${title || 'export'}.pdf`, controller.signal);
  } catch (err) {
    // Reveal the browser-print fallback: open the printable slide page in a new
    // tab, where the user does Cmd/Ctrl-P → Save as PDF.
    const printUrl = buildExportUrl(
      `/api/presentations/${id}/export/pdf-slides`,
      getLang(),
    );
    const fallbackBtn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.export.pdfFallbackBtn', 'Print in browser'),
      onclick: () => window.open(printUrl, '_blank', 'noopener,noreferrer'),
    });
    fallbackWrap.replaceChildren(
      h('span', {
        class: 'help',
        text: t(
          'editor.export.pdfFailed',
          'PDF render failed or timed out. Print it in the browser instead:',
        ),
      }),
      fallbackBtn,
    );
    fallbackWrap.hidden = false;
    if (err?.name !== 'AbortError') {
      // downloadExport throws the envelope's sentence when the server sent one.
      toast.error(err);
    }
  } finally {
    clearTimeout(timer);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/** Build one format row (icon + meta + action button(s)). */
function buildFormatRow(fmt, { id, getLang, title, openPublic }) {
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
    const fallbackWrap = h('div', {
      class: 'export-format-fallback',
      hidden: true,
    });
    const btn = h('button', {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      text: t('editor.export.exportAction', 'Export'),
      onclick: () =>
        exportPdf({ id, getLang, title, button: btn, fallbackWrap }),
    });
    actions.append(btn);
    makeClickable(() => btn.click());
    return h('div', { class: 'export-format-rowwrap' }, [row, fallbackWrap]);
  }

  if (fmt.key === 'pptxEditable') {
    const error = createInlineError();
    const btn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.export.exportAction', 'Export'),
      onclick: () =>
        exportEditablePptx({ id, getLang, title, button: btn, error }),
    });
    actions.append(btn);
    makeClickable(() => btn.click());
    return h('div', { class: 'export-format-rowwrap' }, [row, error.el]);
  }

  if (Array.isArray(fmt.actions)) {
    for (const action of fmt.actions) {
      actions.append(
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: action.label,
          onclick: () => runExport(id, action.path, getLang(), action.open),
        }),
      );
    }
    return row;
  }

  const exportThis = () =>
    runExport(id, fmt.path, fmt.allLanguages ? null : getLang(), fmt.open);
  actions.append(
    h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('editor.export.exportAction', 'Export'),
      onclick: exportThis,
    }),
  );
  makeClickable(exportThis);

  // The self-contained HTML export is the offline twin of Publish (same build).
  // Point users at the hosted, always-current alternative, and at the embed
  // that only a published deck has: a link straight to the Share dialog's
  // Public tab, the mirror of that tab's "Export as a web page instead →".
  if (fmt.key === 'html' && openPublic) {
    const hint = h('div', { class: 'export-format-hint' }, [
      h('span', {
        text: t(
          'editor.export.publicHint',
          'Want a link that stays current, or an embed for Notion or your site? ',
        ),
      }),
      h('button', {
        type: 'button',
        class: 'link-button',
        text: t('editor.export.publicLink', 'Publish the deck →'),
        onclick: openPublic,
      }),
    ]);
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
 * @param {Function} [opts.openPublic] - Opens the Share dialog on its Public
 *   tab. Without it (or in sandbox mode, which has no publishing) the HTML row
 *   carries no hint.
 * @returns {Object} Modal API
 */
export function openExportModal({ pres, id, root, openPublic }) {
  const activeLang = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
  // Every other version this deck actually has, not "the other one": a deck
  // with `nl`, `de` and `fr` offered exactly one of them for export before.
  const otherLangs = existingVersionLangs(pres).filter((l) => l !== activeLang);
  const title = pres?.title || pres?.meta?.title || 'export';

  let currentLang = activeLang;
  const getLang = () => currentLang;

  const modal = openModal(root, {
    title: t('editor.export.title', 'Export to file'),
    modalClass: 'export-modal',
  });

  // Language picker - only when the deck actually has more than one version.
  if (otherLangs.length) {
    const langRow = h('div', { class: 'export-lang-row' });
    const label = h('span', {
      class: 'field-label',
      text: t('editor.export.langLabel', 'Language'),
    });
    const seg = createSegmented({
      ariaLabel: t('editor.export.langLabel', 'Language'),
      value: activeLang,
      // The languages this deck actually has, in axis spelling. The segments
      // were `nl`/`en` before D61 — `en` is the alias, so the English segment
      // never matched an `en-GB` active language.
      segments: [activeLang, ...otherLangs].map((code) => ({
        value: code,
        label: getLangShortLabel(code),
      })),
      onSelect: (val) => {
        currentLang = val;
      },
    });
    langRow.append(label, seg.el);
    modal.append(langRow);
  }

  const publicAvailable = !!openPublic && !getFeatures()?.sandboxMode;
  const list = h('div', { class: 'export-format-list' });
  for (const group of exportGroups()) {
    list.append(h('div', { class: 'export-format-group', text: group.title }));
    for (const fmt of group.formats) {
      list.append(
        buildFormatRow(fmt, {
          id,
          getLang,
          title,
          openPublic: publicAvailable
            ? () => {
                modal.close();
                openPublic();
              }
            : null,
        }),
      );
    }
  }
  modal.append(list);

  return modal;
}
