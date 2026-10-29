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
 *
 * Every other file row fetches its file itself (B715) and a failure sits
 * under the row. A row used to open its download URL in a new tab, which
 * stayed blank for the minute a large PowerPoint or handoff takes, and showed
 * a `202` JSON blob on an instance with a job queue. Only the two preview
 * pages (PNG, text handout) still open in a tab: they are pages to look at,
 * not files.
 *
 * An export that renders in Chrome is a long task (B716): PDF, the PNG ZIP,
 * both PowerPoints and the handoff ZIP run in the loading modal, with the
 * slide counter and a Cancel that stops the server
 * (`publish-export/export-download.js`). The quick files (HTML, notes, .deck,
 * JSON) keep the busy button.
 *
 * The slide PDF and the PNG ZIP export all slides, the current one or a
 * selection (B871): the choice above the list adds `?slides=` to those two
 * rows' URLs, the server reads it, and a selection it refuses is shown under
 * the choice, the field it names.
 */

import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { openModal } from '../../lib/dom/modal.js';
import { toast } from '../../lib/dom/toast.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { normalizeLang } from '../../lib/format/i18n.js';
import { createSegmented } from '../../lib/dom/segmented.js';
import { buildExportUrl } from './publish-export/urls.js';
import {
  downloadExport,
  streamExport,
} from './publish-export/export-download.js';
import { DEFAULT_DECK_LANG } from '../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../shared/i18n-progress.js';
import { getLangShortLabel } from '../../lib/dom/lang-selector.js';
import { getFeatures } from '../../lib/state/features.js';
import { IMAGE_SLIDES_HEADER } from '../../../shared/export-headers.js';
import { spellSlideSelection } from '../../../shared/slide-selection.js';

const LUCIDE = (name) => `/client/vendor/lucide-icons/${name}.svg`;

// Client-side ceiling for the synchronous PDF render before we offer the
// browser-print fallback. The server's own cap is EXPORT_RENDER_TIMEOUT_MS (120s);
// we bail a little sooner so the user isn't left staring at a dead spinner.
const PDF_FETCH_TIMEOUT_MS = 90_000;

/**
 * Describe the export format groups. Called at open time so labels pick up the
 * current locale. `path` is the export route segment. A `preview` row opens a
 * page in a new tab; every other row downloads a file, saved as the server
 * names it or, failing that, the deck title plus `file`. A `stream` row is a
 * long task: it asks the route's streamed twin and runs in the loading modal
 * (B716). `afterDownload` reads the response headers of a successful
 * download. A row with two buttons (PNG, Notes) carries them in `actions`,
 * each with the same fields.
 * `allLanguages` marks a format that carries every language version itself
 * (the portable deck, D89): its URL takes no `?lang=`, since the route ignores
 * one. `selectable` marks an export that takes the slide choice (B871). PDF is
 * special-cased in the row builder.
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
          selectable: true,
        },
        {
          key: 'png',
          name: 'PNG',
          desc: t('editor.export.descPng', 'Image of each slide'),
          icon: 'image',
          color: 'green',
          actions: [
            {
              label: t('editor.export.pngView', 'View'),
              path: 'png',
              preview: true,
            },
            {
              label: 'ZIP',
              path: 'png.zip',
              file: '-png.zip',
              stream: true,
              selectable: true,
            },
          ],
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
          file: '.pptx',
          stream: true,
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
          path: 'pptx-editable',
          file: '-editable.pptx',
          stream: true,
          afterDownload: announceImageSlides,
        },
        {
          key: 'html',
          name: 'HTML',
          desc: t('editor.export.descHtml', 'Self-contained web page'),
          icon: 'code-xml',
          color: 'blue',
          path: 'html',
          file: '.html',
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
          preview: true,
        },
        {
          key: 'notes',
          name: t('editor.export.notes', 'Notes'),
          desc: t('editor.export.descNotes', 'Speaker notes'),
          icon: 'notebook',
          color: 'purple',
          actions: [
            { label: 'Markdown', path: 'notes.md', file: '-notes.md' },
            {
              label: t('editor.export.notesWordShort', 'Word'),
              path: 'notes.docx',
              file: '-notes.docx',
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
          file: '.deck',
          allLanguages: true,
        },
        {
          key: 'json',
          name: 'JSON',
          desc: t('editor.export.descJson', 'Raw deck data'),
          icon: 'database',
          color: 'slate',
          path: 'json',
          file: '.json',
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
          file: '-handoff.zip',
          stream: true,
        },
      ],
    },
  ];
}

/**
 * Open one of the preview pages (PNG, text handout) in a new tab: a page the
 * reader looks at and prints from, served at once, not a file to wait for.
 */
function openPreview(id, path, lang) {
  window.open(
    buildExportUrl(`/api/presentations/${id}/export/${path}`, lang),
    '_blank',
    'noopener,noreferrer',
  );
}

