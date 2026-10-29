/** Save diagnostics and explicit recovery, without moving the author's view. */
import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { currentUrl } from '../../lib/state/router.js';
import { copyToClipboard } from '../../lib/dom/clipboard.js';
import { getLangDisplayName } from '../../../shared/i18n-utils.js';
import { validateSlideFields } from '../../../shared/slide-types/presentation.js';

/** Locate stored prose quality problems without treating them as failed saves. */
export function savedQualityIssues(pres, slideTypes) {
  const issues = [];
  for (const [lang, version] of Object.entries(pres?.i18n?.versions || {})) {
    const slides = lang === pres.i18n.active ? pres.slides : version.slides;
    for (const slide of slides || []) {
      const opts = {
        slideTypes,
        allowMissingTranslationText: lang !== pres.i18n.dominant,
      };
      const strict = validateSlideFields(slide, opts);
      const hard = validateSlideFields(slide, {
        ...opts,
        previousSlide: slide,
      });
      for (const problem of strict) {
        if (!hard.some((p) => p.field === problem.field))
          issues.push({ ...problem, slideId: slide.id, lang });
      }
    }
  }
  return issues;
}

/**
 * Context captured at failure time, including the full API diagnostics. No
 * deck body, authentication headers or user credentials enter the report.
 * @param {Object} opts
 * @returns {{el: HTMLElement, setError: Function, setNormalized: Function, sync: Function, detach: Function}}
 */
export function createSaveFeedback({
  pres,
  slideTypes,
  onReveal,
  getSelectedSlideId,
} = {}) {
  let error = null;
  let target = null;
  let normalized = [];
  const notice = h('p');
  const go = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('editor.save.goToIssue', 'Go to field'),
    onclick: () => {
      if (!target) return;
      // Going to a shortened field is the review the notice asks for.
      normalized = normalized.filter((n) => n !== target);
      onReveal?.(target);
    },
  });
  const reportLabel = t('editor.save.bugReport', 'Bug report');
  const report = h('textarea', {
    class: 'form-input',
    readOnly: true,
    rows: 10,
    'aria-label': reportLabel,
    onclick: () => report.select(),
  });
  const copyStatus = h('span', { role: 'status' });
  const copy = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('editor.save.copyReport', 'Copy bug report'),
    onclick: async () => {
      const copied = await copyToClipboard(report.value);
      copyStatus.textContent = copied
        ? t('common.copied', 'Copied')
        : t(
            'common.copyManualHint',
            'Select the text below and copy it manually (Ctrl/Cmd+C).',
          );
      if (!copied) {
        report.focus();
        report.select();
      }
    },
  });
  const diagnostic = h('details', {}, [
    h('summary', { text: reportLabel }),
    report,
    copy,
    copyStatus,
  ]);
  const el = h('div', { class: 'editor-save-feedback', hidden: true }, [
    notice,
    go,
    diagnostic,
  ]);

  const describe = (issue) => {
    const lang = issue.lang || pres?.i18n?.active;
    const slides =
      lang === pres?.i18n?.active
        ? pres?.slides
        : pres?.i18n?.versions?.[lang]?.slides;
    const index = slides?.findIndex((s) => s.id === issue.slideId) ?? -1;
    const slide = slides?.[index];
    return (
      t('editor.save.issueLocation', '{lang}, slide {slide}, field {field}', {
        lang: getLangDisplayName(lang) || lang || '',
        slide: index >= 0 ? index + 1 : issue.slideId,
        field: issue.field,
      }) + (slide?.content?.title ? ` (${slide.content.title})` : '')
    );
  };

  return {
    el,
    /**
     * Fields whose stored value was shortened to fit (an image description
     * past its limit). They stay listed until "Go to field" takes the author
     * to one: an autosave per edit reports `[]` a moment later, and the form
     * shortens the active version when it renders, before any save (B875).
     * @param {Array<{slideId: string, lang: string, field: string}>} issues
     */
    addNormalized(issues) {
      for (const issue of issues || []) {
        const known = normalized.some(
          (n) =>
            n.slideId === issue.slideId &&
            n.lang === issue.lang &&
            n.field === issue.field,
        );
        if (!known) normalized.push(issue);
      }
    },
    setError(next) {
      error = next;
      diagnostic.open = false;
      copyStatus.textContent = '';
      if (!next) {
        report.value = '';
        return;
      }
      report.value = [
        'Deckyard save error',
        `Time: ${new Date().toISOString()}`,
        `URL: ${new URL(currentUrl(), window.location.origin).href}`,
        `Presentation: ${pres?.id || ''}`,
        `Revision: ${pres?.revision ?? ''}`,
        `Active language: ${pres?.i18n?.active || ''}`,
        `Selected slide: ${getSelectedSlideId?.() || ''}`,
        `Save status: error (changes not saved)`,
        `Browser: ${window.navigator.userAgent}`,
        `Message: ${next.message || String(next)}`,
        `Code: ${next.code || next.error || ''}`,
        `HTTP status: ${next.statusCode ?? ''}`,
        `Details: ${JSON.stringify(next.details || {}, null, 2)}`,
        ...(next.stack ? [`Stack: ${next.stack}`] : []),
      ].join('\n');
    },
    sync(status) {
      const failed = status === 'error';
      const quality =
        !failed && status === 'saved'
          ? savedQualityIssues(pres, slideTypes)
          : [];
      target = failed ? error?.details : normalized[0] || quality[0];
      const located = target?.slideId && target?.field;
      go.hidden = !located || !onReveal;
      diagnostic.hidden = !failed || !error;
      notice.textContent = located ? describe(target) : '';
      if (located && target.errors?.length)
        notice.textContent += ': ' + target.errors.join('; ');
      if (!failed && normalized.length)
        notice.textContent +=
          ' ' +
          t(
            'editor.save.shortenedDescription',
            'An image description was shortened to fit. Review the description.',
          );
      else if (!failed && quality.length)
        notice.textContent +=
          ' ' +
          t(
            'editor.save.savedQuality',
            'Your changes are saved. Existing text has been kept; review this field when convenient.',
          );
      el.hidden = !located && diagnostic.hidden;
      return !el.hidden;
    },
    detach() {
      el.remove();
    },
  };
}
