/**
 * Instance Health Tab Component (A7.3, B516, D249)
 *
 * Which surfaces of this install are used: the census of what the instance
 * holds now, and per axis how many days each key was seen in the window and
 * when last. Tables only — no chart, no export; nothing here names a deck, a
 * person or an organization. The numbers come from `GET /api/instance-health`
 * (`server/routes/api/instance-health.js`); this view is that route's only
 * reader, so it fetches it itself.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { createSegmented } from '../../../lib/dom/segmented.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import {
  formatCount,
  formatDate,
} from '../../../lib/format/analytics-format.js';

/** The windows the route accepts, in days. */
const WINDOWS = ['30', '90', '365'];
const DEFAULT_WINDOW = '90';

/**
 * The usage axes in reading order, with their label keys. Every axis the
 * route answers is listed; a stored day is `YYYY-MM-DD` in UTC.
 */
const AXES = [
  {
    axis: 'slide_type.authored',
    labelKey: 'settings.health.axis.slideTypeAuthored',
    label: 'Slide types authored',
  },
  {
    axis: 'slide_type.viewed',
    labelKey: 'settings.health.axis.slideTypeViewed',
    label: 'Slide types viewed',
  },
  {
    axis: 'surface',
    labelKey: 'settings.health.axis.surface',
    label: 'Public surfaces',
  },
  {
    axis: 'export',
    labelKey: 'settings.health.axis.export',
    label: 'Export formats',
  },
  {
    axis: 'interaction',
    labelKey: 'settings.health.axis.interaction',
    label: 'Audience interactions',
  },
  { axis: 'mcp', labelKey: 'settings.health.axis.mcp', label: 'MCP tools' },
  {
    axis: 'api_v1',
    labelKey: 'settings.health.axis.apiV1',
    label: 'Public API operations',
  },
];

/**
 * A stored day as a date, read in UTC so it is the day that was stored.
 * @param {string} day - `YYYY-MM-DD`
 * @returns {string}
 */
