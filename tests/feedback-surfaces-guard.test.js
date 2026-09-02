/**
 * Feedback surfaces: the guard that keeps the doctrine from drifting (B202).
 *
 * docs/reference/feedback-surfaces.md says which carrier a message belongs
 * in: a *refusal of what the user is doing now* is an inline state of the
 * form (client/lib/dom/inline-error.js), never a toast; a *background*
 * failure lives in a chip or banner; a toast is for a passing message about an
 * action with no form on screen. Before the doctrine, 26 spellings of the
 * inline element grew because there was no helper to reach for, and every
 * refusal fix added one more. Three guards here, all with an allowlist that
 * only shrinks:
 *
 *  1. refuse-and-return — a `toast.error(...)` that is the whole answer of a
 *     guard clause (`if (…) { toast.error(…); return; }`). That shape *is* a
 *     refusal of the current action; the allowlist is the sites B204 moves to
 *     the helper.
 *  2. the ratchet — every file that still carries a discarded server message or
 *     a background failure in a toast (the B205/B206 burndown) is listed with
 *     its `toast.error` count. A rise means a new toast in a file under
 *     cleanup; lower the number when you move a site. B204's refusals are at
 *     zero, which is why no file is listed for them any more.
 *  3. error classes — no `*-error` / `is-error` class applied outside the
 *     helper. The message idioms were B204's and are all gone; the state
 *     markers (a thumb that failed to render) are not messages and stay.
 *
 * A regex over source is a heuristic. What it cannot see — an API refusal
 * caught in a save handler and toasted, which looks like any other catch —
 * the ratchet covers by file, and review covers by reading.
 *
 * Run with: node --test tests/feedback-surfaces-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// ------------------------------------------------------------ the allowlists

/**
 * Files that still report a discarded server message (B205) or a background
 * failure (B206) through `toast.error`. `total` is every `toast.error(` call in
 * the file, the other numbers say how many of those belong to which burndown;
 * the rest are legitimate pass-throughs. Inventory:
 * docs/plans/briefs/feedback-surfaces.md (2026-09-02).
 *
 * `refusals` is at zero: B204 PR 2 moved the last thirteen — an API refusal
 * caught in a save handler and toasted — to `createInlineError()`. The key
 * stays in `BURNDOWN` so a new one has to be argued for rather than counted.
 */
const TOAST_SITES = [
  // --- the server's sentence thrown away for generic copy (B205) ---
  {
    file: 'client/lib/slide-library/edit-modal.js',
    total: 2,
    discarded: 2,
  },
  {
    file: 'client/views/editor/inline-edit/inline-editor.js',
    total: 2,
    discarded: 1,
  },
  {
    file: 'client/views/editor/modals/json-debug-modal.js',
    total: 3,
    discarded: 3,
  },
  { file: 'client/lib/user/organization-switcher.js', total: 1, discarded: 1 },
  {
    file: 'client/lib/format/analytics-erase-button.js',
    total: 1,
    discarded: 1,
  },
  {
    file: 'client/views/settings/tabs/export-tab.js',
    total: 3,
    discarded: 1,
    background: 1,
  },
  {
    file: 'client/views/settings/tabs/slide-types-tab/index.js',
    total: 9,
    discarded: 2,
    background: 1,
  },
  {
    file: 'client/views/settings/organization-members/actions.js',
    total: 3,
    discarded: 1,
  },
  {
    file: 'client/views/settings/admin-users/add-modal.js',
    total: 1,
    discarded: 1,
  },
  {
    file: 'client/views/settings/admin-users/actions.js',
    total: 3,
    discarded: 2,
  },
  { file: 'client/views/list/bulk-action-bar.js', total: 3, discarded: 3 },
  {
    file: 'client/views/list/views/slide-library-view.js',
    total: 2,
    discarded: 2,
  },
  {
    file: 'client/views/list/views/sandbox-examples.js',
    total: 1,
    discarded: 1,
  },
  { file: 'client/views/editor/topbar.js', total: 2, discarded: 1 },
  { file: 'client/views/editor/topbar/more-menu.js', total: 3, discarded: 1 },
  { file: 'client/views/editor/export-modal.js', total: 1, discarded: 1 },
  // --- background failures that expire in a toast (B206) ---
  { file: 'client/lib/slide-library/modals.js', total: 2, background: 2 },
  { file: 'client/views/notes/notes-editor.js', total: 1, background: 1 },
  { file: 'client/views/editor/save-manager.js', total: 4, background: 4 },
  { file: 'client/views/editor/editor-controller.js', total: 1, background: 1 },
];

