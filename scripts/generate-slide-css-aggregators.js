#!/usr/bin/env node
// Derive the `@import` aggregators of the slide chain (`client/styles/slides.css`
// and the per-tier files under `client/styles/slides/`), of the viewer chrome
// (`client/styles/viewer.css` over `client/styles/viewer/`, D267) and of the
// feature chrome (`client/styles/base.css` over `client/styles/app/<feature>/`)
// from a declared manifest instead of hand-maintaining the import lists.
//
// WHY THIS EXISTS
// The aggregator files (`slides.css` and the three tiers `01-layout-and-title.css`,
// `02-content-and-media.css`, `03-components.css`) are just ordered lists of
// `@import`s. Hand-maintained, they drift: a new slide type gets a stylesheet but
// nobody wires it in, or a removed type leaves an orphaned import. This makes the
// list a build product of a manifest, and `tests/slide-css-aggregators.test.js`
// gates it (byte-identical to the committed files, every type real, every file on
// disk claimed exactly once).
//
// THE CASCADE CONSTRAINT (the reason this is not a trivial sort)
// The numeric filename prefixes (`00-`, `21-`, `35-`) are NOT sort keys — they are
// cascade order. The `@import` order decides which rule wins, both at runtime and
// when exports inline the CSS in order (see server/utils/read-css-with-imports.js).
// A list sorted alphabetically or by registration order would silently change the
// winner, and fork theme CSS is the first thing that breaks. So every entry
// declares an explicit cascade position: `order` defaults to the numeric filename
// prefix, but an entry whose cascade position must differ from its filename says
// so (today only `poll-slide`, whose file is `10-poll.css` but which has always
// loaded *after* `18-countdown.css`). The declared order is authoritative; the
// filename is only bytes we emit.
//
// Run `node scripts/generate-slide-css-aggregators.js` to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { formatGenerated } from './lib/format-generated.js';

const SLIDES_DIR = fileURLToPath(
  new URL('../client/styles/slides/', import.meta.url),
);

/**
 * The foundation of the chain, in the order `slides.css` imports it, before any
 * tier: the design-system scale and the `--slide-*` roles (`00-tokens.css`), the
 * theme layer that binds a theme's `--t-*` to the slide-local variables
 * (`00-theme.css`, D268: it has no other address and no `:root`), and the shared
 * partial patterns (`00-patterns.css`). The order is declared, not sorted: the
 * theme layer follows the tokens it sits on.
 * @type {string[]}
 */
export const FOUNDATION_CSS = [
  '00-tokens.css',
  '00-theme.css',
  '00-patterns.css',
];

/** The chain's entry point, the one stylesheet every slide-rendering path loads. */
export const ROOT_AGGREGATOR = 'slides.css';

/**
 * The tiers, in the order `slides.css` imports them. Each is one aggregator
 * file whose imports all point into the matching subdirectory.
 * @type {Array<{ dir: string, aggregator: string, header: string }>}
 */
export const TIERS = [
  {
    dir: '01-layout-and-title',
    aggregator: '01-layout-and-title.css',
    header:
      '/* Shared slide rendering (used by preview, presenter, and exports) */',
  },
  {
    dir: '02-content-and-media',
    aggregator: '02-content-and-media.css',
    header: '/* Content and media slide styles (split for maintainability) */',
  },
  {
    dir: '03-components',
    aggregator: '03-components.css',
    header:
      '/* Shared slide rendering (used by preview, presenter, and exports) */',
  },
];

/**
 * Per-type stylesheets, keyed by the registry type name. Always a list — a
 * type may claim more than one sheet: its rules can live at several cascade
 * positions (e.g. image-text in tier 01 and tier 02), and extraction never
 * moves a rule's cascade position — only file boundaries and ownership
 * change. `order` is optional and only present where the cascade position
 * must diverge from the filename prefix.
 * @type {Record<string, Array<{ tier: string, file: string, order?: number }>>}
 */
