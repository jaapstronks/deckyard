/**
 * The `innerHTML` gate: every write in `client/` is either a static literal or
 * a documented, justified exception.
 *
 * `docs/reference/html-escaping.md` classified the whole surface once (B8) and
 * concluded that every current write is safe. That conclusion had no guard:
 * nothing stopped the next contributor from adding a seventh site that
 * interpolates user text raw — which is exactly the one real XSS the sweep
 * found (the slide-list drag ghost, PR #370).
 *
 * This test is that guard. It scans every non-vendor `.js` file under
 * `client/`, finds each `innerHTML` assignment, and **fails** unless the
 * right-hand side is one of:
 *
 *   (a) a single string or template literal with **no** `${…}` interpolation
 *       and no concatenation — the static SVG icons and `= ''` clears; or
 *   (b) listed below with a verdict.
 *
 * The rule is deliberately mechanical: it cannot tell `ICONS[name]` (an
 * author-controlled constant) from `resp.preview.htmlContent` (server data),
 * so both need an entry. That is the point — indirection is exactly where an
 * unsafe value hides, so each one is written down and re-argued when it moves.
 *
 * Adding a site? Prefer `h()` from `client/lib/dom.js` and you need no entry at
 * all. If it must be `innerHTML`, route the value through `escapeHtml()`,
 * `markdownToSafeHtml()` or `sanitizeHtml()` and add an entry with the verdict.
 * An entry without a reason is the tolerance-creep this test exists to prevent.
 *
 * See `docs/plans/briefs/unsanitized-innerhtml-sites.md` (B38) and
 * `docs/reference/html-escaping.md` § "The gate".
 *
 * Run with: node --test tests/no-unsanitized-innerhtml.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CLIENT_DIR = path.join(repoRoot, 'client');

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

// ---------------------------------------------------------------------------
// The allowlist, in three groups — the grouping is the argument.
// ---------------------------------------------------------------------------

/**
 * **Group 1 — user-authored text.** The six sites where the value derives from
 * something a person typed. Escaping or sanitizing is the only thing making
 * them safe, so each verdict names the mechanism. A seventh entry here is a
 * security decision, not a chore: the count is pinned by a test below.
 */
const USER_TEXT_SITES = [
  {
    file: 'client/app.js',
    rhs: '` <div class="app-shell">…',
    reason:
      'Fatal-error screen. Every interpolated value — the error message, the ' +
      'stack, and each translated string — goes through escapeHtml() at the ' +
      'interpolation site.',
  },
  {
    file: 'client/views/share-viewer/guest-join.js',
    rhs: '` <div class="share-viewer-success-icon">…',
    reason:
      'Guest email-sent confirmation. The one user value (the address) is ' +
      'passed to t() pre-escaped with escapeHtml(); the rest are bundled ' +
      'i18n strings.',
  },
  {
    file: 'client/views/notes/notes-editor.js',
    rhs: 'html',
    reason:
      'Speaker notes. Either markdownToSafeHtml() output (which runs ' +
      'sanitizeHtmlSync() from shared/sanitize.js — the sanctioned rich-text ' +
      'path) or a static empty-state paragraph.',
  },
  {
    file: 'client/views/presenter/console.js',
    rhs: 'notes.trim() ? markdownToSafeHtml(notes)…',
    reason:
      'Presenter-console speaker notes; same markdownToSafeHtml() path as notes/notes-editor.js.',
  },
  {
    file: 'client/views/editor/modals/json-debug-modal.js',
    rhs: 'renderSchemaAsHtml(schemaDoc)',
    reason:
      'Self-escaping renderer: renderSchemaAsHtml() escapes & < > before ' +
      'applying its mini-markdown transforms, so no raw value reaches the sink.',
  },
  {
    file: 'client/views/settings/email-templates/actions.js',
    rhs: 'resp.preview.htmlContent',
    reason:
      'Intentional trusted HTML — an email-template preview, rendered verbatim ' +
      'by design (the shipped defaults contain markup). Re-verified 2026-08-04: ' +
      'POST /api/admin/email-templates/:type/preview is gated on user.isAdmin ' +
      'before any branch dispatches (server/routes/api/email-templates.js:55-63), ' +
      'buildPreviewHtml() escapes greeting, buttonLabel, footer and the button ' +
      'URL, and the only raw field (body) is written by the same instance-admin ' +
      'gate on PUT :type/:locale. Writer and reader hold identical privilege, so ' +
      'this is not the guest-writes-into-admin-view shape of the comment ' +
      'author_email leak.',
  },
];

