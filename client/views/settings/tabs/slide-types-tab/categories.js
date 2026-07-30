import { t } from '../../../../lib/ui-i18n.js';
import { typesInGroup } from '../../../../../shared/slide-types/authoring-groups.js';

/**
 * Category heading labels, resolved lazily (the i18n dictionary is not loaded
 * at import time). Keyed by the category `key` in CATEGORY_ORDER below.
 */
export const CATEGORY_LABELS = {
  basic: () => t('settings.slideTypes.group.basic', 'Basic'),
  media: () => t('settings.slideTypes.group.media', 'Media'),
  layouts: () => t('settings.slideTypes.group.layouts', 'Layouts'),
  data: () => t('settings.slideTypes.group.data', 'Data'),
  interaction: () => t('settings.slideTypes.group.interaction', 'Interaction'),
  other: () => t('settings.slideTypes.group.other', 'Other'),
};

/**
 * The curation shelves, in display order, each with a display-order hint.
 *
 * Membership is **not** here. Every type declares its own `group` in
 * `shared/slide-types/types/<name>/authoring.js`, and getCategories() below
 * derives the lists from those declarations. This table only fixes the order of
 * the headings and, within a heading, which types lead — the same order the
 * insert picker uses, so the two surfaces read as the same list without either
 * one owning the other's membership.
 *
 * That split fixes a real defect. This table and the picker's used to be two
 * hand-written memberships, and they disagreed about five types: process and
 * timeline sat under their own "Process" heading here but under Layouts in the
 * picker; payoff, end and custom-html were spelled out here but merely fell
 * through to "Other" there. Both surfaces also folded an unknown type into
 * "Other" without complaining, so the drift stayed invisible. A type can now
 * only be on one shelf, and a deprecated type is on none.
 *
 * The old "Process" heading is therefore gone: process and timeline declare
 * `layouts`, which is what the picker has shown all along.
 */
export const CATEGORY_ORDER = [
  {
    key: 'basic',
    types: [
      'title-slide', 'chapter-title-slide', 'content-slide', 'quote-slide',
      'list-slide',
    ],
  },
  {
    key: 'media',
    types: [
      'image-text-slide', 'image-slide', 'gallery-slide', 'video-slide',
      'embed-slide', 'team-cards-slide', 'logo-wall-slide',
    ],
  },
  {
    key: 'layouts',
    types: [
      'text-blocks-slide', 'icon-card-grid-slide', 'process-slide',
      'timeline-slide',
    ],
  },
  {
    key: 'data',
    types: [
      'table-slide', 'chart-slide', 'kpi-metrics-slide', 'comparison-slide',
      'matrix-slide', 'funnel-slide', 'pyramid-slide', 'cycle-slide',
    ],
  },
  {
    key: 'interaction',
    types: [
      'poll-slide', 'likert-slide', 'likert-slider-slide',
      'feedback-slide', 'follow-invite-slide', 'countdown-slide',
    ],
  },
  {
    key: 'other',
    types: ['payoff-slide', 'end-slide', 'custom-html-slide'],
  },
];

/**
 * The curation shelves with their members resolved from the declarations.
 *
 * `slideTypes` is the live type map — the `/api/slide-types` response the tab
 * already holds — so a type from `custom/slide-types/` that declares a group is
 * curated on that shelf instead of falling through to "Other". Omit it and the
 * shelves resolve over core alone, which is what the guardrail test does.
 *
 * A registered type that declares no group is not lost either way: the tab
 * folds it into "Other" — see the uncategorized merge in ./index.js. Deprecated
 * types declare no group and are filtered out downstream by `isCuratable`.
 *
 * @param {Record<string, object>|null} [slideTypes] - the live type map
 * @returns {Array<{key: string, types: string[]}>}
 */
export function getCategories(slideTypes = null) {
  return CATEGORY_ORDER.map(({ key, types }) => ({
    key,
    types: typesInGroup(key, types, slideTypes),
  }));
}