/**
 * The URL a download row fetches. `?sync=1` makes a queue-backed route answer
 * with the file rather than a `202` job hand-off nobody here polls; a route
 * without a queue ignores it.
 */
function downloadUrl(id, path, lang, slides) {
  return buildExportUrl(
    `/api/presentations/${id}/export/${path}?sync=1`,
    lang,
    { slides },
  );
}

/** The streamed twin of a Chrome export route (B716). */
function streamUrl(id, path, lang, slides) {
  return buildExportUrl(
    `/api/presentations/${id}/export/${path}/stream`,
    lang,
    { slides },
  );
}

/** A refusal of the slide selection: it belongs under the slide choice. */
function isSlidesRefusal(err) {
  return err?.code === 'invalid' && err?.details?.field === 'slides';
}

/**
 * The slide choice for the slide PDF and the PNG ZIP (B871): all slides, the
 * current one or a typed selection, prefilled with the slides selected in the
 * slide list. The server reads the selection; its refusal shows here.
 *
 * @param {{ current: number|null, selected: number[] }} numbers
 * @returns {{ el: HTMLElement, getSlides: () => (string|null),
 *   showRefusal: (err: Error) => void }}
 */
function createSlideChoice({ current, selected }) {
  const label = t('editor.export.slidesLabel', 'Which slides');
  const input = h('input', {
    type: 'text',
    class: 'form-input form-input-sm export-slides-input',
    inputmode: 'numeric',
    placeholder: '1,3-5',
    'aria-label': t('editor.export.slidesInput', 'Slide numbers'),
    value: spellSlideSelection(
      selected.length > 1 ? selected : current ? [current] : [],
    ),
    hidden: true,
  });
  const help = h('p', {
    class: 'help export-slides-help',
    text: t(
      'editor.export.slidesHelp',
      'For PDF and the PNG ZIP. Type slide numbers and ranges, such as 1,3-5.',
    ),
    hidden: true,
  });
  const error = createInlineError();
  let choice = 'all';
  const seg = createSegmented({
    ariaLabel: label,
    value: choice,
    segments: [
      { value: 'all', label: t('editor.export.slidesAll', 'All slides') },
      ...(current
        ? [
            {
              value: 'current',
              label: t('editor.export.slidesCurrent', 'Current slide ({n})', {
                n: String(current),
              }),
            },
          ]
        : []),
      {
        value: 'selection',
        label: t('editor.export.slidesSelection', 'Selection'),
      },
    ],
    onSelect: (val) => {
      choice = val;
      input.hidden = val !== 'selection';
      help.hidden = val === 'all';
      error.clear();
      if (val === 'selection') input.focus();
    },
  });
  input.addEventListener('input', () => error.clear());

  const el = h('div', { class: 'export-slides' }, [
    h('div', { class: 'export-lang-row export-slides-row' }, [
      h('span', { class: 'field-label', text: label }),
      seg.el,
      input,
    ]),
    help,
    error.el,
  ]);

  return {
    el,
    getSlides: () => {
      error.clear();
      if (choice === 'current') return String(current);
      if (choice === 'selection') return input.value.trim();
      return null;
    },
    showRefusal: (err) => {
      error.show(err.message, {
        control: choice === 'selection' ? input : null,
      });
    },
  };
}

/**
 * After the editable PowerPoint: say which slides became pictures, read from
 * the response header, since "editable" that is partly images has to say
 * where (D141). Silent when every slide is editable.
 *
 * @param {Headers} headers
 */
function announceImageSlides(headers) {
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
}

/**
 * The download flow of every file row but PDF. A quick file: the button says
 * it is busy and takes no second click while the server builds it. A long
 * task (`stream`): the loading modal says how far it is and can cancel it.
 * Either way a failure (a refused deck, `503 browser_unavailable`) is a state
 * of this row, shown under it until the next attempt, not a toast.
 *
 * @param {Object} opts
 * @param {string} opts.id - presentation id
 * @param {{ path: string, file: string, stream?: boolean }} opts.download
 * @param {string|null} opts.lang
 * @param {string} opts.fallbackName - used when the response names no file
 * @param {string} opts.title - the loading modal's title for a long task
 * @param {HTMLButtonElement} opts.button
 * @param {{ clear: Function, show: Function }} opts.error - the row's inline error
 * @param {(headers: Headers) => void} [opts.afterDownload]
 * @param {string|null} [opts.slides] - the slide selection, for a
 *   `selectable` download
 * @param {(err: Error) => void} [opts.onSlidesRefusal] - shows a refused
 *   selection under the slide choice
 */
