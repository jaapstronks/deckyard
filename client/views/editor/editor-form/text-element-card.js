/**
 * "This text" element-tab card.
 *
 * Shows the style controls the slide TYPE offers for the selected text field,
 * and nothing else (B464, D220): no declaration, no control. A field that
 * offers nothing gets one sentence instead ("follows the slide's layout"); a
 * field whose siblings share the offer (array items, a declared set) is styled
 * as one, and the tab says so ("All quotes (3)"). Per-field colour is gone
 * (D221). The offer model, storage and refusals: docs/reference/text-styles.md.
 *
 * Writes go to `content.textStyles[<offer key>]` (`body`, `quotes.*.quote`,
 * `@<set>`); the shared render post-pass turns that into `tf-*` classes on
 * every covered element, so the preview, present mode and exports reflect it
 * from one code path. Defaults are pruned on write, so a click-to-default
 * leaves stored JSON clean.
 */

import { t } from '../../../lib/ui-i18n.js';
import {
  TEXT_SIZE_VALUES,
  instanceCount,
  normalizeTextStyles,
  offerAlign,
  textStyleOfferFor,
} from '../../../../shared/slide-types/text-styles.js';
import { fieldAlignAffordance } from '../../../../shared/slide-types/text-roles.js';
import { resolveFieldDef } from '../../../../shared/slide-types/field-lookup.js';
import {
  getFieldGroup,
  resolveGroupAlign,
} from '../../../../shared/slide-types/field-groups.js';
import { getLayoutVariants } from '../../../../shared/slide-types/layout-variants.js';
import { getSlideType } from '../../../../shared/slide-types/registry.js';
import { isListOnlyMarkdown } from '../../../../shared/markdown.js';
import { h } from '../../../lib/dom/index.js';
import { fieldLabel } from '../inline-edit/field-path.js';

const SIZE_DEFAULT = 'md';

/**
 * Disable a rendered control wholesale and add one line saying why - a greyed
 * control with an explanation beats a silently absent one (a missing control
 * reads as a missing feature).
 * @param {HTMLElement} el
 * @param {string} help
 * @returns {HTMLElement}
 */
function disableWithHelp(el, help) {
  el.classList.add('is-disabled');
  for (const btn of el.querySelectorAll('button, input, select')) {
    btn.disabled = true;
    btn.setAttribute('tabindex', '-1');
  }
  el.append(h('div', { class: 'help', text: help }));
  return el;
}

/** The alignment control's field shape for a list of values. */
function alignField(key, values) {
  return {
    key,
    label: t('editor.textStyle.align', 'Alignment'),
    options: values.map((v) => ({
      value: v,
      label: t(`editor.textStyle.align.${v}`, v[0].toUpperCase() + v.slice(1)),
    })),
  };
}

/**
 * The block's alignment in words: the label of the Layout tile that sets the
 * group's current value, so "This text" and the Layout row say one word
 * (D345). Falls back to the raw value for a fork whose type declares the
 * group without matching tiles.
 * @param {Object} def - slide-type definition
 * @param {Object} group - the field group that owns the alignment
 * @param {string} value - the group's current alignment
 * @returns {string}
 */
function groupAlignLabel(def, group, value) {
  const tile = getLayoutVariants(def).find(
    (v) => !v?.convertTo && v?.set?.[group?.alignKey] === value,
  );
  return tile?.labelKey ? t(tile.labelKey, tile.label || value) : value;
}

/**
 * The "Alignment" line for a field whose alignment belongs to its field group
 * (D345): the block's current value and its scope in words, plus an action
 * that opens the Layout row, the setting's one home (D335). No disabled copy
 * of the control: a dead button reads as broken, and a live one here would be
 * a second address for the block's alignment.
 *
 * @param {Object} opts
 * @param {Object} opts.def - slide-type definition
 * @param {Object|null} opts.group - the field group that owns the alignment
 * @param {Object} opts.slide
 * @param {Function} [opts.onShowLayout] - opens the Slide tab on the Layout row
 * @returns {HTMLElement}
 */
function renderGroupAlignLine({ def, group, slide, onShowLayout }) {
  const value = groupAlignLabel(
    def,
    group,
    resolveGroupAlign(group, slide?.content),
  );
  return h(
    'div',
    { class: 'stack is-field' },
    [
      h('div', {
        class: 'field-label',
        text: t('editor.textStyle.align', 'Alignment'),
      }),
      h('div', {
        class: 'help',
        text: t(
          'editor.textStyle.align.groupValue',
          '{value}, set for the whole block this text moves with.',
          { value },
        ),
      }),
      onShowLayout
        ? h('button', {
            type: 'button',
            class: 'btn btn-secondary btn-sm',
            text: t(
              'editor.textStyle.align.groupAction',
              'Change under Layout →',
            ),
            onclick: () => onShowLayout(),
          })
        : null,
    ].filter(Boolean),
  );
}

/**
 * Whether an offered alignment would show nothing right now: a standalone
 * markdown field whose text is only a bullet or numbered list. A list stays
 * on its markers whatever the block does (docs/reference/text-alignment.md),
 * so the control is shown disabled until the text has a paragraph.
 * @param {Object} typeDef
 * @param {import('../../../../shared/slide-types/text-styles.js').TextStyleOffer} offer
 * @param {Object} content
 * @returns {boolean}
 */
