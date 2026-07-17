/**
 * Export dropdown - file download options (PDF, PNG, PPTX, etc.)
 */

import { normalizeLang, hasLangVersion, otherLang } from '../../lib/i18n.js';
import { buildExportUrl } from './publish-export/urls.js';
import { t } from '../../lib/ui-i18n.js';
import { createDropdown } from '../../lib/dropdown.js';

export function setupExportDropdown({
  h,
  pres,
  id,
} = {}) {
  const { details: exportDetails, menu, close, detach } = createDropdown({
    h,
    triggerClass: 'btn btn-secondary',
    label: t('editor.export.button', 'Export'),
    title: t('editor.export.title', 'Export to file'),
  });

  const lang = normalizeLang(pres?.i18n?.active) || 'nl';
  const langLabel = lang === 'nl' ? 'NL' : 'EN';

  const exportHeader = h('div', {
    class: 'help dropdown-help',
    text: t('editor.export.header', 'Export ({lang})', { lang: langLabel }),
  });

  const createExportButton = (label, exportPath, openInTab = true) => {
    return h('button', {
      class: 'dropdown-item',
      type: 'button',
      text: label,
      onclick: () => {
        close();
        const url = buildExportUrl(`/api/presentations/${id}/export/${exportPath}`, lang);
        if (openInTab) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          location.href = url;
        }
      },
    });
  };

  const exportButtons = [
    createExportButton('PDF', 'pdf-slides.pdf'),
    createExportButton(t('editor.export.pdfPrint', 'PDF (print in browser)'), 'pdf-slides'),
    createExportButton('PNG', 'png'),
    createExportButton('PPTX', 'pptx'),
    createExportButton('HTML', 'html', false),
    createExportButton('JSON', 'json', false),
    h('div', { class: 'dropdown-sep' }),
    createExportButton(t('editor.export.printText', 'Print text'), 'pdf'),
    createExportButton(t('editor.export.notesMd', 'Notes (Markdown)'), 'notes.md'),
    createExportButton(t('editor.export.notesDocx', 'Notes (Word)'), 'notes.docx'),
    createExportButton(t('editor.export.handoff', 'Handoff ZIP'), 'handoff.zip'),
  ];

  menu.append(exportHeader, ...exportButtons);

  // Other language exports if available
  const other = otherLang(lang);
  if (other && hasLangVersion(pres, other)) {
    const otherLabel = other === 'nl' ? 'NL' : 'EN';
    const otherHeader = h('div', {
      class: 'help dropdown-help',
      text: t('editor.export.header', 'Export ({lang})', { lang: otherLabel }),
    });

    const createOtherExportButton = (label, exportPath, openInTab = true) => {
      return h('button', {
        class: 'dropdown-item',
        type: 'button',
        text: label,
        onclick: () => {
          exportDetails.open = false;
          const url = buildExportUrl(`/api/presentations/${id}/export/${exportPath}`, other);
          if (openInTab) {
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            location.href = url;
          }
        },
      });
    };

    const otherExportButtons = [
      createOtherExportButton('PDF', 'pdf-slides.pdf'),
      createOtherExportButton('PNG', 'png'),
      createOtherExportButton('PPTX', 'pptx'),
      createOtherExportButton('HTML', 'html', false),
      createOtherExportButton('JSON', 'json', false),
    ];

    menu.append(h('div', { class: 'dropdown-sep' }), otherHeader, ...otherExportButtons);
  }

  return { exportEl: exportDetails, detach };
}