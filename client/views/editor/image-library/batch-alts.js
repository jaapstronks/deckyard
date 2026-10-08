import { h } from '../../../lib/dom/index.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { aiAltTextEnabled } from '../../../lib/state/features.js';
import { runBatchTasks } from '../media/batch-runner.js';

/** Batch-only consent and preview generation; never reads the single-upload preference. */
export function createBatchAlts({
  api,
  rows,
  rowForm,
  canStart,
  canContinue,
  isClosed,
  setBusy,
  rowChanged,
}) {
  if (!aiAltTextEnabled()) return null;
  let running = false;
  let stopRequested = false;
  const missing = (row) =>
    Object.keys(row.altInputs).filter(
      (lang) => !row.altInputs[lang].value.trim(),
    );
  const candidates = () =>
    rows.filter(
      (row) =>
        row.uploadStatus === 'uploaded' &&
        ['idle', 'failed'].includes(row.saveStatus) &&
        missing(row).length,
    );
  const generate = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    onclick: () => start(candidates()),
  });
  const stop = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    hidden: true,
    text: t('imageLibrary.batch.aiStop', 'Stop AI generation'),
    onclick: () => {
      stopRequested = true;
      stop.disabled = true;
      status.textContent = t(
        'imageLibrary.batch.aiStopping',
        'Stopping after current AI requests. Already sent requests may still incur costs.',
      );
    },
  });
  const status = h('p', { class: 'help', role: 'status' });
  const el = h('div', { class: 'stack is-gap-2' }, [
    h('div', { class: 'row is-wrap' }, [generate, stop]),
    status,
  ]);

  function update() {
    if (isClosed()) return;
    const eligible = candidates();
    for (const row of rows) {
      if (!row.aiRetry) continue;
      row.aiRetry.hidden = row.aiStatus !== 'failed' || !eligible.includes(row);
      row.aiRetry.disabled = running || !canStart();
    }
    generate.textContent = t(
      'imageLibrary.batch.aiGenerate',
      {
        one: 'Generate missing alt text for 1 image',
        many: 'Generate missing alt text for {count} images',
      },
      { count: eligible.length },
    );
    generate.disabled = running || !canStart() || !eligible.length;
  }

  async function start(selected) {
    if (running || !canStart() || !selected.length) return;
    running = true;
    stopRequested = false;
    setBusy(true);
    status.textContent = '';
    // Freeze the consent scope. Edits can narrow it, never add images/languages.
    const jobs = selected.map((row) => ({ row, langs: missing(row) }));
    try {
      const confirmed = await confirmModal(document.body, {
        title: t('imageLibrary.batch.aiTitle', 'Generate alt text with AI?'),
        message: t(
          'imageLibrary.batch.aiConsent',
          {
            one: '1 image and its context (tags and photographer) will be sent to OpenAI. This may incur AI costs, depending on the configured model and image usage. Generate missing alt text?',
            many: '{count} images and their context (tags and photographer) will be sent to OpenAI. This may incur AI costs, depending on the configured model and image usage. Generate missing alt text?',
          },
          { count: jobs.length },
        ),
      });
      if (!confirmed || !canContinue() || isClosed()) return;
      stop.hidden = false;
      stop.disabled = false;
      status.textContent = t(
        'imageLibrary.batch.aiRunning',
        'Generating alt text. You can keep editing; your changes take precedence.',
      );
      await runBatchTasks(
        jobs,
        async ({ row, langs }) => {
          const requested = langs.filter((lang) => missing(row).includes(lang));
          if (!requested.length) return;
          const revisions = { ...row.altRevisions };
          const { url, description, tags, photographer } = rowForm(row);
          row.aiStatus = 'generating';
          row.aiError = '';
          rowChanged(row);
          try {
            const result = await api('/api/image-library/generate-alts', {
              method: 'POST',
              body: {
                url,
                description,
                tags,
                photographer,
                langs: requested,
                context: null,
              },
            });
            if (isClosed()) return;
            for (const lang of requested) {
              const input = row.altInputs[lang];
              if (
                !input.value.trim() &&
                row.altRevisions[lang] === revisions[lang] &&
                typeof result?.alts?.[lang] === 'string'
              ) {
                input.value = result.alts[lang];
              }
            }
            row.aiStatus = 'generated';
          } catch (err) {
            if (isClosed()) return;
            row.aiStatus = 'failed';
            row.aiError = String(err?.message || err);
          }
          rowChanged(row);
        },
        {
          concurrency: 2,
          shouldContinue: () => !stopRequested && canContinue() && !isClosed(),
        },
      );
      if (!isClosed())
        status.textContent = t(
          'imageLibrary.batch.aiFinished',
          'AI requests have finished. Review the alt text before saving. Generating again requires new confirmation.',
        );
    } finally {
      running = false;
      if (!isClosed()) stop.hidden = true;
      setBusy(false);
    }
  }

  /** A failed row retries only itself and asks for fresh consent. */
  function retry(row) {
    return start(candidates().filter((candidate) => candidate === row));
  }

  return { el, update, retry };
}
