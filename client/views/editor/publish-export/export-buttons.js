import { buildExportUrl } from './urls.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Export button configurations.
 * @type {Array<{label: string, path: string, useLocationHref?: boolean}>}
 */
const EXPORT_TYPES = [
  { label: 'editor.export.printText', fallback: 'Print text', path: 'pdf' },
  { label: null, fallback: 'PDF', path: 'pdf-slides.pdf' },
  { label: null, fallback: 'PNG', path: 'png' },
  { label: null, fallback: 'PPTX', path: 'pptx' },
  { label: null, fallback: 'Handoff ZIP', path: 'handoff.zip' },
  { label: null, fallback: 'Notes (MD)', path: 'notes.md' },
  { label: null, fallback: 'Notes (DOCX)', path: 'notes.docx' },
  { label: null, fallback: 'HTML', path: 'html', useLocationHref: true },
  { label: null, fallback: 'JSON', path: 'json', useLocationHref: true },
];

/**
 * Create export buttons for a given language.
 * @param {Object} params
 * @param {Function} params.h - DOM element factory
 * @param {string} params.id - Presentation ID
 * @param {string} params.lang - Language code ('nl' or 'en')
 * @param {Function} params.closeDropdown - Function to close the dropdown
 * @returns {HTMLElement[]} Array of button elements
 */
export function createExportButtons({ h, id, lang, closeDropdown }) {
  return EXPORT_TYPES.map(({ label, fallback, path, useLocationHref }) => {
    const text = label ? t(label, fallback) : fallback;
    return h('button', {
      class: 'dropdown-item',
      type: 'button',
      text,
      onclick: () => {
        closeDropdown();
        const url = buildExportUrl(`/api/presentations/${id}/export/${path}`, lang);
        if (useLocationHref) {
          location.href = url;
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      },
    });
  });
}

/**
 * Create the export header element.
 * @param {Object} params
 * @param {Function} params.h - DOM element factory
 * @param {string} params.lang - Language code
 * @returns {HTMLElement}
 */
export function createExportHeader({ h, lang }) {
  return h('div', {
    class: 'help dropdown-help',
    text: t('editor.export.header', 'Export ({lang})', {
      lang: lang === 'nl' ? 'NL' : 'EN',
    }),
  });
}

/**
 * Create export section for the "other" language if available.
 * @param {Object} params
 * @param {Function} params.h - DOM element factory
 * @param {string} params.id - Presentation ID
 * @param {string} params.otherLang - Other language code
 * @param {Function} params.closeDropdown - Function to close the dropdown
 * @returns {HTMLElement}
 */
export function createOtherLangExportSection({ h, id, otherLang, closeDropdown }) {
  return h('div', {}, [
    h('div', { class: 'dropdown-sep' }),
    createExportHeader({ h, lang: otherLang }),
    ...createExportButtons({ h, id, lang: otherLang, closeDropdown }),
  ]);
}
