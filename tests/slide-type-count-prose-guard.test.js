import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard against unguarded slide-type counts in prose.
 *
 * "How many slide types are there?" is answered by a literal number typed into
 * Markdown in several places. Every one goes stale the moment a type is added or
 * removed: after #480 took the core count from 38 to 37, five prose numbers still
 * said 38 and only a manual audit found them (#481). The fix that landed then was
 * to wrap each count in a `<!--gen:slide-type-count-->N<!--/gen:...-->` span that
 * `scripts/generate-slide-type-docs.js` rewrites — but nothing stopped the *next*
 * bare number from being added outside a span.
 *
 * This scans every committed `.md` for a number sitting directly next to a
 * slide-type-count phrase ("slide types", "built-in slide types", "core types")
 * and fails unless that number is inside a count-marker span. A new count must
 * either go in a marker (and get added to COUNT_MARKER_FILES) or, if it is a
 * genuinely historical or approximate line, be added to ALLOWLIST below with a
 * reason — deliberately narrow, never a broad regex.
 *
 * `docs/plans/` is gitignored working-docs and is excluded (git ls-files does not
 * list it anyway).
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

// A count already wrapped in the generator's marker span is guarded — replace the
// whole span (digits included) so only UNguarded numbers remain to be matched.
const MARKER_SPAN = /<!--gen:slide-type-count-->\d+<!--\/gen:slide-type-count-->/g;

// The count phrases, as they read in prose. A single descriptive adjective may
// sit between the number and "slide types" — "37 typed slide types" (ROADMAP),
// "built-in", "core". The set is curated, not `\w+`, so "section 3 for slide
// type basics" is not mistaken for a count.
const ADJ = String.raw`(?:built-in|core|typed)[\s*_]+`;
const PHRASES = String.raw`(?:${ADJ})?slide[ -]types?|core types`;
// A bare number adjacent to a phrase, either order. Emphasis/whitespace between
// them (`**37** built-in slide types`) is allowed; anything more is not adjacent.
const NUM_BEFORE = new RegExp(String.raw`\b(\d+)[\s*_]{1,3}(?:${PHRASES})`, 'gi');
const NUM_AFTER = new RegExp(String.raw`(?:${PHRASES})[\s*_:]{1,3}(\d+)\b`, 'gi');

/**
 * Lines that are allowed to carry a bare slide-type count. Each entry names the
 * file and a stable substring of the line (excluding the number, so the entry
 * survives the count drifting). Keep this list SHORT and reasoned — an unguarded
 * count is a bug unless there is a specific reason it cannot be a marker span.
 */
const ALLOWLIST = [
  {
    // Generated file: the count is regenerated from the registry and pinned
    // byte-for-byte by tests/slide-type-docs.test.js, so it can't go stale even
    // though it is not wrapped in a marker span.
    file: 'docs/reference/slide-type-inventory.md',
    contains: 'built-in slide types',
  },
  {
    // Approximate, explanatory subset count ("~31 core types that have no usage
    // rule"), not the canonical total. Not worth a marker; drift is cosmetic.
    file: 'docs/reference/slide-type-companions.md',
    contains: 'core types that have no',
  },
  {
    // Frozen historical release note. The changelog records what was true at that
    // release (38 types then); it must NOT track the current count.
    file: 'CHANGELOG.md',
    contains: 'typed slide types with a shared schema',
  },
];

function trackedMarkdownFiles() {
  return execFileSync('git', ['ls-files', '*.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('docs/plans/'));
}

function isAllowlisted(file, line) {
  return ALLOWLIST.some((e) => e.file === file && line.includes(e.contains));
}

test('every slide-type count in committed .md is inside a count-marker span', () => {
  const offenders = [];
  for (const file of trackedMarkdownFiles()) {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    // Blank out guarded spans, then anything numeric left next to a phrase is bare.
    const lines = text.replace(MARKER_SPAN, 'GUARDEDCOUNT').split('\n');
    lines.forEach((line, i) => {
      if (isAllowlisted(file, line)) return;
      for (const re of [NUM_BEFORE, NUM_AFTER]) {
        re.lastIndex = 0;
        if (re.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          break;
        }
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'unguarded slide-type count(s) in prose — wrap the number in ' +
      '<!--gen:slide-type-count-->N<!--/gen:slide-type-count--> and add the file to ' +
      'COUNT_MARKER_FILES, or allowlist the line with a reason:\n' +
      offenders.join('\n')
  );
});
