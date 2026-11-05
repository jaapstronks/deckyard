/**
 * Which CSS rules can match a slide type's markup, read off the one thing a
 * type-scoped rule is declared against: the type's root class
 * (`slideRootClass()`).
 *
 * A rule whose every selector requires the root class of a type that is not
 * rendered cannot match anything, so a caller may leave it out (the MCP
 * preview, DY-842) or leave its `url()`s as written (the export seam, B557).
 * Everything else counts as able to match: a rule not scoped to a type root,
 * an at-rule other than a grouping one, and any selector the scanner cannot
 * read. Deliberately conservative where CSS is ambiguous: a class inside a
 * functional pseudo-class (`:is()`, `:not()`, `:has()`) is not a requirement.
 */

/** Group at-rules whose body is itself a list of rules. */
const GROUP_AT_RULE_RE = /^@(media|supports|container|layer|document|scope)\b/i;

/**
 * The `[start, end)` ranges of every style rule in `css` that cannot match,
 * in source order. Recurses into group at-rules.
 *
 * @param {string} css
 * @param {(cls: string) => boolean} unused - true for a root class that is
 *   not rendered.
 * @param {Object} [opts]
 * @param {'body'|'rule'} [opts.part='rule'] - `'body'` gives the range inside
 *   the braces; `'rule'` the whole rule, prelude and braces included.
 * @returns {Array<[number, number]>}
 */
export function unmatchableRuleRanges(css, unused, { part = 'rule' } = {}) {
  const text = String(css || '');
  const out = [];
  collectRanges(text, 0, text.length, unused, part === 'body', out);
  return out;
}

/**
 * `css` without the rules that cannot match, compacted (`compactCss`).
 *
 * @param {string} css
 * @param {(cls: string) => boolean} unused
 * @returns {string}
 */
export function pruneUnmatchableRules(css, unused) {
  const text = String(css || '');
  const parts = [];
  let at = 0;
  for (const [start, end] of unmatchableRuleRanges(text, unused)) {
    parts.push(text.slice(at, start));
    at = end;
  }
  parts.push(text.slice(at));
  return compactCss(parts.join(''));
}

/**
 * The type root classes that occur in rendered slide markup. Read from the
 * markup rather than from the slides' types: a type may carry another type's
 * root next to its own (a likert slider is also `.slide-likert`).
 *
 * @param {string} html
 * @param {Iterable<string>} roots - every registered type's root class.
 * @returns {Set<string>}
 */
export function rootClassesInMarkup(html, roots) {
  const known = new Set(roots);
  const found = new Set();
  for (const m of String(html || '').matchAll(
    /\bclass\s*=\s*(["'])(.*?)\1/gs,
  )) {
    for (const cls of m[2].split(/\s+/)) if (known.has(cls)) found.add(cls);
  }
  return found;
}

/**
 * `css` without comments, each whitespace run one space, and none next to
 * `{`, `}` or `;`, where it never carries meaning. String literals are copied
 * as they are, so a `/*` or a double space inside one survives.
 *
 * @param {string} css
 * @returns {string}
 */
export function compactCss(css) {
  const text = stripCssComments(css);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = skipString(text, i, text.length);
      out += text.slice(i, end);
      i = end;
    } else if (/\s/.test(c)) {
      while (i < text.length && /\s/.test(text[i])) i++;
      const prev = out[out.length - 1];
      const next = text[i];
      if (out && next && !'{};'.includes(prev) && !'{};'.includes(next)) {
        out += ' ';
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** `css` without comments; a `/*` inside a string literal is left alone. */
function stripCssComments(css) {
  const text = String(css || '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
    } else if (c === '"' || c === "'") {
      const end = skipString(text, i, text.length);
      out += text.slice(i, end);
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Walk the rules in `css[from, to)` and push the range of every style rule
 * that cannot match: its body (`bodyOnly`) or the whole rule.
 *
 * @param {string} css
 * @param {number} from
 * @param {number} to
 * @param {(cls: string) => boolean} unused
 * @param {boolean} bodyOnly
 * @param {Array<[number, number]>} out
 */
function collectRanges(css, from, to, unused, bodyOnly, out) {
  let preludeStart = from;
  let i = from;
  while (i < to) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? to : close + 2;
    } else if (c === '"' || c === "'") {
      i = skipString(css, i, to);
    } else if (c === ';' || c === '}') {
      preludeStart = i + 1;
      i++;
    } else if (c === '{') {
      const end = matchingBrace(css, i, to);
      const prelude = stripCssComments(css.slice(preludeStart, i)).trim();
      if (GROUP_AT_RULE_RE.test(prelude)) {
        collectRanges(css, i + 1, end, unused, bodyOnly, out);
      } else if (!prelude.startsWith('@') && cannotMatch(prelude, unused)) {
        out.push(bodyOnly ? [i + 1, end] : [preludeStart, end + 1]);
      }
      i = end + 1;
      preludeStart = i;
    } else {
      i++;
    }
  }
}

/**
 * True when every selector in the list requires an unused type root class.
 *
 * @param {string} selectorList
 * @param {(cls: string) => boolean} unused
 * @returns {boolean}
 */
function cannotMatch(selectorList, unused) {
  const selectors = splitTopLevelCommas(selectorList);
  return selectors.every((sel) => {
    const required = dropParenthesized(sel).match(/\.[\w-]+/g) || [];
    return required.some((cls) => unused(cls.slice(1)));
  });
}

/** Split a selector list on commas outside parentheses. */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  parts.push(buf);
  return parts;
}

/** A selector without its parenthesized arguments (`:not(.x)` → `:not`). */
function dropParenthesized(s) {
  let depth = 0;
  let out = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

/** Index just past the string literal opening at `i`. */
function skipString(css, i, to) {
  const quote = css[i];
  let j = i + 1;
  while (j < to && css[j] !== quote) j += css[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** Index of the `}` closing the `{` at `open` (or `to` when unbalanced). */
function matchingBrace(css, open, to) {
  let depth = 0;
  let i = open;
  while (i < to) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? to : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(css, i, to);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    i++;
  }
  return to;
}