function formatDay(day) {
  return formatDate(day, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * A plain table: one header row, one row per item, numeric columns right-
 * aligned.
 * @param {Array<{label: string, numeric?: boolean}>} columns
 * @param {Array<Array<string>>} rows
 * @returns {HTMLTableElement}
 */
function createTable(columns, rows) {
  return h('table', { class: 'instance-health-table' }, [
    h('thead', {}, [
      h(
        'tr',
        {},
        columns.map((col) =>
          h('th', {
            scope: 'col',
            ...(col.numeric ? { class: 'is-numeric' } : {}),
            text: col.label,
          }),
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
          cells.map((cell, i) =>
            h('td', {
              ...(columns[i].numeric ? { class: 'is-numeric' } : {}),
              text: cell,
            }),
          ),
        ),
      ),
    ),
  ]);
}

/**
 * One card: a title, a hint, and a table or the line that says it is empty.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.hint]
 * @param {Array<{label: string, numeric?: boolean}>} opts.columns
 * @param {Array<Array<string>>} opts.rows
 * @param {string} opts.emptyText
 * @returns {HTMLElement}
 */
function createSection({ title, hint, columns, rows, emptyText }) {
  return h('section', { class: 'stack editor-card instance-health-section' }, [
    h('h3', { class: 'field-label', text: title }),
    hint ? h('p', { class: 'help', text: hint }) : null,
    rows.length
      ? createTable(columns, rows)
      : h('p', { class: 'empty-note', text: emptyText }),
  ]);
}

/**
 * The census: what the instance holds right now.
 * @param {Object} census - `census` from the route.
 * @returns {HTMLElement[]}
 */
function renderCensus(census) {
  const slideTypes = census?.slideTypes || [];
  const customTypes = census?.customTypes || [];
  const settings = census?.settings || [];
  return [
    createSection({
      title: t(
        'settings.health.census.slideTypes.title',
        'Slide types in decks',
      ),
      hint: t(
        'settings.health.census.slideTypes.hint',
        'Counted now, over every deck outside the trash and the sandbox.',
      ),
      columns: [
        { label: t('settings.health.column.type', 'Type') },
        {
          label: t('settings.health.column.decks', 'Decks'),
          numeric: true,
        },
        {
          label: t('settings.health.column.slides', 'Slides'),
          numeric: true,
        },
      ],
      rows: slideTypes.map((row) => [
        row.key,
        formatCount(row.decks),
        formatCount(row.slides),
      ]),
      emptyText: t('settings.health.census.slideTypes.empty', 'No decks yet.'),
    }),
    createSection({
      title: t(
        'settings.health.census.customTypes.title',
        'Custom slide types',
      ),
      columns: [
        { label: t('settings.health.column.type', 'Type') },
        {
          label: t('settings.health.column.definitions', 'Definitions'),
          numeric: true,
        },
        {
          label: t('settings.health.column.published', 'Published'),
          numeric: true,
        },
      ],
      rows: customTypes.map((row) => [
        row.key,
        formatCount(row.definitions),
        formatCount(row.published),
      ]),
      emptyText: t(
        'settings.health.census.customTypes.empty',
        'No custom slide types defined.',
      ),
    }),
    createSection({
      title: t(
        'settings.health.census.settings.title',
        'Settings changed from their default',
      ),
      hint: t(
        'settings.health.census.settings.hint',
        'Only the names of the settings; their values are not shown.',
      ),
      columns: [{ label: t('settings.health.column.setting', 'Setting') }],
      rows: settings.map((key) => [key]),
      emptyText: t(
        'settings.health.census.settings.empty',
        'Every setting is at its default.',
      ),
    }),
  ];
}

/**
 * The counters: one table per axis.
 * @param {Object} usage - `usage` from the route, keyed by axis.
 * @returns {HTMLElement[]}
 */
function renderUsage(usage) {
  const columns = [
    { label: t('settings.health.column.key', 'Key') },
    {
      label: t('settings.health.column.daysActive', 'Days active'),
      numeric: true,
    },
    { label: t('settings.health.column.lastSeen', 'Last seen') },
    { label: t('settings.health.column.total', 'Total'), numeric: true },
  ];
  return AXES.map(({ axis, labelKey, label }) =>
    createSection({
      title: t(labelKey, label),
      columns,
      rows: (usage?.[axis] || []).map((row) => [
        row.key,
        formatCount(row.daysActive),
        formatDay(row.lastSeen),
        formatCount(row.count),
      ]),
      emptyText: t(
        'settings.health.usage.empty',
        'Nothing counted in this window.',
      ),
    }),
  );
}

/**
 * The line under the title: since when the counters run, and when the
 * pruning decision is due (first counted day plus three months, D26).
 * @param {Object} data - The route's answer.
 * @returns {string}
 */
function measuredLine(data) {
  if (!data.firstMeasuredAt) {
    return t(
      'settings.health.notMeasuredYet',
      'Nothing has been counted on this instance yet.',
    );
  }
  return t(
    'settings.health.measuredSince',
    'Counting since {since}. The pruning decision is due on {due}.',
    {
      since: formatDay(data.firstMeasuredAt),
      due: formatDay(data.decisionDueAt),
    },
  );
}

/**
 * Create the instance health tab component.
 * @returns {{ el: HTMLElement, load: Function }}
 */
export function createHealthTab() {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-health',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-health-btn',
    'data-tab': 'health',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.health', 'Instance Health'),
  });
  const description = h('p', {
    class: 'settings-tab-description',
    text: t(
      'settings.health.description',
      'Which parts of this installation are used, so that pruning can rest on a number. Counted per day for the whole instance; nothing here names a deck, a person or an organization, and nothing leaves the instance.',
    ),
  });
  const measured = h('p', {
    class: 'help instance-health-measured',
    'aria-live': 'polite',
  });

  let windowDays = DEFAULT_WINDOW;
  const windowControl = createSegmented({
    ariaLabel: t('settings.health.window.label', 'Window'),
    value: windowDays,
    segments: WINDOWS.map((days) => ({
      value: days,
      label: t('settings.health.window.days', '{days} days', { days }),
    })),
    onSelect: (value) => {
      if (value === windowDays) return;
      windowDays = value;
      refresh();
    },
  });

  const census = h('div', { class: 'stack instance-health-census' });
  const usageTitle = h('h3', {
    class: 'instance-health-heading',
    text: t('settings.health.usage.title', 'Use in the window'),
  });
  const usage = h('div', { class: 'stack instance-health-usage' });
  const loadError = createInlineError({ live: 'polite' });

  container.append(
    title,
    description,
    measured,
    h('h3', {
      class: 'instance-health-heading',
      text: t('settings.health.census.title', 'What the instance holds now'),
    }),
    census,
    h('div', { class: 'row is-between instance-health-usage-head' }, [
      usageTitle,
      windowControl.el,
    ]),
    loadError.el,
    usage,
  );

  // The answer for the newest request wins; a slow earlier one is dropped.
  let requestSeq = 0;

  const refresh = async () => {
    const seq = ++requestSeq;
    container.setAttribute('aria-busy', 'true');
    try {
      const data = await api(`/api/instance-health?days=${windowDays}`);
      if (seq !== requestSeq) return;
      loadError.clear();
      measured.textContent = measuredLine(data);
      census.replaceChildren(...renderCensus(data.census));
      usage.replaceChildren(...renderUsage(data.usage));
    } catch (err) {
      if (seq !== requestSeq) return;
      usage.replaceChildren();
      loadError.show(
        err?.message ||
          t('settings.health.loadFailed', 'Could not load instance health.'),
        { focus: false },
      );
    } finally {
      if (seq === requestSeq) container.removeAttribute('aria-busy');
    }
  };

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    refresh();
  };

  return { el: container, load };
}
