/**
 * A slide role has one default, in the token layer (B640).
 *
 * `var(--slide-accent, #375c5d)` reads as a safety net and is nothing of the
 * kind: `--slide-accent` is declared on `.slide` by the token layer
 * (`00-tokens.css`, `00-theme.css`), which `slides.css` loads before every
 * other slide sheet, so the second value is never substituted. It is a dead
 * second form, and dead forms drift — the fourteen `#375c5d` fallbacks named a
 * colour the real accent (`#385c5c`) has not been for a while, two files asked
 * for `#7c3aed`, one for `#4c8bf5`, and `--slide-text-sm` carried both `18px`
 * and `16px`. Nobody noticed, because nobody could: the value is unreachable.
 *
 * So: **a `var()` on a role the token layer declares carries no fallback.** One
 * place knows the default of a slide role, which is the place that declares it.
 *
 * A role the token layer does *not* declare is a different thing and keeps its
 * fallback: `--slide-tone` (bound per status pattern in `00-patterns.css`) and
 * `--slide-bg` (bound per background variant) are unset on a plain slide, so
 * their fallback is the value that actually renders. The gate separates the two
 * by asking the token layer, not by file name — which is also why the token
 * files are inside the gate for the roles they *read*: `--slide-surface` fell
 * back to `var(--slide-bg-lime, #e2fe52)` while `--slide-bg-lime` is itself a
 * declared role. A `--t-*` reference is the opposite case and untouched: the
 * theme contract may genuinely be absent, so there the literal is the source.
 *
 * Run with: node --test tests/slide-role-fallbacks.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const slidesDir = path.join(repoRoot, 'client', 'styles', 'slides');

/** The two sheets `slides.css` loads before any other (D268). */
const TOKEN_LAYER = ['00-tokens.css', '00-theme.css'];

/** Every .css under `dir`, recursively, repo-relative. */
function sheets(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sheets(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** The index of the `)` matching the `(` at `openIdx`. */
function matchParen(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === '(') depth++;
    else if (css[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The index of the first top-level comma in a `var()` argument list. */
function topLevelComma(args) {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '(') depth++;
    else if (args[i] === ')') depth--;
    else if (args[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/** The `--slide-*` custom properties the token layer declares. */
function declaredRoles() {
  const roles = new Set();
  for (const file of TOKEN_LAYER) {
    const css = fs.readFileSync(path.join(slidesDir, file), 'utf8');
    for (const m of css.matchAll(/(?:^|[;{\s])(--slide-[a-z0-9-]+)\s*:/g)) {
      roles.add(m[1]);
    }
  }
  return roles;
}

/** Every `var(--slide-*, …)` with a fallback, as `{ file, line, name }`. */
function fallbacksOnSlideRoles(css, file) {
  const found = [];
  let at = css.indexOf('var(');
  while (at !== -1) {
    const close = matchParen(css, at + 3);
    if (close === -1) break;
    const args = css.slice(at + 4, close);
    const comma = topLevelComma(args);
    if (comma !== -1) {
      const name = args.slice(0, comma).trim();
      if (name.startsWith('--slide-')) {
        found.push({
          file,
          line: css.slice(0, at).split('\n').length,
          name,
          fallback: args
            .slice(comma + 1)
            .trim()
            .replace(/\s+/g, ' '),
        });
      }
    }
    at = css.indexOf('var(', at + 4);
  }
  return found;
}

test('a var() on a declared slide role carries no fallback', () => {
  const roles = declaredRoles();
  assert.ok(
    roles.has('--slide-accent') && roles.has('--slide-bg-lime'),
    'the token layer is being read (--slide-accent and --slide-bg-lime found)',
  );

  const dead = [];
  const contextual = [];
  for (const file of sheets(slidesDir)) {
    const rel = path.relative(repoRoot, file);
    for (const hit of fallbacksOnSlideRoles(
      fs.readFileSync(file, 'utf8'),
      rel,
    )) {
      (roles.has(hit.name) ? dead : contextual).push(hit);
    }
  }

  assert.deepEqual(
    dead.map((h) => `${h.file}:${h.line}  var(${h.name}, ${h.fallback})`),
    [],
    'these roles are declared by the token layer, so the fallback is never ' +
      'substituted: drop it and let the declaration in 00-tokens.css / ' +
      '00-theme.css carry the default. Is the role meant to be bound per ' +
      'context instead (like --slide-tone)? Then it does not belong in the ' +
      'token layer.',
  );

  // The other half of the split is real work, so pin that it exists: a
  // contextual role keeps its fallback, and this gate must not sweep it up.
  assert.ok(
    contextual.length > 0,
    'at least one contextually bound role still carries its fallback',
  );
});