/**
 * **Group 2 — author-controlled constants reached indirectly.** Static SVG that
 * a lookup or a ternary stands between, so the mechanical rule cannot see the
 * literal. No runtime data touches these; the keys are internal enums.
 */
const INDIRECT_STATIC_SITES = [
  {
    file: 'client/lib/dom/icons.js',
    rhs: 'innerHTML',
    reason:
      'Icon factory. Every caller in this module passes a module-level static ' +
      'SVG path literal; the parameter is never reached from outside.',
  },
  {
    file: 'client/views/editor/inline-edit/selection-toolbar.js',
    rhs: 'ICONS[name]',
    reason:
      'Icon map lookup; ICONS holds static SVG constants and `name` is an internal enum.',
  },
  {
    file: 'client/views/editor/slide-type-picker/index.js',
    rhs: 'VIEW_ICON[mode]',
    reason:
      'Icon map lookup; VIEW_ICON holds static SVG constants and `mode` is a view enum.',
  },
  {
    file: 'client/views/editor/image-library/grid.js',
    rhs: 'isFavorite ? \'<svg width="16"…',
    reason:
      'Ternary picking between two static SVG literals (filled / outline star).',
  },
  {
    file: 'client/views/editor/image-library/detail.js',
    rhs: 'isFavorite ? \'<svg width="18"…',
    reason:
      'Ternary picking between two static SVG literals (filled / outline star).',
  },
];

/**
 * **Group 3 — DOM round-trips and the render contract.** Markup that is either
 * parsed into a **detached** node that never reaches the page, restored from
 * the element's own prior trusted DOM, or the sanctioned handoff of
 * `renderSlideHtml()` output (per `AGENTS.md`, escaping there is the slide
 * type's responsibility at render time).
 */
const DOM_ROUNDTRIP_SITES = [
  {
    file: 'client/lib/slide-runtime/slide-render.js',
    rhs: 'html',
    reason:
      'Slide-render contract boundary: parses renderSlideHtml() output into a ' +
      "detached wrapper. Escaping is the slide type's job at render time.",
  },
  {
    file: 'client/lib/slide-runtime/slide-render.js',
    rhs: 'html.trim()',
    reason:
      'Same contract boundary for the server-rendered variant; wrapper is detached.',
  },
  {
    file: 'client/lib/slide-runtime/slide-render.js',
    rhs: 'newContent.innerHTML',
    reason:
      'Moves the already-parsed contract output from the detached wrapper into ' +
      'the live placeholder. No new markup is introduced.',
  },
  {
    file: 'client/lib/slide-authoring/markdown-serialize.js',
    rhs: 'html',
    reason:
      'Round-trip check: parses into a detached scratch div purely to re-serialize ' +
      'and compare. Never attached to the document.',
  },
  {
    file: 'client/views/editor/inline-edit/inline-editor.js',
    rhs: 'originalHtml',
    reason:
      "Cancel-edit restore of the element's own prior DOM, captured from the " +
      'same element before editing began.',
  },
];

const ALLOWLIST = [
  ...USER_TEXT_SITES,
  ...INDIRECT_STATIC_SITES,
  ...DOM_ROUNDTRIP_SITES,
];

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Classify every character of a JS source as code, string, template, comment or
 * regex, so an `innerHTML` inside a comment or a string is never mistaken for a
 * sink — and, just as important, so a quote inside a comment cannot desync the
 * walk and hide a real one.
 *
 * Returns a same-length array of context tags. `'code'` means executable source.
 *
 * Template literals are tagged `'string'`, but the code inside their `${…}`
 * holes is tagged `'code'` again, so an interpolated `el.innerHTML = x` is still
 * seen.
 *
 * @param {string} src
 * @returns {string[]} one tag per character: 'code' | 'string' | 'comment'
 */
