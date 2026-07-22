import {
  bgClass,
  esc,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  clampInt,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

function safeItemsArr(items) {
  return Array.isArray(items) ? items : [];
}

function itemHtml(item, idx, total) {
  // Back-compat: older "agenda-timeline-slide" data used { time, label, body }.
  const dateRaw =
    typeof item?.date === 'string'
      ? item.date
      : typeof item?.time === 'string'
      ? item.time
      : typeof item?.label === 'string'
      ? item.label
      : '';
  const date = String(dateRaw || '').trim();
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  const textRaw =
    typeof item?.text === 'string'
      ? item.text
      : typeof item?.body === 'string'
      ? item.body
      : '';
  const text = String(textRaw || '').trim();

  // Alternate cards above/below the track for visual interest
  const isTop = idx % 2 === 0;
  const tone = idx % 2 === 0 ? 'accent' : 'lime';

  const dateHtml = date
    ? `<div class="timeline-date" data-inline-field="items.${idx}.date" dir="auto">${esc(date)}</div>`
    : '';
  const titleHtml = title
    ? `<div class="timeline-title" data-inline-field="items.${idx}.title" dir="auto">${esc(title)}</div>`
    : '';
  const textHtml = text
    ? `<div class="timeline-text" data-inline-field="items.${idx}.text" dir="auto">${esc(text)}</div>`
    : '';

  return `
    <li class="timeline-item ${isTop ? 'is-top' : 'is-bottom'}" data-index="${idx + 1}" data-tone="${esc(tone)}" data-inline-item="items" data-inline-item-index="${idx}">
      <div class="timeline-marker" aria-hidden="true"></div>
      <div class="timeline-connector" aria-hidden="true"></div>
      ${dateHtml}
      <div class="timeline-card">
        ${titleHtml}
        ${textHtml}
      </div>
    </li>
  `;
}

export default {
  label: 'Timeline',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'items',
      label: 'Timeline items',
      type: 'items',
      required: true,
      minItems: 2,
      maxItems: 10,
      // Full-width, stacked item fields: date/title/description each on their
      // own row (the narrow sidebar makes the 2-column grid unreadable here).
      itemColumns: 1,
      itemDefaults: {
        date: '2024',
        title: 'New milestone',
        text: '',
      },
      itemFields: [
        // Each item sits in a row aligned to the timeline rail/dot marker;
        // block alignment would detach the text from the marker. See text-roles.js.
        {
          key: 'date',
          label: 'Date / label',
          type: 'string',
          required: true,
          maxLength: 30,
          role: 'list-item',
        },
        {
          key: 'title',
          label: 'Title',
          type: 'string',
          required: true,
          maxLength: 60,
          role: 'list-item',
        },
        {
          key: 'text',
          label: 'Description',
          type: 'string',
          required: false,
          maxLength: 200,
          multiline: true,
          role: 'list-item',
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Tijdlijn',
      subheading: '',
      bottomSubheading: '',
      items: [
        { date: '2020', title: 'Oprichting', text: 'Het begin van ons verhaal' },
        { date: '2021', title: 'Eerste klanten', text: 'Marktvalidatie behaald' },
        { date: '2022', title: 'Groei', text: 'Team uitgebreid naar 10 mensen' },
        { date: '2023', title: 'Uitbreiding', text: 'Nieuwe markten betreden' },
        { date: '2024', title: 'Vandaag', text: 'Klaar voor de toekomst' },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'Timeline',
      subheading: '',
      bottomSubheading: '',
      items: [
        { date: '2020', title: 'Founded', text: 'The beginning of our story' },
        { date: '2021', title: 'First customers', text: 'Market validation achieved' },
        { date: '2022', title: 'Growth', text: 'Team expanded to 10 people' },
        { date: '2023', title: 'Expansion', text: 'Entered new markets' },
        { date: '2024', title: 'Today', text: 'Ready for the future' },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'Timeline',
    subheading: '',
    bottomSubheading: '',
    items: [
      { date: '2020', title: 'Founded', text: 'The beginning of our story' },
      { date: '2021', title: 'First customers', text: 'Market validation achieved' },
      { date: '2022', title: 'Growth', text: 'Team expanded to 10 people' },
      { date: '2023', title: 'Expansion', text: 'Entered new markets' },
      { date: '2024', title: 'Today', text: 'Ready for the future' },
    ],
    background: 'mist',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subheadingText = getSubheadingText(content);
    const subheadingHtml = subheadingText
      ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheadingText)}</p>`
      : '';
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const items = safeItemsArr(content?.items).slice(0, 10);
    const count = clampInt(items.length, 2, 10, 5);

    const itemsHtml = items
      .slice(0, count)
      .map((item, idx) => itemHtml(item, idx, count))
      .join('');

    return `
      <div class="slide slide-timeline ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <ol class="timeline-container" data-count="${count}" aria-label="${esc(copy.timelineLabel)}">
            <li class="timeline-track" aria-hidden="true"></li>
            ${itemsHtml}
          </ol>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};