/** The burndown as the TODO items state it; each PR lowers both. */
const BURNDOWN = { refusals: 0, discarded: 24, background: 10 };

/**
 * `toast.error` as the whole answer of a guard clause. Every one of these is
 * a refusal of the current action; B204 moves them to the inline helper.
 *
 * What is left after B204 PR 1 is the shape without a form to put a message
 * in: a modal that refuses to open at all (edit-modal, json-debug-modal), a
 * menu item, a card action, a file dropped on the canvas. Those are failures
 * of an action with no form on screen — the third kind, whose carrier *is* a
 * toast — so B205 settles their wording, not their placement.
 */
const REFUSE_AND_RETURN = [
  { file: 'client/lib/slide-library/edit-modal.js', hits: 2 },
  { file: 'client/views/editor/inline-edit/inline-editor.js', hits: 1 },
  { file: 'client/views/editor/modals/json-debug-modal.js', hits: 1 },
  { file: 'client/views/editor/topbar.js', hits: 1 },
  { file: 'client/views/editor/topbar/more-menu.js', hits: 1 },
  { file: 'client/views/settings/tabs/slide-types-tab/index.js', hits: 1 },
];

/**
 * Hand-rolled error classes. Only `state` markers are left: a thumb or card
 * that failed to render, which carries no sentence and is not this guard's
 * concern — listed so the count is exact.
 *
 * The `message` idioms are gone (B204 PR 3). The nineteen files that spelled
 * the message element by hand now reach for `createInlineError()`, and the
 * handful that were never messages at all — a whole-page "not found", a
 * dashboard banner, the icon of an error card — were renamed after what they
 * are, so a `*-error` class name means one thing: the inline message element.
 */
const ERROR_CLASS_IDIOMS = [
  { file: 'client/lib/slide-runtime/video-layer.js', hits: 1, kind: 'state' },
  { file: 'client/views/editor/deck-grid.js', hits: 3, kind: 'state' },
  {
    file: 'client/views/editor/slide-type-picker/index.js',
    hits: 2,
    kind: 'state',
  },
  {
    file: 'client/views/editor/slide-type-picker/library-strip.js',
    hits: 2,
    kind: 'state',
  },
  {
    file: 'client/views/editor/slide-type-picker/peek.js',
    hits: 1,
    kind: 'state',
  },
  {
    file: 'client/views/settings/tabs/slide-types-tab/curation-thumbnails.js',
    hits: 2,
    kind: 'state',
  },
];

// --------------------------------------------------------------- the scanner

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const isComment = (line) => {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};
const isBlankOrComment = (line) => !line.trim() || isComment(line);

/** The line on which the call that opens on `start` closes. */
function callEnd(lines, start) {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth <= 0) return i;
  }
  return lines.length - 1;
}

/**
 * Whether the `toast.error(` on line `i` is the whole answer of a guard
 * clause: the previous code line opens an `if`/`else` block, and a `return`
 * follows the call before the block closes.
 * @param {string[]} lines
 * @param {number} i
 * @returns {boolean}
 */