export function classifyChars(src) {
  const tags = new Array(src.length).fill('code');
  // Stack of template-literal states so `${ `nested` }` works.
  const templateStack = [];
  let i = 0;
  // Last significant code character, used to decide whether `/` opens a regex.
  let prevCode = '';

  const isRegexStart = () =>
    !prevCode || '(,=:[!&|?{};+-*%~^<>'.includes(prevCode);

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    const top = templateStack.length
      ? templateStack[templateStack.length - 1]
      : null;

    // Inside template *text* — everything is string until the closing backtick
    // or the start of a `${…}` hole.
    if (top && top.depth === 0) {
      if (ch === '\\') {
        tags[i++] = 'string';
        if (i < src.length) tags[i++] = 'string';
        continue;
      }
      if (ch === '`') {
        tags[i++] = 'string';
        templateStack.pop();
        prevCode = '`';
        continue;
      }
      if (ch === '$' && next === '{') {
        tags[i++] = 'string';
        tags[i++] = 'string';
        top.depth = 1;
        prevCode = '{';
        continue;
      }
      tags[i++] = 'string';
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') tags[i++] = 'comment';
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      tags[i++] = 'comment';
      tags[i++] = 'comment';
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/'))
        tags[i++] = 'comment';
      if (i < src.length) {
        tags[i++] = 'comment';
        tags[i++] = 'comment';
      }
      continue;
    }
    // Regex literal
    if (ch === '/' && isRegexStart()) {
      const start = i;
      let inClass = false;
      let j = i + 1;
      let closed = false;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '\\') {
          j++;
          continue;
        }
        if (c === '\n') break; // unterminated: not a regex after all
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          closed = true;
          break;
        }
      }
      if (closed) {
        while (j < src.length && /[a-z]/.test(src[j + 1] || '')) j++; // flags
        for (let k = start; k <= j; k++) tags[k] = 'string';
        i = j + 1;
        prevCode = '/';
        continue;
      }
      // fall through and treat as a division operator
    }
    // Quoted strings
    if (ch === "'" || ch === '"') {
      const quote = ch;
      tags[i++] = 'string';
      while (i < src.length) {
        if (src[i] === '\\') {
          tags[i++] = 'string';
          if (i < src.length) tags[i++] = 'string';
          continue;
        }
        if (src[i] === '\n') break; // unterminated: bail out rather than desync
        const done = src[i] === quote;
        tags[i++] = 'string';
        if (done) break;
      }
      prevCode = quote;
      continue;
    }
    // Template literal open (we are in code context here, so never a close)
    if (ch === '`') {
      tags[i++] = 'string';
      templateStack.push({ depth: 0 });
      continue;
    }
    // Inside a `${ … }` hole: normal code, but track braces to find its end.
    if (top) {
      if (ch === '{') top.depth++;
      else if (ch === '}') {
        top.depth--;
        if (top.depth === 0) {
          tags[i++] = 'string';
          prevCode = '}';
          continue;
        }
      }
    }
    if (!/\s/.test(ch)) prevCode = ch;
    i++;
  }
  return tags;
}

/**
 * `.innerHTML =` and the compound writes `+=`, `||=`, `&&=`, `??=` — every form
 * that stores into the sink — but not comparisons (`==`, `===`, `>=`, …).
 */
const ASSIGN_RE = /\binnerHTML\s*(?:\+|\|\||&&|\?\?)?=(?!=)/g;

/**
 * Collect the right-hand side of an assignment starting just after the `=`,
 * stopping at the statement-terminating `;` (or a `,` / `)` at depth 0, which
 * covers assignments used as expressions).
 *
 * @param {string} src
 * @param {string[]} tags
 * @param {number} from index of the first character after `=`
 * @returns {string} the raw RHS source
 */