async function exportDownload({
  id,
  download,
  lang,
  fallbackName,
  title,
  button,
  error,
  afterDownload,
  slides = null,
  onSlidesRefusal,
}) {
  error.clear();
  const originalLabel = button.textContent;
  button.disabled = true;
  if (!download.stream) {
    button.textContent = t('editor.export.downloadBusy', 'Preparing…');
  }
  try {
    const headers = download.stream
      ? await streamExport({
          url: streamUrl(id, download.path, lang, slides),
          title,
          fallbackName,
        })
      : await downloadExport(
          downloadUrl(id, download.path, lang, slides),
          fallbackName,
        );
    if (headers) afterDownload?.(headers);
  } catch (err) {
    if (isSlidesRefusal(err) && onSlidesRefusal) onSlidesRefusal(err);
    else error.show(err.message, { focus: false });
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/**
 * The PDF flow: the server-rendered PDF as a long task (one Chrome document,
 * so its bar creeps), downloaded when it completes; only on a failure or a
 * timeout does the browser-print fallback appear. A cancel is neither, and
 * neither is a refused slide selection: that shows under the slide choice.
 */
async function exportPdf({
  id,
  getLang,
  getSlides,
  onSlidesRefusal,
  title,
  button,
  fallbackWrap,
}) {
  button.disabled = true;
  fallbackWrap.hidden = true;
  fallbackWrap.replaceChildren();
  const slides = getSlides();

  try {
    await streamExport({
      url: streamUrl(id, 'pdf-slides.pdf', getLang(), slides),
      title: t('editor.export.progressTitle', 'Exporting {format}', {
        format: 'PDF',
      }),
      fallbackName: `${title || 'export'}.pdf`,
      timeoutMs: PDF_FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    if (isSlidesRefusal(err)) {
      onSlidesRefusal(err);
      return;
    }
    // Reveal the browser-print fallback: open the printable slide page in a new
    // tab, where the user does Cmd/Ctrl-P → Save as PDF.
    const printUrl = buildExportUrl(
      `/api/presentations/${id}/export/pdf-slides`,
      getLang(),
      { slides },
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
    if (err?.code !== 'timeout') {
      // streamExport throws the server's sentence when it sent one.
      toast.error(err);
    }
  } finally {
    button.disabled = false;
  }
}

/** Build one format row (icon + meta + action button(s)). */
function buildFormatRow(
  fmt,
  { id, getLang, getSlides, onSlidesRefusal, title, openPublic },
) {
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
        exportPdf({
          id,
          getLang,
          getSlides,
          onSlidesRefusal,
          title,
          button: btn,
          fallbackWrap,
        }),
    });
    actions.append(btn);
    makeClickable(() => btn.click());
    return h('div', { class: 'export-format-rowwrap' }, [row, fallbackWrap]);
  }

  const lang = () => (fmt.allLanguages ? null : getLang());

  // One button per action (PNG and Notes have two), one inline error under
  // the row for whichever download failed last. A preview action opens its
  // page; every other one fetches a file.
  const error = createInlineError();
  const downloads = fmt.actions || [
    {
      label: t('editor.export.exportAction', 'Export'),
      path: fmt.path,
      file: fmt.file,
      preview: fmt.preview,
      stream: fmt.stream,
    },
  ];
  for (const download of downloads) {
    const btn = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: download.label,
      onclick: () =>
        download.preview
          ? openPreview(id, download.path, lang())
          : exportDownload({
              id,
              download,
              lang: lang(),
              fallbackName: `${title || 'export'}${download.file}`,
              title: t('editor.export.progressTitle', 'Exporting {format}', {
                format: fmt.name,
              }),
              button: btn,
              error,
              afterDownload: fmt.afterDownload,
              slides: download.selectable ? getSlides() : null,
              onSlidesRefusal,
            }),
    });
    actions.append(btn);
    if (downloads.length === 1) makeClickable(() => btn.click());
  }
  const below = [error.el];

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
    below.push(hint);
  }

  return h('div', { class: 'export-format-rowwrap' }, [row, ...below]);
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
 * @param {() => { current: number|null, selected: number[] }} [opts.selectedSlideNumbers]
 *   - The editor's selected slides; with more than one slide in the deck the
 *   modal offers all slides, the current one or a selection (B871).
 * @returns {Object} Modal API
 */
export function openExportModal({
  pres,
  id,
  root,
  openPublic,
  selectedSlideNumbers,
}) {
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

  // The slide choice, for a deck with more than one slide.
  const slideChoice =
    (pres?.slides?.length || 0) > 1
      ? createSlideChoice(
          selectedSlideNumbers?.() || { current: null, selected: [] },
        )
      : null;
  if (slideChoice) modal.append(slideChoice.el);
  const getSlides = () => slideChoice?.getSlides() ?? null;
  const onSlidesRefusal = (err) =>
    slideChoice ? slideChoice.showRefusal(err) : toast.error(err);

  const publicAvailable = !!openPublic && !getFeatures()?.sandboxMode;
  const list = h('div', { class: 'export-format-list' });
  for (const group of exportGroups()) {
    list.append(h('div', { class: 'export-format-group', text: group.title }));
    for (const fmt of group.formats) {
      list.append(
        buildFormatRow(fmt, {
          id,
          getLang,
          getSlides,
          onSlidesRefusal,
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
