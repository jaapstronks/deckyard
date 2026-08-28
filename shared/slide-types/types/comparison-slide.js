import {
  bgClass,
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { badgeHtml } from '../partials.js';
import { markdownToSafeHtml } from '../../markdown.js';

/**
 * The four treatments, in picker order: the default first.
 *
 * A treatment is STYLING over one fixed layout — the schema, the DOM and the
 * morph roles are identical for all four, which is why this is an enum field
 * and a modifier class rather than four types or a `layoutVariants` entry.
 * `versus` is the neutral duel the type has always rendered; the other three
 * say something the neutral form cannot (a direction, a valence, a set of
 * criteria).
 */
export const COMPARISON_VARIANTS = Object.freeze([
  'versus',
  'before-after',
  'pros-cons',
  'tradeoff',
]);

/** The treatment an unset or unrecognised value resolves to. */
export const DEFAULT_COMPARISON_VARIANT = 'versus';

/**
 * Map a treatment to its modifier class.
 *
 * `versus` deliberately emits NOTHING: it is the look `.slide-comparison`
 * already had, so a `--versus` modifier would be a second spelling for one
 * meaning and every deck written before this field existed would change its
 * markup for a class that styles nothing. Same call `cornerCell` makes in
 * table-slide — absent/unknown renders the historical form byte for byte.
 *
 * @param {unknown} value - `content.variant` as stored
 * @returns {string} a modifier class, or '' for the default treatment
 */
export function comparisonVariantClass(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v &&
    v !== DEFAULT_COMPARISON_VARIANT &&
    COMPARISON_VARIANTS.includes(v)
    ? `slide-comparison--${v}`
    : '';
}

export default {
  structure: 'singleton',
  // Two labelled columns with a body each is two-dimensional content, even
  // though the fields are scalars. A table keeps the pairing that is the whole
  // point of a comparison; content-slide would flatten it into one body.
  fallback: 'table-slide',
  runtime: 'static',
  label: 'Comparison',
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      labelKey: 'editor.slideField.bottomSubheading.label',
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
    {
      key: 'variant',
      label: 'Treatment',
      type: 'enum',
      required: false,
      // Spelled out rather than derived from COMPARISON_VARIANTS: an option is
      // copy only when it declares a label (shared/ui-i18n-keys.js), and these
      // four are words a reader picks from, not storage tokens. The pair is
      // pinned against the vocabulary in tests/comparison-slide.test.js.
      options: [
        { value: 'versus', label: 'Versus' },
        { value: 'before-after', label: 'Before / after' },
        { value: 'pros-cons', label: 'Pros / cons' },
        { value: 'tradeoff', label: 'Trade-off' },
      ],
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
      variant: DEFAULT_COMPARISON_VARIANT,
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
      variant: DEFAULT_COMPARISON_VARIANT,
      background: 'mist',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    title: 'Comparison',
    subheading: '',
    bottomSubheading: '',
    leftTitle: 'Option A',
    leftBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
    rightTitle: 'Option B',
    rightBody: '- Advantage 1\n- Advantage 2\n- Advantage 3',
    verdict: '',
    variant: DEFAULT_COMPARISON_VARIANT,
    background: 'mist',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content.title.trim())}</h2>`
        : '';
    const subheadingHtml = renderSubheadingHtml(content);
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const leftTitle =
      typeof content?.leftTitle === 'string' ? content.leftTitle.trim() : '';
    const leftBody =
      typeof content?.leftBody === 'string' ? content.leftBody.trim() : '';
    const rightTitle =
      typeof content?.rightTitle === 'string' ? content.rightTitle.trim() : '';
    const rightBody =
      typeof content?.rightBody === 'string' ? content.rightBody.trim() : '';
    const verdict =
      typeof content?.verdict === 'string' ? content.verdict.trim() : '';

    const leftTitleHtml = leftTitle
      ? `<h3 class="side-title" data-inline-field="leftTitle" dir="auto">${escapeHtml(leftTitle)}</h3>`
      : '';
    const leftBodyHtml = leftBody
      ? `<div class="body" data-inline-field="leftBody">${markdownToSafeHtml(leftBody)}</div>`
      : '';

    const rightTitleHtml = rightTitle
      ? `<h3 class="side-title" data-inline-field="rightTitle" dir="auto">${escapeHtml(rightTitle)}</h3>`
      : '';
    const rightBodyHtml = rightBody
      ? `<div class="body" data-inline-field="rightBody">${markdownToSafeHtml(rightBody)}</div>`
      : '';

    const verdictHtml = verdict
      ? `<div class="comparison-verdict">${badgeHtml(verdict, { field: 'verdict' })}</div>`
      : '';

    // The treatment is one modifier class on the root, and the default emits
    // none — see comparisonVariantClass().
    const variantClass = comparisonVariantClass(content?.variant);
    const variantMod = variantClass ? ` ${variantClass}` : '';

    return `
      <div class="slide slide-comparison${variantMod} ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}${verdict ? ' has-verdict' : ''}">
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
