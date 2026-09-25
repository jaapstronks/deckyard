/**
 * The editor topbar's fold ladder is wired in two places at once, and the
 * failure it replaces was exactly that the two drifted apart (B354): the
 * stylesheet still hid a `.sb-segmented` language switch that the markup had
 * stopped building, and mirrored a theme toggle into the ⋯ menu only below
 * 1024px although the bar had no theme control at any width — so a desktop
 * had no way to change theme at all.
 *
 * `.topbar-fold-<rung>` marks both halves of one control: the element in the
 * bar and its counterpart in the ⋯ menu. This test pins the shape of that
 * pairing, not the pixel budget (a budget needs a browser; the measurements
 * live in the stylesheet's own comment):
 *
 * 1. Every rung used in the markup is one of the documented ones.
 * 2. Each used rung declares all three of its rules, in the right query.
 * 3. No element claims two rungs — a control folds at one width, or not.
 * 4. Every child of the bar is accounted for: on the ladder, or named on the
 *    never-folds list below. A rung check alone cannot see the control that
 *    was never given a rung — which is how `.topbar-analytics-btn` spent its
 *    32px outside the budget and put the floor at 379px on a shared deck
 *    (B354 round 2). This is the check that would have caught it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CSS_FILE = 'client/styles/base/01-core/10-shell-topbar-dropdown.css';
const JS_ROOTS = ['client/views/editor'];
const TOPBAR_FILE = 'client/views/editor/topbar.js';

/** The rung → `max-width` it folds at. Must stay on the documented ladder. */
const RUNGS = { xl: 1280, lg: 1024, md: 768, sm: 640 };

/**
 * The bar children that deliberately have no rung, and why. Each one is a
 * standing decision, so adding to this list is the moment to weigh the budget
 * again — the ladder's floor (294px mouse, 326px touch) is measured with
 * exactly these present at every width.
 */
const NEVER_FOLDS = {
  backBtn: 'the way out of the editor; nothing else leads back',
  topbarTitleEl: 'the flexible element — it absorbs what the row has left',
  'topbar-spacer':
    'empty flex that pushes zones 2 and 3 right; nothing mounts into it, so ' +
    'it spends no width of its own (the avatar stack used to, unbudgeted: B362)',
  'languageMode.el': 'sheds its label at xl and keeps the control',
  'moreMenu.el': 'the ⋯ menu itself — it cannot fold into itself',
  presentGroup:
    'the primary CTA; its caret folds at sm, and below 480px it sheds its ' +
    'word, not itself',
  'notificationBell.el': 'its unread badge is the signal; a closed menu is not',
};

/** @returns {string[]} every `.js` file under `dir`, recursively. */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const css = readFileSync(CSS_FILE, 'utf8');
const topbarSource = readFileSync(TOPBAR_FILE, 'utf8');
const sources = JS_ROOTS.flatMap(jsFilesUnder).map((file) => ({
  file,
  text: readFileSync(file, 'utf8'),
}));

test('every fold rung in the markup is one of the documented rungs', () => {
  for (const { file, text } of sources) {
    for (const [, rung] of text.matchAll(/topbar-fold-([a-z]+)/g)) {
      assert.ok(
        rung in RUNGS,
        `${file} folds at "${rung}", which is not on the ladder (${Object.keys(RUNGS).join(', ')})`,
      );
    }
  }
});

test('each used rung declares both halves inside its own media query', () => {
  const used = new Set(
    sources.flatMap(({ text }) =>
      [...text.matchAll(/topbar-fold-([a-z]+)/g)].map((m) => m[1]),
    ),
  );
  assert.ok(used.size > 0, 'no fold classes found — did the topbar move?');

  for (const rung of used) {
    const width = RUNGS[rung];

    // The ⋯ counterpart is hidden by default: above its rung the bar shows the
    // control, and a menu entry beside it would be the same action twice.
    assert.match(
      css,
      new RegExp(
        `\\.dropdown-menu > \\.topbar-fold-${rung},?[^{]*\\{[^}]*display:\\s*none`,
      ),
      `${rung}: the ⋯ counterpart is not hidden by default`,
    );

    // Both halves flip inside one query, so they cannot flip at different
    // widths and leave the control in the bar and the menu at once — or in
    // neither, which is how an action becomes unreachable.
    const query = mediaBlock(css, width);
    assert.ok(query, `${rung}: no "@media (max-width: ${width}px)" block`);
    assert.match(
      query,
      new RegExp(
        `\\.topbar > \\.topbar-fold-${rung}\\s*\\{[^}]*display:\\s*none`,
      ),
      `${rung}: the bar half is not hidden at ≤${width}px`,
    );
    assert.match(
      query,
      new RegExp(
        `\\.dropdown-menu > \\.topbar-fold-${rung}\\s*\\{[^}]*display:\\s*flex`,
      ),
      `${rung}: the ⋯ counterpart is not shown at ≤${width}px`,
    );
  }
});

