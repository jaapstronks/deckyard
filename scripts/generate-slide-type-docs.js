#!/usr/bin/env node
// Generate the registry-derived parts of the slide-type docs: the inventory doc,
// the type COUNTS in prose, and the per-type editing-surface tables.
//
// WHY THIS EXISTS
// "How many slide types are there?" was answered by a literal number typed into
// prose in several places (README, the inspector reference) and by a full list
// nowhere. Every number is a maintenance debt that goes stale the moment a type
// is added or removed. This derives one canonical inventory
// (docs/reference/slide-type-inventory.md) from the registry, and fills the
// number into marker spans elsewhere so no count is hand-tracked.
//
// The count is of CORE types (shared/slide-types/types/*.js), via
// CORE_SLIDE_TYPE_NAMES — NOT Object.keys(SLIDE_TYPES), which on a fork checkout
// includes types dropped into custom/slide-types/ and would over-report.
//
// A count that is NOT inside a marker span is unguarded and will go stale: a
// docs audit on 2026-07-30 found five such numbers still saying 38 after #480
// took the core count to 37. If you write a type count into prose, wrap it in
// the marker and add the file to COUNT_MARKER_FILES below.
//
// The same argument applies one size up: a per-type TABLE that restates the
// field schema, the inline descriptor or the inspector keep-list is a hand-kept
// copy of a declaration, and both such tables had drifted by the time they were
// measured (see scripts/lib/slide-type-doc-tables.js). They are now generated
// into marker REGIONS inside the two otherwise hand-written reference docs —
// TABLE_REGION_FILES below.
//
// Run `node scripts/generate-slide-type-docs.js` to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  CORE_PROFILE,
  DECLARED_SLIDE_TYPES,
  slideFallback,
  slideTypeTier,
} from '../shared/slide-types/tiers.js';
import {
  renderCanvasTable,
  renderCoverageTable,
} from './lib/slide-type-doc-tables.js';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const INVENTORY_DOC = 'docs/reference/slide-type-inventory.md';

/** Files carrying a hand-written type count inside marker spans (see below). */
export const COUNT_MARKER_FILES = [
  'README.md',
  'ROADMAP.md',
  'docs/reference/editor-inspector.md',
  'docs/reference/slide-type-structure.md',
  'docs/reference/deck-conformance.md',
  'docs/reference/ai-wizard-prompts.md',
];

const MARKER_OPEN = '<!--gen:slide-type-count-->';
const MARKER_CLOSE = '<!--/gen:slide-type-count-->';

/**
 * Whole blocks of Markdown this script owns inside otherwise hand-written docs,
 * as `file → { region-name: () => markdown }`.
 *
 * A count marker guards one number; these guard a whole per-type table. Same
 * bargain either way: the prose around it stays hand-written, the part that
 * restates a declaration is regenerated, and the byte-gate in
 * tests/slide-type-docs.test.js fails the build when the two disagree.
 *
 * Adding a region: wrap the block in
 * `<!--gen:<name>-->` … `<!--/gen:<name>-->` and add the renderer here.
 */
export const TABLE_REGION_FILES = {
  'docs/reference/editor-inspector.md': {
    'slide-type-coverage': renderCoverageTable,
  },
  'docs/reference/wysiwyg-inline-editing.md': {
    'slide-type-canvas': renderCanvasTable,
  },
};

/** The fork-stable count of built-in slide types. */
export function coreCount() {
  return CORE_SLIDE_TYPE_NAMES.length;
}

/**
 * The generated inventory markdown. Rows are in registration order (the order of
 * shared/slide-types/registry.js), so the doc reads the way the registry does.
 */
