import { t } from '../../../../lib/ui-i18n.js';

/**
 * Category heading labels, resolved lazily (the i18n dictionary is not loaded
 * at import time). Keyed by the category `key` in CATEGORIES below.
 */
export const CATEGORY_LABELS = {
  basic: () => t('settings.slideTypes.group.basic', 'Basic'),
  media: () => t('settings.slideTypes.group.media', 'Media'),
  layouts: () => t('settings.slideTypes.group.layouts', 'Layouts'),
  data: () => t('settings.slideTypes.group.data', 'Data'),
  process: () => t('settings.slideTypes.group.process', 'Process'),
  interaction: () => t('settings.slideTypes.group.interaction', 'Interaction'),
  other: () => t('settings.slideTypes.group.other', 'Other'),
};

/**
 * Slide type category definitions.
 * Matches the picker categories for familiarity.
 *
 * Every insertable type belongs to exactly one group, and a deprecated type
 * belongs to none — tests/slide-type-companion-coverage.test.js enforces both.
 * (An uncategorized type is not lost: the tab folds it into "Other". That
 * graceful degradation is why the drift used to go unnoticed.)
 */
export const CATEGORIES = [
  {
    key: 'basic',
    label: 'Basic',
    types: [
      'title-slide', 'chapter-title-slide', 'content-slide', 'quote-slide',
      'lijstje-slide', 'list-slide',
    ],
  },
  {
    key: 'media',
    label: 'Media',
    types: [
      'image-text-slide', 'image-slide', 'gallery-slide', 'video-slide',
      'embed-slide', 'team-cards-slide', 'logo-wall-slide',
    ],
  },
  {
    key: 'layouts',
    label: 'Layouts',
    types: [
      'text-blocks-slide',
      'icon-card-grid-slide',
    ],
  },
  {
    key: 'data',
    label: 'Data',
    types: [
      'table-slide', 'chart-slide', 'kpi-metrics-slide', 'comparison-slide',
      'matrix-slide', 'funnel-slide', 'pyramid-slide', 'cycle-slide',
    ],
  },
  {
    key: 'process',
    label: 'Process',
    types: ['process-slide', 'timeline-slide'],
  },
  {
    key: 'interaction',
    label: 'Interaction',
    types: [
      'poll-slide', 'likert-slide', 'likert-slider-slide',
      'feedback-slide', 'follow-invite-slide', 'countdown-slide',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    types: [
      'payoff-slide', 'end-slide', 'custom-html-slide',
    ],
  },
];
