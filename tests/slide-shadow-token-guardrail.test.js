/**
 * One print guardrail, not six: every *blurred* elevation shadow in the slide
 * stylesheets must read from a `--slide-shadow-*` token, never a literal.
 *
 * Why this is a static test and not (only) an export render:
 *
 * `00-tokens.css` flattens the five `--slide-shadow-*` tokens to `none` under
 * `@media print`, and `render/pdf.js` calls `emulateMediaType('print')`. That is
 * the single guardrail against Chrome turning a blurred `box-shadow` into a
 * `/SMask << /S /Luminosity >>` transparency group — which CoreGraphics (Preview,
 * Quick Look, everything on PDFKit) paints as a solid grey rectangle. Four PDF
 * export defects in one week (#488, #490, #491, #492) all traced to a shadow that
 * set its own literal value and so slipped past that flattening.
 *
 * The `#492` family test (`export-pdf-luminosity-mask.test.js`) counts the masks
 * in a *real* export, but its deck lists four slide types by hand — a new type
 * with a literal blurred shadow isn't in the deck and doesn't fail there. This
 * test catches the *source* instead of the symptom: it fails the moment a literal
 * blurred shadow appears anywhere under `client/styles/slides/**`, in
 * milliseconds and without a browser. The two are complementary.
 *
 * A "blurred" shadow is one whose third length (the blur radius) is non-zero.
 * Hard rings (`0 0 0 6px …`) and inset outlines (`inset 0 0 0 1.5px …`) have a
 * zero blur, never rasterize to a luminosity mask, and are allowed as literals.
 *
 * See `docs/plans/briefs/slide-elevation-tokens.md` (A5, step 1).
 *
 * Run with: node --test tests/slide-shadow-token-guardrail.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLIDES_DIR = path.join(repoRoot, 'client', 'styles', 'slides');

/**
 * The token home itself. `00-tokens.css` is where the five `--slide-shadow-*`
 * literals legitimately live (and get flattened for print) — the whole point is
 * that this is their *only* address, so it is exempt from the scan.
 */
const TOKEN_HOME = '00-tokens.css';

/**
 * Documented exceptions: literal blurred shadows that may not (yet) route through
 * a token. Each entry is `{ file, value, reason }`; a violating shadow layer is
 * excused when its file basename and normalized value both match an entry.
 *
 * Keep this list short and each entry justified — an unexplained addition here is
 * exactly the tolerance-creep this test exists to prevent.
 */
const ALLOWLIST = [
  {
    file: '86-timeline-slide.css',
    value: '0 6px 20px rgba(0, 0, 0, 0.35)',
    reason:
      'Dark-background elevation. 10%-black is invisible on a dark ground, so the ' +
      'dark timeline variant sets a heavier literal. This waits for step 2 (a ' +
      'dark-surface --slide-shadow token); until then it keeps its own local ' +
      '@media print guard. See briefs/slide-elevation-tokens.md § step 2.',
  },
  {
    file: '80-kpi-metrics-slide.css',
    value: '0 18px 48px rgba(0, 0, 0, 0.12)',
    reason:
      'The primary KPI tile is a ring+blur composite: 0 0 0 6px <ring>, <blur>. ' +
      'A token flattened to `none` in print cannot be one item of a comma list ' +
      '(`<ring>, none` is invalid CSS), so the blur cannot route through a single ' +
      'token. Its own local @media print rule drops the blur and keeps the ring.',
  },
];

/** Collapse all runs of whitespace to a single space and trim. */
function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** Strip `/* … *\/` comments so their contents never look like declarations. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Split a shadow value into layers on top-level commas (commas inside `rgba(…)`,
 * `color-mix(…)` etc. do not separate layers).
 * @param {string} value
 * @returns {string[]}
 */
function splitLayers(value) {
  const layers = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      layers.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current);
  return layers;
}

const LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%)?$/;

/**
 * The leading run of length tokens in a shadow layer, in source order. Stops at
 * the first non-length token — the colour or a colour function — because in
 * `box-shadow` syntax the lengths always precede the colour. `inset` is skipped.
 * @param {string} layer
 * @returns {number[]} numeric length values (unit dropped)
 */
