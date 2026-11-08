/**
 * The `url(...)` references in a CSS text, read the way CSS tokenizes them.
 *
 * A regex over CSS cannot tell a `url(` function from the same letters in a
 * string or a comment: `url('/u/url(https://h/x)')` loads one relative path,
 * not `https://h/x` (DY-865). This reader skips strings and comments, decodes
 * escapes in a function name (`\75 rl(` is `url(`), and reads the argument as
 * the url token or the single string CSS allows there. What it does not
 * return is not a load: a bad url (a quote or `(` inside an unquoted one, or
 * anything after the string) makes CSS load nothing either.
 */

const isWhitespace = (c) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isHex = (c) => /^[0-9a-fA-F]$/.test(c);
const isNameChar = (c) => c !== undefined && /[\w-]|[^\x00-\x7f]/.test(c);

/**
 * Read one escape at `i` (pointing at the backslash). Returns the decoded
 * character and the index after the escape.
 */
function readEscape(css, i) {
  let j = i + 1;
  if (isHex(css[j])) {
    let hex = '';
    while (hex.length < 6 && isHex(css[j])) hex += css[j++];
    if (css[j] === '\r' && css[j + 1] === '\n') j += 2;
    else if (isWhitespace(css[j])) j += 1;
    const cp = parseInt(hex, 16);
    const valid = cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
    return { ch: String.fromCodePoint(valid ? cp : 0xfffd), next: j };
  }
  if (j >= css.length) return { ch: '�', next: j };
  return { ch: css[j], next: j + 1 };
}

/** Index after a comment or string starting at `i`, or -1 if none does. */
function skipCommentOrString(css, i) {
  if (css[i] === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2);
    return end < 0 ? css.length : end + 2;
  }
  if (css[i] === '"' || css[i] === "'") {
    return readString(css, i).next;
  }
  return -1;
}

/** Read a string at `i` (its opening quote). `closed` false on a newline/EOF. */
function readString(css, i) {
  const quote = css[i];
  let value = '';
  let j = i + 1;
  while (j < css.length) {
    const c = css[j];
    if (c === quote) return { value, next: j + 1, closed: true };
    if (c === '\n' || c === '\r' || c === '\f') {
      return { value, next: j, closed: false };
    }
    if (c === '\\') {
      if (css[j + 1] === '\n') {
        j += 2;
        continue;
      }
      const esc = readEscape(css, j);
      value += esc.ch;
      j = esc.next;
      continue;
    }
    value += c;
    j += 1;
  }
  return { value, next: j, closed: false };
}

/** Read the argument after `url(` at `i`; null when CSS would load nothing. */
function readUrlArgument(css, i) {
  let j = i;
  while (isWhitespace(css[j])) j += 1;
  if (css[j] === '"' || css[j] === "'") {
    const str = readString(css, j);
    if (!str.closed && str.next < css.length) return null;
    j = str.next;
    while (isWhitespace(css[j])) j += 1;
    return css[j] === ')' || j === css.length
      ? { url: str.value, next: Math.min(j + 1, css.length) }
      : null;
  }
  let url = '';
  while (j < css.length) {
    const c = css[j];
    if (c === ')') return { url, next: j + 1 };
    if (isWhitespace(c)) {
      while (isWhitespace(css[j])) j += 1;
      return css[j] === ')' || j === css.length
        ? { url, next: Math.min(j + 1, css.length) }
        : null;
    }
    if (
      c === '"' ||
      c === "'" ||
      c === '(' ||
      /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(c)
    )
      return null;
    if (
      c === '\\' &&
      isWhitespace(css[j + 1]) &&
      css[j + 1] !== ' ' &&
      css[j + 1] !== '\t'
    )
      return null;
    if (c === '\\') {
      const esc = readEscape(css, j);
      url += esc.ch;
      j = esc.next;
      continue;
    }
    url += c;
    j += 1;
  }
  return { url, next: j };
}

/** Skip the remnants of a bad URL token, including escaped parentheses. */
function skipBadUrl(css, i) {
  while (i < css.length) {
    if (css[i] === ')') return i + 1;
    if (css[i] === '\\') i = readEscape(css, i).next;
    else i += 1;
  }
  return i;
}

/**
 * Every `url(...)` in a CSS text, with its span and its decoded target.
 *
 * @param {string} css
 * @returns {Array<{ start: number, end: number, url: string }>}
 */
export function cssUrlReferences(css) {
  const refs = [];
  let i = 0;
  while (i < css.length) {
    const skipped = skipCommentOrString(css, i);
    if (skipped >= 0) {
      i = skipped;
      continue;
    }
    const c = css[i];
    if (!isNameChar(c) && c !== '\\' && c !== '#' && c !== '@') {
      i += 1;
      continue;
    }
    // One run of name characters: an ident, a number with its unit, a hash
    // or an at-keyword. Only a plain ident in front of `(` is a function.
    const start = i;
    let name = '';
    if (c === '#' || c === '@') i += 1;
    while (i < css.length) {
      if (css[i] === '\\' && css[i + 1] !== '\n') {
        const esc = readEscape(css, i);
        name += esc.ch;
        i = esc.next;
      } else if (isNameChar(css[i])) {
        name += css[i++];
      } else break;
    }
    if (i === start) {
      i += 1;
      continue;
    }
    const plainIdent = c !== '#' && c !== '@' && !/^[0-9]/.test(css[start]);
    if (plainIdent && css[i] === '(' && name.toLowerCase() === 'url') {
      const arg = readUrlArgument(css, i + 1);
      if (arg) {
        refs.push({ start, end: arg.next, url: arg.url });
        i = arg.next;
        continue;
      }
      // Unquoted bad-url remnants are a single token, not nested functions.
      let argument = i + 1;
      while (isWhitespace(css[argument])) argument += 1;
      if (css[argument] !== '"' && css[argument] !== "'") {
        i = skipBadUrl(css, argument);
      }
    }
  }
  return refs;
}

/**
 * Replace each `url(...)` whose target `replace` maps to a string; a target it
 * maps to `undefined` stays as written.
 *
 * @param {string} css
 * @param {(url: string) => string|undefined} replace
 * @returns {string}
 */
export function rewriteCssUrls(css, replace) {
  let out = '';
  let at = 0;
  for (const ref of cssUrlReferences(css)) {
    const written = replace(ref.url);
    if (written === undefined) continue;
    out += css.slice(at, ref.start) + written;
    at = ref.end;
  }
  return at === 0 ? css : out + css.slice(at);
}
