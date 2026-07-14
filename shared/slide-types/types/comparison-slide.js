import {
  bgClass,
  esc,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

export default {
  label: 'Comparison',
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
      key: 'leftTitle',
      label: 'Left title',
      type: 'string',
      required: true,
      maxLength: 100,
    },
    {
      key: 'leftBody',
      label: 'Left content',
      type: 'markdown',
      required: true,
      maxLength: 2000,
    },
    {
      key: 'rightTitle',
      label: 'Right title',
      type: 'string',
      required: true,
      maxLength: 100,
    },
    {
      key: 'rightBody',
      label: 'Right content',
      type: 'markdown',
      required: true,
      maxLength: 2000,
    },
    {
      key: 'verdict',
      label: 'Verdict',
      type: 'string',
      required: false,
      maxLength: 100,
      placeholder: 'Optional badge text',
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Vergelijking',
      subheading: '',
      bottomSubheading: '',
      leftTitle: 'Optie A',
      leftBody: '- Voordeel 1\n- Voordeel 2\n- Voordeel 3',
      rightTitle: 'Optie B',
      rightBody: '- Voordeel 1\n- Voordeel 2\n- Voordeel 3',
      verdict: '',
      background: 'mist',
    },
    'en-GB': {
      title: 'Comparison',
      subheading: '',
      bottomSubheading: '',
      leftTitle: 'Option A',
      leftBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
      rightTitle: 'Option B',
      rightBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
      verdict: '',
      background: 'mist',
    },
  },
  defaults: {
    title: 'Comparison',
    subheading: '',
    bottomSubheading: '',
    leftTitle: 'Option A',
    leftBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
    rightTitle: 'Option B',
    rightBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
    verdict: '',
    background: 'mist',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subheadingHtml = renderSubheadingHtml(content);
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const leftTitle = typeof content?.leftTitle === 'string' ? content.leftTitle.trim() : '';
    const leftBody = typeof content?.leftBody === 'string' ? content.leftBody.trim() : '';
    const rightTitle = typeof content?.rightTitle === 'string' ? content.rightTitle.trim() : '';
    const rightBody = typeof content?.rightBody === 'string' ? content.rightBody.trim() : '';
    const verdict = typeof content?.verdict === 'string' ? content.verdict.trim() : '';

    const leftTitleHtml = leftTitle
      ? `<h3 class="side-title" data-inline-field="leftTitle" dir="auto">${esc(leftTitle)}</h3>`
      : '';
    const leftBodyHtml = leftBody
      ? `<div class="body" data-inline-field="leftBody">${markdownToSafeHtml(leftBody)}</div>`
      : '';

    const rightTitleHtml = rightTitle
      ? `<h3 class="side-title" data-inline-field="rightTitle" dir="auto">${esc(rightTitle)}</h3>`
      : '';
    const rightBodyHtml = rightBody
      ? `<div class="body" data-inline-field="rightBody">${markdownToSafeHtml(rightBody)}</div>`
      : '';

    const verdictHtml = verdict
      ? `<div class="comparison-verdict"><span class="badge" data-inline-field="verdict" dir="auto">${esc(verdict)}</span></div>`
      : '';

    return `
      <div class="slide slide-comparison ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}${verdict ? ' has-verdict' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="comparison-split">
            <div class="comparison-side left" data-morph-role="side-left">
              ${leftTitleHtml}
              ${leftBodyHtml}
            </div>
            <div class="comparison-divider"></div>
            <div class="comparison-side right" data-morph-role="side-right">
              ${rightTitleHtml}
              ${rightBodyHtml}
            </div>
          </div>
          ${verdictHtml}
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};