function leadingLengths(layer) {
  const lengths = [];
  for (const token of layer.trim().split(/\s+/)) {
    if (token === 'inset') continue;
    if (LENGTH_RE.test(token)) {
      lengths.push(parseFloat(token));
    } else {
      break;
    }
  }
  return lengths;
}

/** A layer is a *literal blurred* shadow when its third length (blur) is > 0. */
function isBlurredLiteral(layer) {
  const lengths = leadingLengths(layer);
  return lengths.length >= 3 && lengths[2] > 0;
}

/** Matches `box-shadow:` and any `--…shadow…:` custom-property declaration. */
const DECL_RE = /(?:^|[;{])\s*(box-shadow|--[\w-]*shadow[\w-]*)\s*:\s*([^;}]*)/g;

/** Recursively collect every `.css` file under a directory. */
function collectCss(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCss(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function isAllowlisted(file, layer) {
  const base = path.basename(file);
  const value = normalize(layer);
  return ALLOWLIST.some((e) => e.file === base && value.includes(e.value));
}

/**
 * Scan a stylesheet and return `{ file, prop, value, layer }` for every literal
 * blurred shadow that is neither in the token home nor on the allowlist.
 */
function findViolations(file) {
  const base = path.basename(file);
  if (base === TOKEN_HOME) return [];
  const css = stripComments(fs.readFileSync(file, 'utf8'));
  const violations = [];
  for (const [, prop, rawValue] of css.matchAll(DECL_RE)) {
    const value = rawValue.trim();
    if (!value || value === 'none') continue;
    for (const layer of splitLayers(value)) {
      if (isBlurredLiteral(layer) && !isAllowlisted(file, layer)) {
        violations.push({
          file: path.relative(repoRoot, file),
          prop,
          value: normalize(value),
          layer: normalize(layer),
        });
      }
    }
  }
  return violations;
}

test('every blurred elevation shadow in client/styles/slides/** reads from a --slide-shadow-* token', () => {
  const files = collectCss(SLIDES_DIR);
  assert.ok(files.length > 0, 'expected slide stylesheets under client/styles/slides');

  const violations = files.flatMap(findViolations);

  const report = violations
    .map((v) => `  ${v.file}\n    ${v.prop}: … ${v.layer} …`)
    .join('\n');

  assert.equal(
    violations.length,
    0,
    'Literal blurred box-shadow(s) found outside 00-tokens.css. Chrome rasterizes ' +
      'these as /S /Luminosity soft masks that CoreGraphics paints as solid grey ' +
      'rectangles in exported PDFs. Route each through a --slide-shadow-* token (which ' +
      'is flattened under @media print in 00-tokens.css), or, if it genuinely cannot ' +
      'yet, add a justified entry to ALLOWLIST in this file:\n' +
      report,
  );
});

test('the guardrail parser flags a blurred literal and clears rings and tokens', () => {
  // Guards the guard: if these classifications ever flip, the scan above is lying.
  assert.equal(isBlurredLiteral('0 4px 24px rgba(0, 0, 0, 0.10)'), true, 'blur radius > 0');
  assert.equal(isBlurredLiteral('0 8px 32px rgba(0, 0, 0, 0.12)'), true, 'blur radius > 0');
  assert.equal(isBlurredLiteral('0 0 0 6px rgba(0, 0, 0, 0.10)'), false, 'hard ring, blur 0');
  assert.equal(isBlurredLiteral('inset 0 0 0 1.5px rgb(255 255 255 / 0.6)'), false, 'inset ring');
  assert.equal(isBlurredLiteral('var(--slide-shadow-card)'), false, 'token reference');
  assert.equal(isBlurredLiteral('none'), false, 'no shadow');

  // The composite the KPI tile uses: the ring layer clears, the blur layer flags.
  const composite = splitLayers(
    '0 0 0 6px color-mix(in srgb, var(--slide-accent) 18%, transparent), 0 18px 48px rgba(0, 0, 0, 0.12)',
  );
  assert.equal(composite.length, 2, 'top-level comma splits two layers');
  assert.equal(isBlurredLiteral(composite[0]), false, 'ring layer');
  assert.equal(isBlurredLiteral(composite[1]), true, 'blur layer');
});