export const TYPE_CSS = {
  // Tier 01 — layout and title
  'payoff-slide': [{ tier: '01-layout-and-title', file: '10-payoff.css' }],
  'end-slide': [{ tier: '01-layout-and-title', file: '11-end-slide.css' }],
  'title-slide': [{ tier: '01-layout-and-title', file: '21-title-slide.css' }],
  'content-slide': [{ tier: '01-layout-and-title', file: '30-content.css' }],
  'table-slide': [{ tier: '01-layout-and-title', file: '35-table-slide.css' }],
  'image-slide': [{ tier: '01-layout-and-title', file: '40-image-slide.css' }],
  'image-text-slide': [
    { tier: '01-layout-and-title', file: '50-image-text-slide.css' },
    { tier: '02-content-and-media', file: '10-image-text.css' },
  ],
  // One sheet, not two: image-set was split out of image-text (D100) after the
  // tier-01/tier-02 division above had already lost its reason, so its layout
  // and its typography load together at one cascade position.
  'image-set-slide': [
    { tier: '01-layout-and-title', file: '55-image-set-slide.css' },
  ],
  'list-slide': [{ tier: '01-layout-and-title', file: '60-list-slide.css' }],
  'kpi-metrics-slide': [
    { tier: '01-layout-and-title', file: '80-kpi-metrics-slide.css' },
  ],
  'comparison-slide': [
    { tier: '01-layout-and-title', file: '82-comparison-slide.css' },
  ],
  'process-slide': [
    { tier: '01-layout-and-title', file: '84-process-slide.css' },
  ],
  'timeline-slide': [
    { tier: '01-layout-and-title', file: '86-timeline-slide.css' },
  ],
  'matrix-slide': [
    { tier: '01-layout-and-title', file: '88-matrix-slide.css' },
  ],
  'funnel-slide': [
    { tier: '01-layout-and-title', file: '90-funnel-slide.css' },
  ],
  'pyramid-slide': [
    { tier: '01-layout-and-title', file: '91-pyramid-slide.css' },
  ],
  'cycle-slide': [{ tier: '01-layout-and-title', file: '92-cycle-slide.css' }],
  'gallery-slide': [
    { tier: '01-layout-and-title', file: '93-gallery-slide.css' },
  ],

  // Tier 02 — content and media
  'video-slide': [{ tier: '02-content-and-media', file: '20-video.css' }],
  'embed-slide': [{ tier: '02-content-and-media', file: '30-embed.css' }],
  'quote-slide': [{ tier: '02-content-and-media', file: '40-quote.css' }],
  'text-blocks-slide': [
    { tier: '02-content-and-media', file: '80-text-blocks.css' },
  ],

  // Tier 03 — components
  'icon-card-grid-slide': [
    { tier: '02-content-and-media', file: '60-icon-card-grid.css' },
    { tier: '02-content-and-media', file: '75-icon-card-grid-variants.css' },
    { tier: '03-components', file: '00-icon-card-grid.css' },
  ],
  'follow-invite-slide': [
    { tier: '03-components', file: '15-follow-invite.css' },
  ],
  'feedback-slide': [{ tier: '03-components', file: '16-feedback.css' }],
  'countdown-slide': [{ tier: '03-components', file: '18-countdown.css' }],
  // Filename says 10, but this has always loaded after 18-countdown.css.
  // The cascade position is 19; the filename is not touched (that would be a
  // move, out of scope for this brief).
  'poll-slide': [{ tier: '03-components', file: '10-poll.css', order: 19 }],
  'chart-slide': [{ tier: '03-components', file: '20-chart.css' }],
  'chapter-title-slide': [
    { tier: '03-components', file: '30-chapter-title.css' },
  ],
  'callout-slide': [{ tier: '03-components', file: '31-callout-slide.css' }],
  'team-cards-slide': [{ tier: '03-components', file: '45-team-cards.css' }],
  'logo-wall-slide': [
    { tier: '02-content-and-media', file: '72-logo-wall-links.css' },
    { tier: '03-components', file: '46-logo-wall.css' },
  ],
};

/**
 * All (type, entry) pairs, flattened.
 * @returns {Array<{ type: string, tier: string, file: string, order?: number }>}
 */