function alignHasNoEffect(typeDef, offer, content) {
  if (offer.scope !== 'field') return false;
  const field = resolveFieldDef(typeDef?.fields, offer.sample);
  return field?.type === 'markdown' && isListOnlyMarkdown(content?.[offer.key]);
}

/**
 * Write one style property under an offer key, pruning defaults so the stored
 * map never carries no-op overrides. Mutates `slide.content.textStyles`.
 * @param {Object} slide
 * @param {string} key - the offer's storage key
 * @param {'align'|'size'} prop
 * @param {string} value
 * @param {Object} typeDef - the slide type definition
 */
function setTextStyle(slide, key, prop, value, typeDef) {
  const content = slide.content || (slide.content = {});
  const map = { ...(content.textStyles || {}) };
  map[key] = { ...(map[key] || {}), [prop]: value };
  const cleaned = normalizeTextStyles(map, typeDef);
  if (Object.keys(cleaned).length) content.textStyles = cleaned;
  else delete content.textStyles;
}

/**
 * The heading and help line over a shared offer: what one click styles.
 * @param {Object} typeDef
 * @param {import('../../../../shared/slide-types/text-styles.js').TextStyleOffer} offer
 * @param {Object} content
 * @returns {HTMLElement[]}
 */
function renderScopeHeading(typeDef, offer, content) {
  const label = fieldLabel(
    offer.sample,
    resolveFieldDef(typeDef?.fields, offer.sample) || {},
  );
  const count = instanceCount(offer, content);
  return [
    h('div', {
      class: 'field-label',
      text: t('editor.textStyle.scope.all', 'All "{label}" ({count})', {
        label,
        count,
      }),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.textStyle.scope.allHelp',
        'Applies to every one on this slide.',
      ),
    }),
  ];
}

/**
 * Render the offered style controls (or the "follows the layout" sentence)
 * into `container`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container - the element tab (elementForm)
 * @param {Object} opts.slide
 * @param {string} opts.fieldKey - the selected field's data-inline-field value
 * @param {{fieldEnum: Function}} opts.fieldRenderers
 * @param {Function} opts.markDirty
 * @param {Function} [opts.rerenderPreview]
 * @param {Function} [opts.scheduleUiRefresh]
 * @param {Function} [opts.onShowLayout] - opens the Slide tab on the Layout
 *   row; the action on a block-owned alignment (D345)
 * @returns {boolean} whether anything was rendered
 */
export function renderTextElementCard({
  container,
  slide,
  fieldKey,
  fieldRenderers,
  markDirty,
  rerenderPreview,
  scheduleUiRefresh,
  onShowLayout,
}) {
  const fieldEnum = fieldRenderers?.fieldEnum;
  if (!fieldEnum || !fieldKey) return false;
  const slideTypeDef = getSlideType(slide?.type) || null;
  const offer = textStyleOfferFor(slideTypeDef, fieldKey);

  const commit = () => {
    markDirty?.();
    scheduleUiRefresh?.();
    rerenderPreview?.();
  };

  // A field in a declared visual block hands its alignment to the block:
  // say what the block does and offer the way there rather than hiding it,
  // because there the answer is "elsewhere", not "never".
  const { owner: alignOwner, groupId } = fieldAlignAffordance(
    slideTypeDef,
    fieldKey,
  );
  const groupHintEl =
    alignOwner === 'group'
      ? renderGroupAlignLine({
          def: slideTypeDef,
          group: getFieldGroup(slideTypeDef, groupId),
          slide,
          onShowLayout,
        })
      : null;

  if (!offer) {
    container.append(
      ...[
        h('div', {
          class: 'help',
          text: t(
            'editor.textStyle.followsLayout',
            "This text follows the slide's layout.",
          ),
        }),
        groupHintEl,
      ].filter(Boolean),
    );
    return true;
  }

  const current =
    normalizeTextStyles(slide?.content?.textStyles, slideTypeDef)[offer.key] ||
    {};
  const { values: alignValues, defaultAlign } = offerAlign(slideTypeDef, offer);
  let alignEl = alignValues.length
    ? fieldEnum(
        alignField('textAlign', alignValues),
        current.align || defaultAlign,
        (v) => {
          setTextStyle(slide, offer.key, 'align', v, slideTypeDef);
          commit();
        },
      )
    : null;
  if (alignEl && alignHasNoEffect(slideTypeDef, offer, slide?.content)) {
    alignEl = disableWithHelp(
      alignEl,
      t(
        'editor.textStyle.align.listOwned',
        'A list stays aligned with its bullets. Alignment applies once this text has a paragraph.',
      ),
    );
  }

  const sizeEl = offer.props.includes('size')
    ? fieldEnum(
        {
          key: 'textSize',
          label: t('editor.textStyle.size', 'Text size'),
          options: TEXT_SIZE_VALUES.map((v) => ({
            value: v,
            label: t(`editor.textStyle.size.${v}`, v.toUpperCase()),
          })),
        },
        current.size || SIZE_DEFAULT,
        (v) => {
          setTextStyle(slide, offer.key, 'size', v, slideTypeDef);
          commit();
        },
      )
    : null;

  container.append(
    ...[
      ...(offer.scope === 'field'
        ? []
        : renderScopeHeading(slideTypeDef, offer, slide?.content)),
      alignEl,
      groupHintEl,
      sizeEl,
    ].filter(Boolean),
  );
  return true;
}
