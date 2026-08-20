/**
 * The list slide's "Text size" field with its step-down note.
 *
 * DOCUMENTED EXCEPTION (route 4 PR D, editor-per-type-behaviour brief). "Text
 * size" is the one list setting the renderer can overrule: a list long AND
 * wordy enough to spill even across two columns steps down a size. That used
 * to happen silently, so an author who picked Large saw nothing change and no
 * reason why. The field renders here (instead of via the generic keeps loop)
 * so a note can sit under it when the step down is actually in effect.
 *
 * Why "a note under a field when the renderer overrules it" is not a field
 * declaration: field declarations travel JSON-safe over `GET /api/slide-types`
 * (field-behaviour.js), and this note needs live layout resolution
 * (resolveListLayout) against the slide's current content. A declaration could
 * therefore only carry the NAME of a hook the editor must still implement —
 * the type knowledge stays in core either way, plus a layer of indirection.
 * The note itself is deliberate UX and stays.
 */
import { t } from '../../../../lib/ui-i18n.js';
import { resolveListLayout } from '../../../../../shared/slide-types/types/list-slide.js';

/**
 * Render the density field with a contextual note when the renderer's
 * resolved layout disagrees with the author's choice.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderListDensityExtra(ctx) {
  const { h, form, slide, used, fieldByKey, renderField } = ctx;

  const densityField = fieldByKey.get('density');
  if (!densityField) return;
  used.add('density');
  const el = renderField(densityField);
  if (!el) return;
  form.append(el);
  const { steppedDownFrom, twoCol } = resolveListLayout(slide?.content);
  if (steppedDownFrom === 'comfortable') {
    el.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.list.sizeSteppedDown',
          'Large does not fit these items, so they are shown at the default size. Shorten the item text, or use fewer items, to get Large back.',
        ),
      }),
    );
  } else if (!twoCol && slide?.content?.layout === 'two-column') {
    // Defensive: the resolver honours an explicit two-column choice, so
    // this should not occur. Kept so a future capacity change cannot make
    // the column count silently disagree with the field.
    el.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.list.oneColumnFallback',
          'Shown in one column: two columns do not fit.',
        ),
      }),
    );
  }
}