export function typeCssEntries() {
  return Object.entries(TYPE_CSS).flatMap(([type, list]) =>
    list.map((e) => ({ type, ...e })),
  );
}

/**
 * Stylesheets owned by no single type: base layout, shared media/card layouts,
 * transitions, accessibility utilities and text styles. Declared here because the registry has
 * nothing to derive them from.
 * @type {Array<{ tier: string, file: string, order?: number }>}
 */
export const SHARED_CSS = [
  // Tier 01
  { tier: '01-layout-and-title', file: '00-base.css' },
  // The markdown pipeline's output (`.md-table`, `.md-code-*`, `.md-math-*`,
  // emitted by shared/markdown.js) plus the shared CTA buttons. Split out of the
  // former 30-content-and-tables.css, whose content-slide half is now 30-content.css.
  { tier: '01-layout-and-title', file: '32-markdown-and-actions.css' },
  // The aside inset (`renderAsideHtml()` in shared/slide-types/aside-field.js):
  // three host types render it and none of them owns it, so it is shared
  // render output like the markdown pipeline's above.
  { tier: '01-layout-and-title', file: '33-aside-inset.css' },
  // Tier 02 — the card-link overlay is a genuinely shared component
  // (cardLinkOverlayHtml helper; icon-card-grid and logo-wall both render it)
  { tier: '02-content-and-media', file: '70-card-links.css' },
  // Tier 03
  { tier: '03-components', file: '52-morph-transition.css' },
  { tier: '03-components', file: '60-accessibility.css' },
  { tier: '03-components', file: '70-step-reveal.css' },
  { tier: '03-components', file: '97-text-styles.css' },
];

/**
 * The viewer chrome (D267 layer 3): the presenter shell around the slides —
 * topbar, stage, console, progress, auto-advance, start curtain, edge hint and
 * the projector window. It is app-layer CSS (it reads `--app-*`/`--ps-*`), not
 * slide CSS, so it lives in `client/styles/viewer/` and has its own aggregator,
 * `client/styles/viewer.css`, which the editor (`app.css`) and the export
 * viewer (`export.css`) import before `slides.css`. The embed iframe and the
 * MCP preview have no presenter shell and do not load it. Order is the numeric
 * filename prefix, as in a tier.
 * @type {{ dir: string, aggregator: string, header: string, files: string[] }}
 */
export const VIEWER_LAYER = {
  dir: 'viewer',
  aggregator: 'viewer.css',
  header:
    '/* Viewer chrome: the presenter shell around the slides (editor presenter, present window, exports). Generated by scripts/generate-slide-css-aggregators.js */',
  files: [
    '50-presenter-layout.css',
    '51-presenter-console.css',
    '53-present-window.css',
    '80-presenter-progress.css',
    '82-auto-advance.css',
    '85-presenter-start.css',
    '90-presenter-edge-hint.css',
  ],
};

/**
 * The feature chrome (D267 layer 4): `client/styles/app/<feature>/`, one folder
 * per feature of `client/views/` (`editor/` carries two sub-folders,
 * `inspector/` and `modals/`). `client/styles/base.css` imports every file in
 * the order declared here, which is the cascade order the files had under the
 * former `base/` buckets (B533 moved them without reordering). The list is
 * declared, not sorted: across folders it is the old order, not the map's.
 * Normalising it into per-folder aggregators is B534.
 * @type {{ dir: string, aggregator: string, header: string, files: string[] }}
 */