function renderInventoryDoc() {
  const rows = CORE_SLIDE_TYPE_NAMES.map((name) => {
    const def = SLIDE_TYPES[name] || {};
    const label = def.label || '';
    const status = def.deprecated ? 'Deprecated' : 'Active';
    const fallback = slideFallback(def);
    return `| \`${name}\` | ${label} | ${status} | ${slideTypeTier(name)} | ${
      fallback ? `\`${fallback}\`` : '—'
    } |`;
  });
  const active = CORE_SLIDE_TYPE_NAMES.filter((n) => !SLIDE_TYPES[n]?.deprecated).length;
  const deprecated = coreCount() - active;
  const declaredRows = Object.entries(DECLARED_SLIDE_TYPES).map(
    ([name, entry]) =>
      `| \`${name}\` | ${entry.tier} | \`${entry.fallback}\` | ${entry.structure} |`
  );

  return [
    '<!-- GENERATED FILE — do not edit by hand.',
    '     Run `node scripts/generate-slide-type-docs.js` to regenerate.',
    '     Source of truth: shared/slide-types/registry.js. -->',
    '',
    '# Slide-type inventory',
    '',
    `Deckyard ships **${coreCount()}** built-in slide types (${active} active, ` +
      `${deprecated} deprecated but still rendered for existing decks). A fork may add ` +
      'more under `custom/slide-types/`; those are not counted here.',
    '',
    'This table is generated from the registry so the count and the list cannot',
    'drift from the code. To change it, add or remove a type in',
    '`shared/slide-types/registry.js` and regenerate — do not edit this file.',
    '',
    `**Tier** is the promise, not the quality: tier 1 is the ${CORE_PROFILE.length}-type core`,
    'profile a conforming implementation must render, tier 2 is the rest of what we',
    'ship, tier 3 is fork and org types (absent from this table by definition).',
    '**Fallback** is the tier-1 contract a core-profile-only reader should use.',
    'See [`slide-type-tiers.md`](./slide-type-tiers.md).',
    '',
    '| Type | Label | Status | Tier | Fallback |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Declared, not built',
    '',
    'Names that are part of the published format with no implementation behind',
    'them yet. A reader degrades them exactly as it would any other tier-2 type.',
    '',
    '| Type | Tier | Fallback | Structure |',
    '|---|---|---|---|',
    ...declaredRows,
    '',
  ].join('\n');
}

/** Replace the number inside every count-marker span in `text`. */
function applyCountMarkers(text, count = coreCount()) {
  const re = new RegExp(
    `${escapeRe(MARKER_OPEN)}[\\s\\S]*?${escapeRe(MARKER_CLOSE)}`,
    'g'
  );
  return text.replace(re, `${MARKER_OPEN}${count}${MARKER_CLOSE}`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the body of every generated region in `text`.
 *
 * A missing region is an error rather than a silent skip: a doc that lost its
 * markers would otherwise regenerate to itself forever while the table inside it
 * went stale — precisely the failure mode this file exists to end.
 *
 * @param {string} text - the doc as committed
 * @param {Record<string, () => string>} regions - region name → renderer
 * @param {string} rel - repo-relative path, for the error message
 * @returns {string}
 */
export function applyRegions(text, regions, rel) {
  let out = text;
  for (const [name, render] of Object.entries(regions || {})) {
    const open = `<!--gen:${name}-->`;
    const close = `<!--/gen:${name}-->`;
    const re = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`);
    if (!re.test(out)) {
      throw new Error(
        `${rel}: missing generated region "${name}" — the doc must contain ` +
          `${open} … ${close} for this script to fill.`
      );
    }
    out = out.replace(re, `${open}\n${render()}\n${close}`);
  }
  return out;
}

/**
 * Map of every doc this script owns → expected content. The test compares these
 * against disk; the CLI writes them.
 * @returns {Map<string, string>}
 */
export function buildAllDocs() {
  const out = new Map();
  out.set(INVENTORY_DOC, renderInventoryDoc());
  const partial = new Set([...COUNT_MARKER_FILES, ...Object.keys(TABLE_REGION_FILES)]);
  for (const rel of partial) {
    const abs = path.join(REPO_ROOT, rel);
    let text = fs.readFileSync(abs, 'utf8');
    if (COUNT_MARKER_FILES.includes(rel)) text = applyCountMarkers(text);
    if (TABLE_REGION_FILES[rel]) text = applyRegions(text, TABLE_REGION_FILES[rel], rel);
    out.set(rel, text);
  }
  return out;
}

function main() {
  let changed = 0;
  for (const [rel, content] of buildAllDocs()) {
    const abs = path.join(REPO_ROOT, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current !== content) {
      fs.writeFileSync(abs, content);
      console.log(`updated ${rel}`);
      changed += 1;
    }
  }
  console.log(changed ? `\n${changed} file(s) rewritten.` : 'Docs already up to date.');
}

// pathToFileURL, not a template literal: the repo path may contain spaces,
// which import.meta.url percent-encodes and a raw `file://${argv[1]}` does not
// — the mismatch would make this script a silent no-op (see scripts/i18n-audit.js).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
