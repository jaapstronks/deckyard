import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssUrlReferences, rewriteCssUrls } from '../server/utils/css-urls.js';

const urls = (css) => cssUrlReferences(css).map((r) => r.url);

test('reads unquoted, quoted and spaced url() arguments', () => {
  assert.deepEqual(
    urls(`a{b:url(/x.png);c:url( "https://h/y" );d:URL('/z')}`),
    ['/x.png', 'https://h/y', '/z'],
  );
});

test('a url( inside a string or a comment is not a reference (DY-865)', () => {
  assert.deepEqual(urls(`a{b:url('/u/url(https://h/c?d=t)')}`), [
    '/u/url(https://h/c?d=t)',
  ]);
  assert.deepEqual(
    urls(`/* url(https://h/a) */ a{content:"url(https://h/b)"}`),
    [],
  );
});

test('escapes in the function name and the argument are decoded', () => {
  assert.deepEqual(urls(`a{b:\\75 rl(https://h/a);c:url(https\\:\\2f/h/b)}`), [
    'https://h/a',
    'https://h/b',
  ]);
});

test('names that only end in url are not url()', () => {
  assert.deepEqual(
    urls(`a{b:myurl(https://h/a);c:-url(https://h/b);d:1url(x)}`),
    [],
  );
  assert.deepEqual(urls(`#url(https://h/a) @url(https://h/b)`), []);
});

test('a bad url loads nothing and is not returned', () => {
  assert.deepEqual(urls(`a{b:url(https://h/a b);c:url("x" y);d:url(a"b)}`), []);
});

test('rewriteCssUrls replaces only what the callback maps', () => {
  const css = `a{b:url(/keep.png);c:url('https://h/x')}`;
  assert.equal(
    rewriteCssUrls(css, (u) =>
      u.startsWith('https:') ? "url('')" : undefined,
    ),
    `a{b:url(/keep.png);c:url('')}`,
  );
  assert.equal(
    rewriteCssUrls(css, () => undefined),
    css,
  );
});

test('EOF closes URL tokens and strings, while bad-url remnants stay inert', () => {
  for (const css of ['url(/x', 'url(/x ', 'url("/x"', 'url("/x']) {
    assert.deepEqual(urls(css), ['/x'], css);
  }
  assert.deepEqual(urls('url(bad(url(https://h/x))'), []);
  assert.deepEqual(urls('url(bad url(https://h/x))'), []);
});