export const APP_FEATURE_LAYER = {
  dir: 'app',
  aggregator: 'base.css',
  header:
    '/* App feature chrome (D267 layer 4), in cascade order. Generated by scripts/generate-slide-css-aggregators.js */',
  files: [
    'shell/00-fonts-and-root.css',
    'shell/05-avatar.css',
    'shell/06-spinner.css',
    'shell/10-shell-topbar-dropdown.css',
    'shell/20-editor-layout.css',
    'shell/21-editor-skeleton.css',
    'auth/30-auth.css',
    'list/31-list-layout.css',
    'list/32-list-cards.css',
    'shell/40-sidebar.css',
    'shell/90-utilities.css',
    'shell/10-list.css',
    'editor/20-drag-ghost.css',
    'editor/30-slide-items.css',
    'editor/31-slide-overlays.css',
    'editor/32-slide-search.css',
    'editor/33-slide-metadata.css',
    'editor/34-slide-nesting.css',
    'editor/35-slide-visibility.css',
    'editor/40-insert-and-collapsed.css',
    'shell/50-layout-utils.css',
    'editor/60-field-stacks.css',
    'editor/70-slide-type-picker.css',
    'editor/73-slide-schematic.css',
    'slide-library/71-slide-library.css',
    'list/72-slide-collections.css',
    'list/80-tags.css',
    'editor/inspector/10-field-grid.css',
    'editor/inspector/20-card-groups.css',
    'editor/inspector/30-focus-picker.css',
    'editor/inspector/40-option-icons.css',
    'editor/inspector/50-field-labels.css',
    'editor/inspector/60-field-head.css',
    'editor/inspector/70-editor-form.css',
    'editor/inspector/80-section-status.css',
    'editor/inspector/90-inspector-rail.css',
    'editor/inspector/100-cards-and-images.css',
    'editor/inspector/110-collapse.css',
    'editor/inspector/120-color-field.css',
    'editor/inspector/130-card-link-field.css',
    'editor/modals/10-modals-base.css',
    'editor/modals/11-modals-loading.css',
    'editor/modals/12-modals-share.css',
    'editor/modals/13-modals-misc.css',
    'editor/modals/14-modals-json-debug.css',
    'editor/15-ai-reasoning.css',
    'editor/16-ai-iterate.css',
    'list/17-deck-grid.css',
    'editor/modals/18-modals-export.css',
    'editor/20-preview.css',
    'editor/30-publish.css',
    'editor/35-image-library.css',
    'editor/36-imagekit-picker.css',
    'editor/40-thumb.css',
    'editor/50-editor-responsive.css',
    'notes/60-notes.css',
    'follow/70-follow.css',
    'presenter/72-video-layer.css',
    'share-viewer/75-share-viewer.css',
    'notes/80-notes-join.css',
    'settings/85-settings.css',
    'settings/86-admin-users.css',
    'settings/86-settings-api-keys.css',
    'settings/87-slide-type-curation.css',
    'settings/87-settings-analytics.css',
    'settings/87-settings-instance-health.css',
    'settings/88-theme-editor.css',
    'settings/89-slide-type-editor.css',
    'follow/90-public-poll.css',
    'comments/92-comments-panel.css',
    'editor/93-read-only-mode.css',
    'editor/94-published-alt-warning.css',
    'viewer/95-viewer-mode.css',
    'shell/95-toast.css',
    'shell/96-activity-feed.css',
    'list/97-theme-picker.css',
    'user/98-user-autocomplete.css',
    'shell/99-notification-bell.css',
    'analytics/100-analytics.css',
    'analytics/101-analytics-dashboard.css',
    'editor/102-stock-media.css',
    'settings/103-data-source.css',
    'settings/104-font-manager.css',
    'editor/105-inline-edit.css',
    'editor/106-shortcuts-overlay.css',
    'shell/107-collab-presence.css',
    'editor/108-bulk-edit.css',
    'editor/109-layout-switcher.css',
    'shell/110-sandbox-banner.css',
    'shell/111-maintenance-banner.css',
  ],
};

/** Numeric filename prefix (`10-poll.css` → 10), the default cascade order. */
function filenamePrefix(file) {
  const m = /^(\d+)-/.exec(file);
  if (!m) throw new Error(`CSS file "${file}" has no numeric cascade prefix`);
  return Number(m[1]);
}

/** Effective cascade order: explicit `order` if given, else the filename prefix. */
export function cascadeOrder(entry) {
  return entry.order ?? filenamePrefix(entry.file);
}

/**
 * All import entries for one tier (type-owned + shared), in cascade order.
 * @param {string} tierDir
 * @returns {Array<{ file: string, order: number, type: string|null }>}
 */
