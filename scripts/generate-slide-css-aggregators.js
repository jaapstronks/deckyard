#!/usr/bin/env node
// Derive the per-tier `@import` aggregators under `client/styles/slides/` from a
// declared manifest instead of hand-maintaining the import lists.
//
// WHY THIS EXISTS
// The three aggregator files (`01-layout-and-title.css`, `02-content-and-media.css`,
// `03-components.css`) are just ordered lists of `@import`s. Hand-maintained, they
// drift: a new slide type gets a stylesheet but nobody wires it in, or a removed
// type leaves an orphaned import. This makes the list a build product of a
// manifest, and `tests/slide-css-aggregators.test.js` gates it (byte-identical to
// the committed files, every type real, every file on disk claimed exactly once).
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

const SLIDES_DIR = fileURLToPath(new URL('../client/styles/slides/', import.meta.url));

/**
 * The tiers, in the order `slides.css` imports them. Each is one aggregator
 * file whose imports all point into the matching subdirectory.
 * @type {Array<{ dir: string, aggregator: string, header: string }>}
 */
export const TIERS = [
  {
    dir: '01-layout-and-title',
    aggregator: '01-layout-and-title.css',
    header: '/* Shared slide rendering (used by preview, presenter, and exports) */',
  },
  {
    dir: '02-content-and-media',
    aggregator: '02-content-and-media.css',
    header: '/* Content and media slide styles (split for maintainability) */',
  },
  {
    dir: '03-components',
    aggregator: '03-components.css',
    header: '/* Shared slide rendering (used by preview, presenter, and exports) */',
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
  'title-slide': [{ tier: '01-layout-and-title', file: '21-title-slide-universal.css' }],
  'content-slide': [{ tier: '01-layout-and-title', file: '30-content.css' }],
  'table-slide': [{ tier: '01-layout-and-title', file: '35-table-slide.css' }],
  'image-slide': [{ tier: '01-layout-and-title', file: '40-image-slide.css' }],
  'image-text-slide': [
    { tier: '01-layout-and-title', file: '50-image-text-slide.css' },
    { tier: '02-content-and-media', file: '10-image-text.css' },
  ],
  'list-slide': [{ tier: '01-layout-and-title', file: '60-list-slide.css' }],
  'kpi-metrics-slide': [{ tier: '01-layout-and-title', file: '80-kpi-metrics-slide.css' }],
  'comparison-slide': [{ tier: '01-layout-and-title', file: '82-comparison-slide.css' }],
  'process-slide': [{ tier: '01-layout-and-title', file: '84-process-slide.css' }],
  'timeline-slide': [{ tier: '01-layout-and-title', file: '86-timeline-slide.css' }],
  'matrix-slide': [{ tier: '01-layout-and-title', file: '88-matrix-slide.css' }],
  'funnel-slide': [{ tier: '01-layout-and-title', file: '90-funnel-slide.css' }],
  'pyramid-slide': [{ tier: '01-layout-and-title', file: '91-pyramid-slide.css' }],
  'cycle-slide': [{ tier: '01-layout-and-title', file: '92-cycle-slide.css' }],
  'gallery-slide': [{ tier: '01-layout-and-title', file: '93-gallery-slide.css' }],

  // Tier 02 — content and media
  'video-slide': [{ tier: '02-content-and-media', file: '20-video.css' }],
  'embed-slide': [{ tier: '02-content-and-media', file: '30-embed.css' }],
  'quote-slide': [{ tier: '02-content-and-media', file: '40-quote.css' }],
  'text-blocks-slide': [{ tier: '02-content-and-media', file: '80-text-blocks.css' }],

  // Tier 03 — components
  'icon-card-grid-slide': [
    { tier: '02-content-and-media', file: '60-icon-card-grid.css' },
    { tier: '02-content-and-media', file: '75-icon-card-grid-variants.css' },
    { tier: '03-components', file: '00-icon-card-grid.css' },
  ],
  'follow-invite-slide': [{ tier: '03-components', file: '15-follow-invite.css' }],
  'feedback-slide': [{ tier: '03-components', file: '16-feedback.css' }],
  'lead-capture-slide': [{ tier: '03-components', file: '17-lead-capture.css' }],
  'countdown-slide': [{ tier: '03-components', file: '18-countdown.css' }],
  // Filename says 10, but this has always loaded after 18-countdown.css.
  // The cascade position is 19; the filename is not touched (that would be a
  // move, out of scope for this brief).
  'poll-slide': [{ tier: '03-components', file: '10-poll.css', order: 19 }],
  'chart-slide': [{ tier: '03-components', file: '20-chart.css' }],
  'custom-html-slide': [{ tier: '03-components', file: '26-custom-html.css' }],
  'chapter-title-slide': [{ tier: '03-components', file: '30-chapter-title.css' }],
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
    list.map((e) => ({ type, ...e }))
  );
}

/**
 * Stylesheets owned by no single type: base layout, shared media/card layouts,
 * and the presenter/export chrome. Declared here because the registry has
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
  // Tier 02 — the card-link overlay is a genuinely shared component
  // (cardLinkOverlayHtml helper; icon-card-grid and logo-wall both render it)
  { tier: '02-content-and-media', file: '70-card-links.css' },
  // Tier 03
  { tier: '03-components', file: '50-presenter-layout.css' },
  { tier: '03-components', file: '51-presenter-console.css' },
  { tier: '03-components', file: '52-morph-transition.css' },
  { tier: '03-components', file: '53-present-window.css' },
  { tier: '03-components', file: '60-accessibility.css' },
  { tier: '03-components', file: '70-step-reveal.css' },
  { tier: '03-components', file: '80-presenter-progress.css' },
  { tier: '03-components', file: '82-auto-advance.css' },
  { tier: '03-components', file: '85-presenter-start.css' },
  { tier: '03-components', file: '90-presenter-edge-hint.css' },
  { tier: '03-components', file: '95-export-scale.css' },
  { tier: '03-components', file: '97-text-styles.css' },
];

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
    (e) => `@import url('./${tier.dir}/${e.file}');`
  );
  return `${tier.header}\n${lines.join('\n')}\n`;
}

/**
 * Map of every aggregator's repo-relative path → expected content.
 * @returns {Map<string, string>}
 */
export function buildAllAggregators() {
  const out = new Map();
  for (const tier of TIERS) {
    out.set(path.join('client', 'styles', 'slides', tier.aggregator), buildAggregator(tier));
  }
  return out;
}

/** Absolute path of an aggregator file for the CLI/test to read or write. */
export function aggregatorAbsPath(tier) {
  return path.join(SLIDES_DIR, tier.aggregator);
}

/** Repo root, for turning the relative paths above into absolute ones. */
export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

function main() {
  let changed = 0;
  for (const [rel, content] of buildAllAggregators()) {
    const abs = path.join(REPO_ROOT, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current !== content) {
      fs.writeFileSync(abs, content);
      console.log(`updated ${rel}`);
      changed += 1;
    }
  }
  console.log(changed ? `\n${changed} aggregator(s) rewritten.` : 'Aggregators already up to date.');
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not
// — the mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