export function readRhs(src, tags, from) {
  let depth = 0;
  let i = from;
  for (; i < src.length; i++) {
    if (tags[i] !== 'code') continue;
    const ch = src[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (ch === ';' && depth === 0) break;
  }
  return src.slice(from, i);
}

/**
 * True when the RHS is a single string or template literal with no
 * interpolation and no concatenation — the one shape allowed without a verdict.
 *
 * @param {string} rhs raw source of the right-hand side
 * @returns {boolean}
 */
export function isStaticLiteral(rhs) {
  const src = rhs.trim();
  if (!src) return false;
  const tags = classifyChars(src);
  // Everything must be part of one literal: no code characters may survive
  // outside it, which rules out concatenation, ternaries, calls and `${…}`
  // holes (whose contents are tagged 'code').
  for (let i = 0; i < src.length; i++) {
    if (tags[i] === 'code' && !/\s/.test(src[i])) return false;
    if (tags[i] === 'comment') return false;
  }
  const quote = src[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return false;
  if (src[src.length - 1] !== quote) return false;
  // A template with a hole is not static even though the hole is balanced by
  // the walk above; check explicitly for robustness.
  if (quote === '`' && /\$\{/.test(src.slice(1, -1).replace(/\\\$/g, '')))
    return false;
  return true;
}

/** Recursively collect every non-vendor `.js` file under a directory. */
function collectJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectJs(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Collapse whitespace so an allowlist `expr` matches across line breaks. */
function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Every `innerHTML` assignment in a file, with its RHS and context.
 * @param {string} file absolute path
 * @returns {{ file: string, line: number, rhs: string, context: string }[]}
 */
export function findAssignments(file) {
  const src = fs.readFileSync(file, 'utf8');
  const tags = classifyChars(src);
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  const sites = [];
  for (const m of src.matchAll(ASSIGN_RE)) {
    const at = m.index;
    const end = at + m[0].length;
    sites.push({
      file: rel,
      line: src.slice(0, at).split('\n').length,
      rhs: readRhs(src, tags, end),
      context: tags[at],
    });
  }
  return sites;
}

/**
 * Match a site against the allowlist on `file` + the **whole** normalized RHS.
 * An entry ending in `…` matches by prefix, so a long template or ternary can be
 * quoted up to its first distinctive line instead of in full.
 *
 * Matching the whole expression (not a substring of it) is what makes an entry
 * expire when the code around it changes: broaden the expression and the entry
 * stops matching, so the verdict has to be re-argued rather than inherited.
 *
 * @param {{ file: string, rhs: string }} site
 * @returns {object|undefined}
 */
function matchAllowlist(site) {
  const rhs = normalize(site.rhs);
  return ALLOWLIST.find((e) => {
    if (e.file !== site.file) return false;
    if (e.rhs.endsWith('…')) return rhs.startsWith(e.rhs.slice(0, -1));
    return rhs === e.rhs;
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('every innerHTML write in client/ is a static literal or a documented exception', () => {
  const files = collectJs(CLIENT_DIR);
  assert.ok(files.length > 50, 'expected the client tree to be scanned');

  const violations = [];
  for (const file of files) {
    for (const site of findAssignments(file)) {
      if (site.context !== 'code') continue; // inside a comment or a string
      if (isStaticLiteral(site.rhs)) continue;
      if (matchAllowlist(site)) continue;
      violations.push(site);
    }
  }

  const report = violations
    .map(
      (v) =>
        `  ${v.file}:${v.line}\n    innerHTML = ${normalize(v.rhs).slice(0, 120)}`,
    )
    .join('\n');

  assert.equal(
    violations.length,
    0,
    'innerHTML assignment(s) with non-static content and no verdict. Build the ' +
      'markup with h() from client/lib/dom.js instead, or route the value ' +
      'through escapeHtml() / markdownToSafeHtml() / sanitizeHtml() and add an ' +
      'entry with a reason to the allowlist in this file. See ' +
      'docs/reference/html-escaping.md § "The gate".\n' +
      report,
  );
});

test('the allowlist has no stale entries', () => {
  // A site that moved or was converted to h() must take its entry with it,
  // otherwise the list slowly becomes a blanket exemption for whole files.
  const matched = new Set();
  for (const file of collectJs(CLIENT_DIR)) {
    for (const site of findAssignments(file)) {
      if (site.context !== 'code') continue;
      const entry = matchAllowlist(site);
      if (entry) matched.add(entry);
    }
  }
  const stale = ALLOWLIST.filter((e) => !matched.has(e)).map(
    (e) => `${e.file} — ${e.rhs}`,
  );
  assert.deepEqual(
    stale,
    [],
    'allowlist entries that no longer match any innerHTML site',
  );
});

test('exactly six innerHTML sites carry user-authored text', () => {
  // A tripwire, not a tautology: the number is the finding of the B8 sweep
  // (docs/reference/html-escaping.md). Growing it means someone decided a
  // seventh place may render user text as markup — that should be an explicit,
  // reviewable edit here, not a quiet allowlist append.
  assert.equal(USER_TEXT_SITES.length, 6);
});

test('the scanner classifies contexts, literals and interpolation correctly', () => {
  // Guards the guard: if these flip, the scan above is lying.

  // Static shapes — allowed without a verdict.
  assert.equal(isStaticLiteral("''"), true, 'empty clear');
  assert.equal(isStaticLiteral('""'), true, 'empty clear, double quotes');
  assert.equal(isStaticLiteral("'&larr;'"), true, 'entity literal');
  assert.equal(
    isStaticLiteral('`<svg viewBox="0 0 24 24"><path d="M8 5v14z"/></svg>`'),
    true,
  );
  assert.equal(
    isStaticLiteral("'<svg>\\n  <path/>\\n</svg>'"),
    true,
    'escapes are fine',
  );

  // Non-static shapes — must be allowlisted.
  assert.equal(isStaticLiteral('`<p>${name}</p>`'), false, 'interpolation');
  assert.equal(
    isStaticLiteral("'<b>' + name + '</b>'"),
    false,
    'concatenation',
  );
  assert.equal(isStaticLiteral('ICONS[name]'), false, 'identifier lookup');
  assert.equal(isStaticLiteral('render(doc)'), false, 'call');
  assert.equal(
    isStaticLiteral("on ? '<a/>' : '<b/>'"),
    false,
    'ternary of literals',
  );
  assert.equal(
    isStaticLiteral("'<a/>' /* sneaky */"),
    false,
    'trailing comment',
  );
  assert.equal(isStaticLiteral('`a` + `b`'), false, 'template concatenation');

  // Context classification: a sink hidden in a comment or a string is not a sink,
  // and neither may hide the real one that follows.
  const src = [
    '// el.innerHTML = evil;',
    "const s = 'x.innerHTML = alsoNotCode';",
    'const re = /[\'"]/g;', // a quote inside a regex must not desync the walk
    'el.innerHTML = danger;',
  ].join('\n');
  const tags = classifyChars(src);
  const hits = [...src.matchAll(ASSIGN_RE)].map((m) => tags[m.index]);
  assert.deepEqual(
    hits,
    ['comment', 'string', 'code'],
    'comment, string, then real code',
  );

  // Compound writes store into the sink just like `=` does; comparisons do not.
  const compound =
    'a.innerHTML += x; b.innerHTML ||= y; c.innerHTML &&= y; d.innerHTML ??= z;';
  assert.equal(
    [...compound.matchAll(ASSIGN_RE)].length,
    4,
    'compound assignments are sinks',
  );
  assert.equal(
    [...'if (a.innerHTML === b || a.innerHTML == c) {}'.matchAll(ASSIGN_RE)]
      .length,
    0,
  );

  // RHS reading stops at the statement terminator, and spans a whole template.
  const rhsSrc = 'el.innerHTML = `<p>${a}</p>`;\nnext();';
  const rhsTags = classifyChars(rhsSrc);
  const at = rhsSrc.indexOf('=') + 1;
  assert.equal(readRhs(rhsSrc, rhsTags, at).trim(), '`<p>${a}</p>`');

  // …and does not stop at a `;` that lives inside a string or an entity.
  const entitySrc = "el.innerHTML = '&#8942;'; after();";
  const entityTags = classifyChars(entitySrc);
  const entityAt = entitySrc.indexOf('=') + 1;
  assert.equal(readRhs(entitySrc, entityTags, entityAt).trim(), "'&#8942;'");
  assert.equal(isStaticLiteral(readRhs(entitySrc, entityTags, entityAt)), true);
});