function isRefuseAndReturn(lines, i) {
  let j = i - 1;
  while (j >= 0 && isBlankOrComment(lines[j])) j--;
  const opener = j >= 0 ? lines[j] : '';
  if (!/\b(?:if|else)\b.*\{\s*$/.test(opener)) return false;
  const end = callEnd(lines, i);
  for (let k = end + 1; k <= end + 3 && k < lines.length; k++) {
    if (/^\s*return\b/.test(lines[k])) return true;
    if (/^\s*\}/.test(lines[k])) return false;
  }
  return false;
}

/** A class token that spells an error surface by hand. */
const ERROR_CLASS_TOKEN = /^(?:[a-z0-9]+-)+error(?:-[a-z0-9]+)*$|^is-error$/;
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** The class tokens on a line that name an error surface, helper excluded. */
function errorClassTokens(line) {
  if (!/\bclass(?:Name|List)?\b/.test(line)) return [];
  const out = [];
  for (const m of line.matchAll(STRING_LITERAL)) {
    for (const tok of m[0].slice(1, -1).split(/\s+/)) {
      if (tok !== 'inline-error' && ERROR_CLASS_TOKEN.test(tok)) out.push(tok);
    }
  }
  return out;
}

/** Scan client/ once; every guard reads from this. */
function scan() {
  const perFile = new Map();
  for (const file of walk(path.join(repoRoot, 'client'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const found = { toastErrors: 0, refuseAndReturn: [], errorClasses: [] };
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      if (/toast\.error\(/.test(line)) {
        found.toastErrors += 1;
        if (isRefuseAndReturn(lines, i)) found.refuseAndReturn.push(i + 1);
      }
      for (const tok of errorClassTokens(line)) {
        found.errorClasses.push(`${i + 1}:${tok}`);
      }
    });
    perFile.set(rel, found);
  }
  return perFile;
}

const SCAN = scan();

/**
 * Compare what the scan found per file against an allowlist of counts.
 * @returns {string[]} Human-readable mismatches, empty when the list is exact.
 */
function diffCounts(allow, pick, label) {
  const listed = new Map(allow.map((a) => [a.file, a]));
  const problems = [];
  for (const [file, found] of SCAN) {
    const n = pick(found);
    const entry = listed.get(file);
    if (!entry && n > 0) {
      problems.push(`${file}: ${n} ${label} not on the allowlist`);
    } else if (entry && n !== entry.expected) {
      problems.push(
        `${file}: ${n} ${label}, allowlist says ${entry.expected} — ` +
          (n < entry.expected
            ? 'lower the number (the list only shrinks)'
            : 'a new one appeared'),
      );
    }
  }
  for (const [file, entry] of listed) {
    if (!SCAN.has(file)) problems.push(`${file}: listed but gone — drop it`);
    else if (entry.expected === 0) problems.push(`${file}: at zero — drop it`);
  }
  return problems;
}

// ----------------------------------------------------------------- the guards

test('guard 1: a refusal that is the whole answer of a guard clause is not toasted', () => {
  const allow = REFUSE_AND_RETURN.map((a) => ({ ...a, expected: a.hits }));
  assert.deepEqual(
    diffCounts(allow, (f) => f.refuseAndReturn.length, 'refuse-and-return'),
    [],
    'a form that says no does so beside the control, through ' +
      'createInlineError() (client/lib/dom/inline-error.js) — see ' +
      'docs/reference/feedback-surfaces.md',
  );
});

test('guard 2: no file under the toast burndown gains a toast.error', () => {
  const allow = TOAST_SITES.map((a) => ({ ...a, expected: a.total }));
  // Files with no burndown share are not ratcheted: a pass-through toast for
  // an action without a form is the right carrier and may be added freely.
  const ratcheted = new Set(allow.map((a) => a.file));
  const scoped = (f, file) => (ratcheted.has(file) ? f.toastErrors : 0);
  const problems = [];
  for (const [file, found] of SCAN) {
    const n = scoped(found, file);
    const entry = allow.find((a) => a.file === file);
    if (entry && n !== entry.expected) {
      problems.push(
        `${file}: ${n} toast.error calls, allowlist says ${entry.expected}`,
      );
    }
  }
  for (const entry of allow) {
    if (!SCAN.has(entry.file)) problems.push(`${entry.file}: gone — drop it`);
    const share =
      (entry.refusals || 0) + (entry.discarded || 0) + (entry.background || 0);
    if (share === 0)
      problems.push(`${entry.file}: no burndown share — drop it`);
    if (share > entry.total) problems.push(`${entry.file}: share > total`);
  }
  assert.deepEqual(problems, []);
});

test('guard 2: the burndown totals are what the TODO items say', () => {
  const sum = (key) => TOAST_SITES.reduce((n, a) => n + (a[key] || 0), 0);
  assert.deepEqual(
    {
      refusals: sum('refusals'),
      discarded: sum('discarded'),
      background: sum('background'),
    },
    BURNDOWN,
    'moved a site? lower BURNDOWN here and the count in docs/plans/TODO.md',
  );
});

test('guard 3: no error class is applied outside the inline helper', () => {
  const allow = ERROR_CLASS_IDIOMS.map((a) => ({ ...a, expected: a.hits }));
  assert.deepEqual(
    diffCounts(allow, (f) => f.errorClasses.length, 'error class(es)'),
    [],
    'the message element is createInlineError().el (class `inline-error`); ' +
      'a new `*-error` / `is-error` class is idiom number 27',
  );
});

// ---------------------------------------------------------------- self-tests

test('the refuse-and-return pattern matches the shapes it retires', () => {
  const retired = [
    [
      '    if (!state.label.trim()) {',
      '      toast.error(',
      "        t('settings.themes.errorNameRequired', 'Theme name is required.'),",
      '      );',
      '      nameInput.focus();',
      '      return;',
      '    }',
    ],
    [
      '    if (problem) {',
      '      toast.error(problem);',
      '      return;',
      '    }',
    ],
    [
      '    } else if (!file.type.startsWith("image/")) {',
      '      // Say why, not just no.',
      '      toast.error(t("x", "Not an image"), { id: "drop" });',
      '      return false;',
      '    }',
    ],
  ];
  for (const lines of retired) {
    const at = lines.findIndex((l) => /toast\.error\(/.test(l));
    assert.ok(
      isRefuseAndReturn(lines, at),
      `should flag:\n${lines.join('\n')}`,
    );
  }
});

test('the refuse-and-return pattern leaves a caught failure alone', () => {
  const legal = [
    [
      '    try {',
      '      await api(`/api/decks/${id}`, { method: "DELETE" });',
      '    } catch (err) {',
      '      toast.error(err);',
      '    }',
    ],
    [
      '    if (!ok) {',
      '      toast.error(err);',
      '      state.busy = false;',
      '      render();',
      '      retry();',
      '    }',
    ],
  ];
  for (const lines of legal) {
    const at = lines.findIndex((l) => /toast\.error\(/.test(l));
    assert.equal(
      isRefuseAndReturn(lines, at),
      false,
      `should not flag:\n${lines.join('\n')}`,
    );
  }
});

test('the class pattern flags hand-rolled error classes, not the helper or ids', () => {
  assert.deepEqual(
    errorClassTokens("  const el = h('div', { class: 'share-links-error' });"),
    ['share-links-error'],
  );
  assert.deepEqual(
    errorClassTokens("      status.className = 'auth-status is-error';"),
    ['is-error'],
  );
  assert.deepEqual(errorClassTokens("  wrap.classList.add('is-error');"), [
    'is-error',
  ]);
  assert.deepEqual(
    errorClassTokens(
      "  const el = h('div', { class: 'inline-error is-callout' });",
    ),
    [],
    'the helper is the one allowed spelling',
  );
  assert.deepEqual(
    errorClassTokens("  toast.error(t('x'), { id: 'bulk-delete-error' });"),
    [],
    'a toast id is not a class',
  );
  assert.deepEqual(
    errorClassTokens("  el.classList.add('is-invalid');"),
    [],
    'a container marked invalid carries no sentence',
  );
});
