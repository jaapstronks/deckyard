/**
 * The audit (B435 PR 2) as a table: every `essential` field of every core
 * type, and what its empty state shows without hover. The table is the
 * reviewable record (docs/reference/essential-fields.md carries the reasons).
 * Two tests hold the code to it in both directions:
 * tests/inline-essential-visibility.test.js renders each row, and
 * tests/agent-slide-type-contract.test.js checks the agent catalog carries it.
 *
 * - `placeholder`: the renderer draws the field's element even when empty,
 *   which gets the in-box "Add …" placeholder.
 * - `chip`: the renderer omits the empty element; its ghost chip is marked
 *   to show without hover.
 * - `add`: an empty list; its "+ Add" is marked to show without hover.
 * - `hint`: an empty flat image frame; its "+ Add image" likewise.
 * - a selector: the field has no inline affordance (set in the inspector, or
 *   an image list whose empty frames the renderer draws itself); the
 *   renderer's own empty state, named here, is what asks for it.
 */
export const ESSENTIAL = {
  'callout-slide.body': 'placeholder',
  'chapter-title-slide.title': 'placeholder',
  'chart-slide.title': 'placeholder',
  'chart-slide.data': '.chart-error',
  'comparison-slide.leftTitle': 'chip',
  'comparison-slide.leftBody': 'chip',
  'comparison-slide.rightTitle': 'chip',
  'comparison-slide.rightBody': 'chip',
  'content-slide.title': 'placeholder',
  'content-slide.body': 'placeholder',
  'custom-html-slide.html': '.custom-html-empty',
  'cycle-slide.title': 'chip',
  'cycle-slide.items': 'add',
  'embed-slide.embedUrl': '.embed-empty',
  'end-slide.title': 'placeholder',
  'feedback-slide.question': 'placeholder',
  'funnel-slide.title': 'chip',
  'funnel-slide.items': 'add',
  'gallery-slide.images': 'add',
  'icon-card-grid-slide.title': 'placeholder',
  'icon-card-grid-slide.items': 'add',
  'image-set-slide.title': 'placeholder',
  'image-set-slide.body': 'placeholder',
  'image-set-slide.images': '.image-placeholder.is-empty',
  'image-slide.image': 'hint',
  'image-text-slide.title': 'placeholder',
  'image-text-slide.body': 'placeholder',
  'image-text-slide.image': 'hint',
  'kpi-metrics-slide.metrics': 'add',
  'likert-slide.question': 'placeholder',
  'likert-slide.options': 'add',
  'likert-slider-slide.question': 'placeholder',
  'list-slide.title': 'placeholder',
  'list-slide.items': 'add',
  'logo-wall-slide.logos': '.logo-wall-placeholder.is-empty',
  'matrix-slide.cells': 'add',
  'poll-slide.question': 'placeholder',
  'poll-slide.options': 'add',
  'process-slide.title': 'chip',
  'process-slide.items': 'add',
  'pyramid-slide.title': 'chip',
  'pyramid-slide.levels': 'add',
  'quote-slide.quote': 'placeholder',
  'table-slide.title': 'placeholder',
  'table-slide.rows': 'add',
  'team-cards-slide.members': 'add',
  'text-blocks-slide.title': 'placeholder',
  'text-blocks-slide.rows': 'add',
  'timeline-slide.items': 'add',
  'title-slide.title': 'placeholder',
  'video-slide.source': '.video-empty',
};
