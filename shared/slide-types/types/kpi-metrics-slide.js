import {
  bgClass,
  esc,
  clampInt,
  isNonEmptyString,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/**
 * Title and subheading are one header block. They already share a centre, but
 * they are a block all the same: grouping them is what stops a future
 * per-field alignment from pulling them apart, and gives the type one honest
 * control instead of two that must be kept in sync by hand.
 */
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  label: 'Header alignment',
  schematicKind: 'kpi',
});

/**
 * Detect positive/negative tone from note text.
 * If the note starts with +N or -N (number/percentage), apply colour.
 * Returns { tone, highlight, rest } where highlight is the coloured prefix.
 */
function parseNoteTone(noteRaw) {
  const n = String(noteRaw || '').trim();
  if (!n) return { tone: '', highlight: '', rest: '' };
  // Match leading +/-/− followed by digits/punctuation, up to first space
  const m = n.match(/^([+\-−][\d.,]+[%a-zA-Z]*)(\s+(.*))?$/);
  if (!m) return { tone: '', highlight: '', rest: n };
  const prefix = m[1];
  const rest = (m[3] || '').trim();
  const first = prefix[0];
  const tone =
    first === '-' || first === '−'
      ? 'is-negative'
      : first === '+'
        ? 'is-positive'
        : '';
  return { tone, highlight: prefix, rest };
}

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  label: 'KPI',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
      group: 'header-block',
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
      group: 'header-block',
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    BACKGROUND_FIELD,
    // Accent and count-up are two compact enums that read as one "how do the
    // numbers behave" choice, so they share a form row (see form-layout.js).
    {
      key: 'accent',
      label: 'Accent',
      type: 'enum',
      required: false,
      options: ['none', 'highlight-best', 'highlight-risk'],
      formLayout: 'pair',
    },
    {
      key: 'countUp',
      label: 'Count-up animation',
      type: 'enum',
      required: false,
      options: ['off', 'on'],
      formLayout: 'pair',
    },
    {
      key: 'metrics',
      label: 'Metrics',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 4,
      itemDefaults: {
        value: '42',
        unit: '',
        label: 'New KPI',
        note: '',
      },
      itemDefaultsByLang: {
        nl: {
          value: '42',
          unit: '',
          label: 'Nieuwe KPI',
          note: '',
        },
      },
      // Value and unit read as one number, so they share a row in the item
      // editor (formLayout, read by the generic collection editor); label and
      // note each get their own line.
      itemFields: [
        {
          key: 'value',
          label: 'Value',
          type: 'string',
          required: false,
          maxLength: 30,
          formLayout: 'pair',
        },
        {
          key: 'unit',
          label: 'Unit',
          type: 'string',
          required: false,
          maxLength: 12,
          formLayout: 'pair',
        },
        {
          key: 'label',
          label: 'Label',
          type: 'string',
          required: false,
          maxLength: 60,
        },
        {
          key: 'note',
          label: 'Note',
          type: 'string',
          required: false,
          maxLength: 100,
        },
        // BACK-COMPAT: 'delta' field removed from schema but still read
        // in renderHtml for existing slides. See migration script.
      ],
    },
    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the header block's alignment (see field-groups.js), so the raw
    // enum is a fallback surface, not the control.
    HEADER_BLOCK.field,
  ],
  defaultsByLang: {
    nl: {
      headerAlign: 'left',
      title: 'Kerncijfers',
      subheading: '',
      bottomSubheading: '',
      background: 'mist',
      accent: 'none',
      countUp: 'off',
      metrics: [
        {
          value: '1.2',
          unit: 'M',
          label: 'Bereik',
          note: '+12% t.o.v. vorig jaar',
        },
        {
          value: '35',
          unit: '%',
          label: 'Conversie',
          note: '+3pp',
        },
        {
          value: '9.1',
          unit: '',
          label: 'NPS',
          note: '+0.4',
        },
        {
          value: '420',
          unit: 'k€',
          label: 'Budget',
          note: '-5% forecast',
        },
      ],
    },
    'en-GB': {
      headerAlign: 'left',
      title: 'Key metrics',
      subheading: '',
      bottomSubheading: '',
      background: 'mist',
      accent: 'none',
      countUp: 'off',
      metrics: [
        {
          value: '1.2',
          unit: 'M',
          label: 'Reach',
          note: '+12% vs last year',
        },
        {
          value: '35',
          unit: '%',
          label: 'Conversion',
          note: '+3pp',
        },
        {
          value: '9.1',
          unit: '',
          label: 'NPS',
          note: '+0.4',
        },
        {
          value: '420',
          unit: 'k€',
          label: 'Budget',
          note: '-5% forecast',
        },
      ],
    },
  },
  // Back-compat fallback
  defaults: {
    headerAlign: 'left',
    title: 'Key metrics',
    subheading: '',
    bottomSubheading: '',
    background: 'mist',
    accent: 'none',
    countUp: 'off',
    metrics: [
      {
        value: '1.2',
        unit: 'M',
        label: 'Reach',
        note: '+12% vs last year',
      },
      {
        value: '35',
        unit: '%',
        label: 'Conversion',
        note: '+3pp',
      },
      {
        value: '9.1',
        unit: '',
        label: 'NPS',
        note: '+0.4',
      },
      {
        value: '420',
        unit: 'k€',
        label: 'Budget',
        note: '-5% forecast',
      },
    ],
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'mist');
    const title = isNonEmptyString(content?.title)
      ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
      : '';
    const subheading = renderSubheadingHtml(content);
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const accent = String(content?.accent || 'none');
    const accentClass =
      accent === 'highlight-best'
        ? 'is-accent-best'
        : accent === 'highlight-risk'
          ? 'is-accent-risk'
          : '';

    // Count-up should be a “presentation/public” effect, not an editor preview gimmick.
    const mode = String(ctx?.mode || '');
    const countUpOn =
      content?.countUp === 'on' && (mode === 'present' || mode === 'follow');

    let metrics = Array.isArray(content?.metrics) ? content.metrics : [];
    if (!Array.isArray(metrics)) metrics = [];
    metrics = metrics
      .filter((m) => m && typeof m === 'object')
      .slice(0, 4);
    const count = clampInt(metrics.length, 1, 4, 1);

    const cards = [];
    for (let i = 0; i < count; i += 1) {
      const m = metrics[i] || {};
      const value = String(m?.value || '').trim();
      const unit = String(m?.unit || '').trim();
      const label = String(m?.label || '').trim();

      // BACK-COMPAT: merge legacy 'delta' into 'note' at render time
      const legacyDelta = String(m?.delta || '').trim();
      const rawNote = String(m?.note || '').trim();
      const effectiveNote = legacyDelta
        ? `${legacyDelta}${rawNote ? ` ${rawNote}` : ''}`
        : rawNote;

      const { tone, highlight, rest } = parseNoteTone(effectiveNote);

      const aria = esc(label || `Metric ${i}`);
      const meta = effectiveNote
        ? `
              <div class="kpi-meta">
                ${highlight ? `<span class="kpi-delta ${tone}">${esc(highlight)}</span>` : ''}
                ${rest ? `<span class="kpi-note" dir="auto">${esc(rest)}</span>` : ''}
              </div>
            `
        : '';

      cards.push(`
          <div class="kpi-metric${i === 0 ? ' is-primary' : ''}" data-morph-role="kpi-${i}" role="group" aria-label="${aria}" data-inline-item="metrics" data-inline-item-index="${i}">
            <div class="kpi-value">
              <span class="kpi-value-num" data-inline-field="metrics.${i}.value" ${countUpOn ? 'data-kpi-countup="1"' : ''}>${esc(value || '0')}</span>${unit ? `<span class="kpi-unit" data-inline-field="metrics.${i}.unit">${esc(unit)}</span>` : ''}
            </div>
            <div class="kpi-label" data-inline-field="metrics.${i}.label" dir="auto">${esc(label || 'Label')}</div>
            ${meta}
          </div>
        `);
    }

    const alignClass = groupAlignClass(HEADER_BLOCK.group, content);
    return `
        <div class="slide slide-kpi-metrics ${bg} ${accentClass}${hasBottom ? ' has-bottom-subheading' : ''}${alignClass ? ` ${alignClass}` : ''}" data-metric-count="${count}" data-count-up="${countUpOn ? '1' : '0'}">
          <div class="slide-inner">
            ${title}
            ${subheading}
            <div class="kpi-grid" data-metric-count="${count}">
              ${cards.join('')}
            </div>
            ${bottomSubheading}
          </div>
        </div>
      `;
  },
};
