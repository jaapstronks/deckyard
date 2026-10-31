import { buildCheckboxCallout } from './checkbox-callout.js';

/**
 * Q&A toggle: hide Q&A in follow-along when disabled.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ row: HTMLElement }}
 */
export function buildQaSection({ pres, markDirty, requestSave }) {
  const { row } = buildCheckboxCallout({
    checked: pres.settings.qaEnabled !== false,
    titleKey: 'editor.deckSettings.qa.title',
    title: 'Enable Q&A',
    helpKey: 'editor.deckSettings.qa.help',
    help: 'When disabled, Q&A is hidden in follow-along (participants can’t ask questions).',
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
export function buildBuildsSection({ pres, markDirty, requestSave }) {
  pres.settings.stepParagraphs = !!pres.settings.stepParagraphs;
  const { row } = buildCheckboxCallout({
    checked: pres.settings.stepParagraphs,
    titleKey: 'editor.deckSettings.builds.title',
    title: 'Builds',
    helpKey: 'editor.deckSettings.builds.help',
    help: 'Reveal content step-by-step while presenting. Use ←/→ or space to advance.',
    onChange: (checked) => {
      pres.settings.stepParagraphs = checked;
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
export function buildRssFeedSection({ pres, api, markDirty, requestSave }) {
  const { row } = buildCheckboxCallout({
    checked: !!pres.settings.excludeFromFeed,
    titleKey: 'editor.deckSettings.rssFeed.title',
    title: 'Exclude from RSS feed',
    helpKey: 'editor.deckSettings.rssFeed.help',
    help: 'When checked, this presentation will not appear in the public RSS feed.',
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
