/**
 * The organization's AI usage card (DY-844): model calls and tokens per day,
 * today's per person, and where the installation stands against its daily
 * ceiling. Read-only; shown to the people who administer the organization's AI
 * settings, the same readers the server allows.
 */
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import {
  formatCount,
  formatDate,
} from '../../../lib/format/analytics-format.js';

/** Days of history the card asks for. */
const HISTORY_DAYS = 14;

/** @param {{ inputTokens?: number, outputTokens?: number }} row */
const tokensOf = (row) =>
  formatCount((row.inputTokens || 0) + (row.outputTokens || 0));

/**
 * @param {string[]} headings
 * @param {Array<Array<string>>} rows - first cell text, the rest numeric
 */
function usageTable(headings, rows) {
  return h('table', { class: 'ai-usage-table' }, [
    h('thead', {}, [
      h(
        'tr',
        {},
        headings.map((text, i) =>
          h('th', { text, class: i ? 'is-numeric' : null, scope: 'col' }),
        ),
      ),
    ]),
    h(
      'tbody',
      {},
      rows.map((cells) =>
        h(
          'tr',
          {},
          cells.map((text, i) =>
            h('td', { text, class: i ? 'is-numeric' : null }),
          ),
        ),
      ),
    ),
  ]);
}

/** @returns {{el: HTMLElement, load: () => Promise<void>}} */
export function createAiUsageCard() {
  const card = h('section', { class: 'stack editor-card' });
  const summary = h('p', { class: 'ai-usage-summary' });
  const body = h('div', { class: 'stack ai-usage-section' });
  const error = createInlineError({ callout: true });
  card.append(
    h('h3', {
      class: 'field-label',
      text: t('settings.admin.aiUsage.title', 'AI usage'),
    }),
    h('p', {
      class: 'help',
      text: t(
        'settings.admin.aiUsage.hint',
        'Model calls made for this organization, counted per day (UTC). One AI action can make several calls; tokens are what the AI provider reported.',
      ),
    }),
    summary,
    error.el,
    body,
  );

  let loaded = false;

  function render(data) {
    const total = data.today?.total || {};
    const ceiling = data.ceiling || {};
    summary.textContent = t(
      'settings.admin.aiUsage.today',
      'Today: {calls} calls, {tokens} tokens.',
      { calls: formatCount(total.calls || 0), tokens: tokensOf(total) },
    );
    const ceilingText =
      ceiling.limit > 0
        ? t(
            'settings.admin.aiUsage.ceiling',
            'Installation today: {used} of {limit} calls.',
            {
              used: formatCount(ceiling.used || 0),
              limit: formatCount(ceiling.limit),
            },
          )
        : t(
            'settings.admin.aiUsage.noCeiling',
            'Installation today: {used} calls, no daily limit.',
            { used: formatCount(ceiling.used || 0) },
          );
    summary.append(' ', ceilingText);

    const calls = t('settings.admin.aiUsage.calls', 'Calls');
    const tokens = t('settings.admin.aiUsage.tokens', 'Tokens');
    const people = data.today?.people || [];
    const days = data.days || [];
    body.replaceChildren();
    if (people.length) {
      body.append(
        usageTable(
          [t('settings.admin.aiUsage.person', 'Person'), calls, tokens],
          people.map((row) => [
            row.person?.displayName ||
              t('settings.admin.aiUsage.noPerson', 'Scheduled tasks'),
            formatCount(row.calls || 0),
            tokensOf(row),
          ]),
        ),
      );
    }
    if (days.length) {
      body.append(
        usageTable(
          [t('settings.admin.aiUsage.day', 'Day'), calls, tokens],
          days.map((row) => [
            formatDate(row.day),
            formatCount(row.calls || 0),
            tokensOf(row),
          ]),
        ),
      );
    } else {
      body.append(
        h('p', {
          class: 'help',
          text: t(
            'settings.admin.aiUsage.empty',
            'No AI calls in the last {days} days.',
            { days: HISTORY_DAYS },
          ),
        }),
      );
    }
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    error.clear();
    try {
      render(
        await api(`/api/settings/organization/ai-usage?days=${HISTORY_DAYS}`),
      );
    } catch {
      loaded = false;
      error.show(
        t('settings.admin.aiUsage.loadFailed', 'Could not load AI usage.'),
      );
    }
  }

  return { el: card, load };
}
