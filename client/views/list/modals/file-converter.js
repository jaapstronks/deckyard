import { t } from '../../../lib/ui-i18n.js';
import { showLoadingModal } from '../../../lib/loading-modal.js';
import { createMessageRotator } from '../../../lib/status-message-rotator.js';
import { processSSEStream } from '../../../lib/sse.js';
import { populateThemes } from '../../../lib/theme-select.js';
import { readFileAsDataUrl } from '../../../lib/file.js';
import { createLlmSelector } from '../../../lib/llm-vendor.js';
import { createQuickModal as createModal, createModalStatus } from '../../../lib/modal.js';
import { DEFAULT_THEME_ID, DEFAULT_THEME_NAME } from '../../../../shared/constants/themes.js';

export function openFileConverter({
  h,
  api,
  root,
  nav,
} = {}) {
  let selectedFile = null;

  // Create modal using shared utility
  const modal = createModal({
    h,
    root,
    title: t('list.fileConverter.title', 'Convert File to Presentation'),
    className: 'modal-lg',
  });

  const help = h('div', {
    class: 'help modal-hint',
    text: t(
      'list.fileConverter.help',
      'Upload a .pptx, .pdf, .docx, .rtf, or .odt file to convert it into a presentation. The converter will extract content and use AI to create appropriate slides. Review the result afterwards.'
    ),
  });

  // File input
  const fileInputWrap = h('div', { class: 'stack modal-field' });
  const fileLabel = h('div', { class: 'field-label', text: t('list.fileConverter.file', 'File') });
  const fileRow = h('div', { class: 'row' });
  const fileInput = h('input', {
    type: 'file',
    accept: '.pptx,.pdf,.docx,.rtf,.odt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,application/vnd.oasis.opendocument.text',
    class: 'form-input',
  });
  const fileInfo = h('div', { class: 'help', text: t('list.fileConverter.noFile', 'No file selected') });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      selectedFile = file;
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      fileInfo.textContent = `${file.name} (${sizeMB} MB)`;
      btnConvert.disabled = false;
    } else {
      selectedFile = null;
      fileInfo.textContent = t('list.fileConverter.noFile', 'No file selected');
      btnConvert.disabled = true;
    }
  });

  fileRow.append(fileInput);
  fileInputWrap.append(fileLabel, fileRow, fileInfo);

  // LLM vendor selection
  const llmSelector = createLlmSelector({ h, api });

  // Theme selection
  let themeId = DEFAULT_THEME_ID;
  const themeWrap = h('div', { class: 'stack modal-field-narrow' });
  const themeLabel = h('div', { class: 'field-label', text: t('common.theme', 'Theme') });
  const themeSelect = h('select', { class: 'form-input is-compact' });
  themeSelect.append(
    h('option', { value: DEFAULT_THEME_ID, text: DEFAULT_THEME_NAME }),
    h('option', { value: 'clicknl', text: 'ClickNL' })
  );
  themeSelect.value = themeId;
  themeSelect.addEventListener('change', () => {
    themeId = String(themeSelect.value || DEFAULT_THEME_ID) || DEFAULT_THEME_ID;
  });
  themeWrap.append(themeLabel, themeSelect);

  // Populate themes from server
  populateThemes({
    api,
    h,
    select: themeSelect,
    currentTheme: themeId,
    onPopulated: (resolvedTheme) => {
      themeId = resolvedTheme;
    },
  });

  // Status and report
  const status = createModalStatus(h);
  const reportWrap = h('div', { class: 'stack modal-report is-hidden' });

  // Actions
  const actions = h('div', { class: 'row is-end modal-actions' });

  const setBusy = (v) => {
    modal.setBusy(v);
    btnConvert.disabled = v || !selectedFile;
    btnCancel.disabled = v;
    fileInput.disabled = v;
    themeSelect.disabled = v;
    llmSelector.setDisabled(v);
  };

  const renderReport = (report) => {
    reportWrap.innerHTML = '';
    reportWrap.classList.remove('is-hidden');

    if (report.slidesExtracted) {
      reportWrap.append(
        h('div', {
          class: 'help',
          text: t(
            'list.fileConverter.report.extracted',
            'Extracted {count} slides from the source file.',
            { count: report.slidesExtracted }
          ),
        })
      );
    }

    if (report.slidesConverted) {
      reportWrap.append(
        h('div', {
          class: 'help',
          text: t(
            'list.fileConverter.report.converted',
            'Created {count} slides in the new presentation.',
            { count: report.slidesConverted }
          ),
        })
      );
    }

    if (report.warnings?.length > 0) {
      const warningsEl = h('div', { class: 'modal-warnings' });
      warningsEl.append(
        h('div', {
          class: 'field-label',
          text: t('list.fileConverter.report.warnings', 'Warnings'),
        })
      );
      for (const w of report.warnings) {
        warningsEl.append(h('div', { class: 'help is-warning', text: `Warning: ${w}` }));
      }
      reportWrap.append(warningsEl);
    }

    if (report.slidesWithIssues?.length > 0) {
      const issuesEl = h('div', { class: 'modal-issues' });
      issuesEl.append(
        h('div', {
          class: 'field-label',
          text: t('list.fileConverter.report.needsReview', 'Slides that may need review'),
        })
      );
      for (const issue of report.slidesWithIssues) {
        issuesEl.append(
          h('div', {
            class: 'help',
            text: `Slide ${issue.slideNumber} (${issue.type}): ${issue.reason}`,
          })
        );
      }
      reportWrap.append(issuesEl);
    }
  };

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.requestClose(),
  });

  const btnConvert = h('button', {
    class: 'btn btn-primary',
    text: t('list.fileConverter.convert', 'Convert'),
    disabled: true,
    onclick: async () => {
      if (!selectedFile) {
        status.setText(t('list.fileConverter.selectFirst', 'Select a file first.'));
        return;
      }

      status.setText(t('list.fileConverter.reading', 'Reading file...'));
      reportWrap.classList.add('is-hidden');
      setBusy(true);

      let dataUrl;
      try {
        dataUrl = await readFileAsDataUrl(selectedFile);
      } catch (e) {
        status.setText(String(e.message || e));
        setBusy(false);
        return;
      }

      // Hide the converter modal and show loading modal
      modal.hide();

      const loadingModal = showLoadingModal({
        h,
        root,
        initialMessage: t('list.fileConverter.converting', 'Converting file...'),
        title: t('list.fileConverter.convertingTitle', 'Converting file'),
      });

      loadingModal.setProgress(5);

      const rotator = createMessageRotator({
        onUpdate: (message, progress) => {
          loadingModal.update(message);
          loadingModal.setProgress(progress);
        },
      });

      try {
        // Try streaming endpoint first for better UX
        let useStreaming = true;
        let result = null;

        try {
          const response = await fetch('/api/convert/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              filename: selectedFile.name,
              lang: 'auto',
              theme: themeId,
              ...(llmSelector.getVendor() ? { vendor: llmSelector.getVendor() } : {}),
            }),
          });

          if (!response.ok || !response.body) {
            useStreaming = false;
          } else {
            let streamComplete = false;
            let streamError = false;

            await processSSEStream(response.body, {
              onStatus: (data) => {
                const phase = data?.phase || '';
                if (phase === 'finalize' || phase === 'save' || !rotator.getState().messages.length) {
                  rotator.stop();
                  loadingModal.update(data?.message || '');
                  if (data?.progress) loadingModal.setProgress(data.progress);
                }
              },
              onMessages: (data) => {
                rotator.setMessages(data?.statusMessages || []);
                rotator.start();
              },
              onComplete: async (data) => {
                streamComplete = true;
                rotator.stop();
                result = data;
                const detectedLang = result.detectedLang || result.presentation?.lang || 'nl';
                loadingModal.update(t('common.done', 'Done!'));
                loadingModal.setProgress(100);

                await new Promise((r) => setTimeout(r, 800));
                loadingModal.close();
                modal.close();
                nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`);
              },
              onError: (data) => {
                streamError = true;
                rotator.stop();
                loadingModal.close();
                modal.unhide();
                status.setText(data?.error || t('list.fileConverter.failed', 'Conversion failed.'));
                if (data?.report) renderReport(data.report);
                setBusy(false);
              },
            });

            if (streamComplete || streamError) return;
          }
        } catch {
          useStreaming = false;
        }

        // Fallback to regular endpoint
        if (!useStreaming) {
          loadingModal.update(t('list.fileConverter.converting', 'Converting file...'));

          const result = await api('/api/convert', {
            method: 'POST',
            body: JSON.stringify({
              dataUrl,
              filename: selectedFile.name,
              lang: 'auto',
              theme: themeId,
              ...(llmSelector.getVendor() ? { vendor: llmSelector.getVendor() } : {}),
            }),
          });

          if (result.success && result.presentation) {
            const detectedLang = result.detectedLang || result.presentation?.lang || 'nl';
            loadingModal.update(t('common.done', 'Done!'));
            loadingModal.setProgress(100);

            await new Promise((r) => setTimeout(r, 800));
            loadingModal.close();
            modal.close();
            nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`);
          } else {
            loadingModal.close();
            modal.unhide();
            status.setText(result.error || t('list.fileConverter.failed', 'Conversion failed.'));
            if (result.report) {
              renderReport(result.report);
            }
            setBusy(false);
          }
        }
      } catch (e) {
        rotator.stop();
        loadingModal.close();
        modal.unhide();
        status.setText(String(e.message || e));
        setBusy(false);
      }
    },
  });

  actions.append(btnCancel, btnConvert);

  modal.append(
    help,
    fileInputWrap,
    llmSelector.wrap,
    themeWrap,
    reportWrap,
    status.el,
    actions
  );

  modal.show();
  fileInput.focus();
}