export function tierEntries(tierDir) {
  const owned = typeCssEntries()
    .filter((e) => e.tier === tierDir)
    .map((e) => ({ file: e.file, order: cascadeOrder(e), type: e.type }));
  const shared = SHARED_CSS.filter((e) => e.tier === tierDir).map((e) => ({
    file: e.file,
    order: cascadeOrder(e),
    type: null,
  }));
  return [...owned, ...shared].sort((a, b) => a.order - b.order);
}

/** The exact bytes the aggregator file for one tier should contain. */
function buildAggregator(tier) {
  const lines = tierEntries(tier.dir).map(
    (e) => `@import url('./${tier.dir}/${e.file}');`,
  );
  return `${tier.header}\n${lines.join('\n')}\n`;
}

/**
 * The viewer layer's files in cascade order (numeric filename prefix).
 * @returns {string[]}
 */
export function viewerEntries() {
  return [...VIEWER_LAYER.files].sort(
    (a, b) => filenamePrefix(a) - filenamePrefix(b),
  );
}

/** The exact bytes `viewer.css` should contain. */
function buildViewerAggregator() {
  const lines = viewerEntries().map(
    (file) => `@import url('./${VIEWER_LAYER.dir}/${file}');`,
  );
  return `${VIEWER_LAYER.header}\n${lines.join('\n')}\n`;
}

/** The exact bytes `base.css` should contain: the declared order, verbatim. */
function buildAppFeatureAggregator() {
  const lines = APP_FEATURE_LAYER.files.map(
    (file) => `@import url('./${APP_FEATURE_LAYER.dir}/${file}');`,
  );
  return `${APP_FEATURE_LAYER.header}\n${lines.join('\n')}\n`;
}

/** The exact bytes `slides.css` should contain: the foundation, then the tiers. */
function buildRootAggregator() {
  const foundation = FOUNDATION_CSS.map(
    (file) => `@import url('./slides/${file}');`,
  );
  const tiers = TIERS.map(
    (tier) => `@import url('./slides/${tier.aggregator}');`,
  );
  return [
    '/* Shared slide rendering (used by preview, presenter, and exports) */',
    '',
    '/* Design system foundation - must load first: tokens, then the theme layer that binds --t-* to them, then the partial patterns */',
    ...foundation,
    '',
    '/* Slide layouts and components */',
    ...tiers,
    '',
  ].join('\n');
}

/**
 * Map of every aggregator's repo-relative path → expected content,
 * Prettier-formatted with the repo config so `npm run format` and this
 * generator agree (see scripts/lib/format-generated.js).
 * @returns {Promise<Map<string, string>>}
 */
export async function buildAllAggregators() {
  const out = new Map();
  const root = path.join('client', 'styles', ROOT_AGGREGATOR);
  out.set(root, await formatGenerated(root, buildRootAggregator()));
  for (const tier of TIERS) {
    const rel = path.join('client', 'styles', 'slides', tier.aggregator);
    out.set(rel, await formatGenerated(rel, buildAggregator(tier)));
  }
  const viewer = path.join('client', 'styles', VIEWER_LAYER.aggregator);
  out.set(viewer, await formatGenerated(viewer, buildViewerAggregator()));
  const app = path.join('client', 'styles', APP_FEATURE_LAYER.aggregator);
  out.set(app, await formatGenerated(app, buildAppFeatureAggregator()));
  return out;
}

/** Absolute path of an aggregator file for the CLI/test to read or write. */
export function aggregatorAbsPath(tier) {
  return path.join(SLIDES_DIR, tier.aggregator);
}

/** Repo root, for turning the relative paths above into absolute ones. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  let changed = 0;
  for (const [rel, content] of await buildAllAggregators()) {
    const abs = path.join(REPO_ROOT, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current !== content) {
      fs.writeFileSync(abs, content);
      console.log(`updated ${rel}`);
      changed += 1;
    }
  }
  console.log(
    changed
      ? `\n${changed} aggregator(s) rewritten.`
      : 'Aggregators already up to date.',
  );
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not
// — the mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