test('no element claims two rungs', () => {
  for (const { file, text } of sources) {
    for (const [, classList] of text.matchAll(/class:\s*'([^']*)'/g)) {
      const rungs = [...classList.matchAll(/topbar-fold-([a-z]+)/g)];
      assert.ok(
        rungs.length <= 1,
        `${file}: "${classList}" folds at ${rungs.length} widths at once`,
      );
    }
  }

  // A rung can also be stamped after the fact, on an element the bar did not
  // build itself. Those calls carry no `class:` literal, so the scan above is
  // blind to them — and `topbarShareEl`'s only rung lives there.
  for (const { file, text } of sources) {
    for (const [name, rungs] of stampedRungs(text)) {
      const declared = declaredClasses(text, name.replace(/\..*$/, ''));
      const all = [
        ...rungs,
        ...[...(declared ?? '').matchAll(/topbar-fold-([a-z]+)/g)].map(
          (m) => m[1],
        ),
      ];
      assert.ok(
        all.length <= 1,
        `${file}: ${name} folds at ${all.length} widths at once (${all.join(', ')})`,
      );
    }
  }
});

test('every child of the bar is on the ladder or on the never-folds list', () => {
  const children = barChildren(topbarSource);
  assert.ok(
    children.length > 5,
    `only ${children.length} bar children found — did the topbar layout move?`,
  );

  const stamped = stampedRungs(topbarSource);
  for (const child of children) {
    // An inline `h(...)` names itself by its class list; a variable names
    // itself, and its classes live at its declaration or at a later stamp.
    const classes = child.startsWith('h(')
      ? firstClassLiteral(child)
      : (declaredClasses(topbarSource, child.replace(/\..*$/, '')) ?? '');
    const key = child.startsWith('h(')
      ? (classes ?? '').split(/\s+/).find((c) => c in NEVER_FOLDS) ||
        (classes ?? '')
      : child;

    const folds =
      /topbar-fold-[a-z]+/.test(classes ?? '') || stamped.has(child);

    assert.ok(
      folds || key in NEVER_FOLDS,
      `${TOPBAR_FILE}: the bar child "${child}" has no rung and is not on the ` +
        `never-folds list. Every control in the bar spends width at every ` +
        `width it is visible; give it a \`topbar-fold-<rung>\` plus a ⋯ ` +
        `counterpart, or add it to NEVER_FOLDS with the reason and re-measure ` +
        `the floor in ${CSS_FILE}.`,
    );
    assert.ok(
      !(folds && key in NEVER_FOLDS),
      `${TOPBAR_FILE}: "${child}" both folds and claims never to fold`,
    );
  }
});

/**
 * The slice of `text` from the bracket at `open` through its match, strings
 * and comments skipped so a `(` inside `` `… (⇧⌘Z)` `` does not shift the
 * count.
 *
 * @param {string} text
 * @param {number} open - index of the opening bracket
 * @returns {string|null} null when the bracket never closes
 */
function balanced(text, open) {
  const close = { '(': ')', '[': ']', '{': '}' }[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      if (i === 0) return null;
    } else if (c === text[open]) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * The entries of the array `h('div', { class: 'topbar' }, [ … ])` is built
 * with, as source text: either an identifier (`backBtn`, `moreMenu.el`) or a
 * whole inline `h(…)` call.
 *
 * @param {string} text
 * @returns {string[]}
 */
function barChildren(text) {
  const head = "{ class: 'topbar' }, [";
  const at = text.indexOf(head);
  if (at === -1) return [];
  const array = balanced(text, at + head.length - 1);
  if (!array) return [];
  const body = array.slice(1, -1);

  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < body.length && body[i] !== c) i += body[i] === '\\' ? 2 : 1;
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * The first `class: '…'` literal inside a source fragment — an element's own,
 * since `h()` takes its attributes before its children.
 *
 * @param {string} fragment
 * @returns {string|null}
 */
function firstClassLiteral(fragment) {
  return fragment.match(/class:\s*'([^']*)'/)?.[1] ?? null;
}

/**
 * The class list a `const <name> = h(…)` declares, or null when `name` is not
 * declared that way (a factory's `.el`, for instance).
 *
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
function declaredClasses(text, name) {
  const head = `const ${name} = h(`;
  const at = text.indexOf(head);
  if (at === -1) return null;
  const call = balanced(text, at + head.length - 1);
  return call ? firstClassLiteral(call) : null;
}

/**
 * Rungs stamped with `classList.add()` rather than declared in a `class:`
 * literal, as element name → rungs.
 *
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
function stampedRungs(text) {
  const out = new Map();
  const re =
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*?)\??\.classList\??\.add\(\s*'topbar-fold-([a-z]+)'\s*\)/g;
  for (const [, name, rung] of text.matchAll(re)) {
    out.set(name, [...(out.get(name) ?? []), rung]);
  }
  return out;
}

/**
 * Every `@media (max-width: <width>px)` block in `text`, concatenated and
 * brace-matched so nested rules come along. A regex cannot do this on its
 * own: a block contains braces of its own. All of them, not the first —
 * nothing stops a second query at the same width further down the file.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string|null} null when the file has no query at that width
 */
function mediaBlock(text, width) {
  const head = `@media (max-width: ${width}px) {`;
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(head, from);
    if (start === -1) break;
    let depth = 0;
    for (let i = start + head.length - 1; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(text.slice(start, i + 1));
          from = i + 1;
          break;
        }
      }
    }
    if (from <= start) break;
  }
  return blocks.length ? blocks.join('\n') : null;
}
