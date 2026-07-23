import { buildCheckboxCallout } from './checkbox-callout.js';

/**
 * Q&A toggle: hide Q&A in follow-along when disabled.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ row: HTMLElement }}
 */
export function buildQaSection({ h, pres, markDirty, requestSave }) {
  const { row } = buildCheckboxCallout({
    h,
    checked: pres.settings.qaEnabled !== false,
    titleKey: 'editor.deckSettings.qa.title',
    titleFallback: 'Enable Q&A',
    helpKey: 'editor.deckSettings.qa.help',
    helpFallback:
      "When disabled, Q&A is hidden in follow-along (participants can't ask questions).",
    onChange: (checked) => {
      pres.settings.qaEnabled = checked;
      markDirty?.();
      requestSave?.();
    },
  });
  return { row };
}

/**
 * Builds toggle: reveal content step-by-step while presenting.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ row: HTMLElement }}
 */
export function buildBuildsSection({ h, pres, markDirty, requestSave }) {
  pres.settings.stepParagraphs = !!pres.settings.stepParagraphs;
  const { row } = buildCheckboxCallout({
    h,
    checked: pres.settings.stepParagraphs,
    titleKey: 'editor.deckSettings.builds.title',
    titleFallback: 'Builds',
    helpKey: 'editor.deckSettings.builds.help',
    helpFallback:
      'Reveal content step-by-step while presenting. Use ←/→ or space to advance.',
    onChange: (checked) => {
      pres.settings.stepParagraphs = checked;
      markDirty?.();
      requestSave?.();
    },
  });
  return { row };
}

/**
 * Show author on social-preview image toggle.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ row: HTMLElement }}
 */
export function buildAuthorPreviewSection({ h, pres, markDirty, requestSave }) {
  pres.settings.ogPreview =
    pres.settings.ogPreview && typeof pres.settings.ogPreview === 'object'
      ? pres.settings.ogPreview
      : {};
  pres.settings.ogPreview.showAuthor = !!pres.settings.ogPreview.showAuthor;
  const { row } = buildCheckboxCallout({
    h,
    checked: pres.settings.ogPreview.showAuthor,
    titleKey: 'editor.deckSettings.authorPreview.title',
    titleFallback: 'Show author on preview',
    helpKey: 'editor.deckSettings.authorPreview.help',
    helpFallback:
      'Display your name and photo on the social media preview image when published.',
    onChange: (checked) => {
      pres.settings.ogPreview.showAuthor = checked;
      markDirty?.();
      requestSave?.();
    },
  });
  return { row };
}

/**
 * Exclude-from-RSS toggle. Hidden until we confirm the org has RSS enabled.
 * @param {object} ctx - { h, pres, api, markDirty, requestSave }
 * @returns {{ row: HTMLElement }}
 */
export function buildRssFeedSection({ h, pres, api, markDirty, requestSave }) {
  const { row } = buildCheckboxCallout({
    h,
    checked: !!pres.settings.excludeFromFeed,
    titleKey: 'editor.deckSettings.rssFeed.title',
    titleFallback: 'Exclude from RSS feed',
    helpKey: 'editor.deckSettings.rssFeed.help',
    helpFallback:
      'When checked, this presentation will not appear in the public RSS feed.',
    onChange: (checked) => {
      pres.settings.excludeFromFeed = checked;
      markDirty?.();
      requestSave?.();
    },
  });
  row.style.display = 'none';
  if (api) {
    api('/api/settings/organization')
      .then((resp) => {
        const orgSettings =
          resp?.settings && typeof resp.settings === 'object'
            ? resp.settings
            : {};
        if (orgSettings.rss?.enabled) {
          row.style.display = '';
        }
      })
      .catch(() => {});
  }
  return { row };
}
