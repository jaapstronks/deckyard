/**
 * The served surfaces carry the policy as a **response header**, not only as a
 * `<meta>` (D53(i) / B123).
 *
 * `tests/export-csp.test.js` covers the meta form on all nine render paths.
 * This file covers the two surfaces this server actually serves over HTTP —
 * `/p/…` and `/embed/…` — where a header is possible and therefore where
 * `frame-ancestors` belongs. Everything the meta can express is already in
 * force on those documents; the header's job is that one directive, plus
 * making `server/utils/document-csp.js`'s own claim true.
 *
 * The load-bearing assertion is the last one: **the header must agree with
 * `X-Frame-Options`.** Where a browser understands both, `frame-ancestors`
 * wins, so a looser CSP value would widen framing on modern browsers while the
 * old header still denied it on ancient ones — a behaviour change wearing a
 * consistency change's clothes. `security-headers.js` denies framing
 * everywhere except `/embed/`, so `/p/…` gets `'none'` and the embed gets `*`.
 *
 * Run with: node --test tests/served-surface-csp-header.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDocumentCsp,
  buildDocumentCspHeader,
} from '../server/utils/document-csp.js';
import { applySecurityHeaders } from '../server/utils/security-headers.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

test('the header is the meta policy plus frame-ancestors, and nothing else', () => {
  const meta = buildDocumentCsp();
  const header = buildDocumentCspHeader({ frameAncestors: "'none'" });

  assert.ok(
    header.startsWith(`${meta};`),
    'the header must be the same policy the document already carries — a ' +
      'second, drifting policy is worse than none',
  );
  assert.equal(
    header.slice(meta.length),
    "; frame-ancestors 'none'",
    'the only addition is frame-ancestors',
  );
  assert.ok(
    !meta.includes('frame-ancestors'),
    'the meta form must stay free of it: browsers ignore it there',
  );
});

test('frameAncestors has no default — the two surfaces disagree', () => {
  // A published deck must not be framed; an embed exists to be framed. Neither
  // is a safe fallback for the other, so a caller that forgets is an error and
  // not a quietly-wrong policy.
  assert.throws(() => buildDocumentCspHeader(), /frameAncestors/);
  assert.throws(() => buildDocumentCspHeader({}), /frameAncestors/);
  assert.throws(
    () => buildDocumentCspHeader({ frameAncestors: '  ' }),
    /frameAncestors/,
  );
});

test('both served routes set the header on every 200 they write', () => {
  for (const [rel, expected, count] of [
    ['server/routes/static/published.js', 'frameAncestors: "\'none\'"', 2],
    ['server/routes/static/embed.js', "frameAncestors: '*'", 2],
  ]) {
    const src = read(rel);
    const uses = src.split('buildDocumentCspHeader(').length - 1;
    assert.equal(
      uses,
      count,
      `${rel} should build the header ${count}× (one per 200 it writes)`,
    );
    assert.ok(src.includes(expected), `${rel} should ask for ${expected}`);
  }
});

test('the CSP and X-Frame-Options agree on who may frame each surface', () => {
  const headersFor = (pathname) => {
    const set = {};
    applySecurityHeaders(
      { headers: {}, socket: {} },
      { setHeader: (k, v) => (set[k] = v) },
      pathname,
    );
    return set;
  };

  // A published deck: XFO denies framing, so the CSP must too. `'self'` here
  // would let a same-origin frame through on every modern browser while the
  // (losing) XFO still denied it elsewhere.
  assert.equal(headersFor('/p/abc123-deck')['X-Frame-Options'], 'DENY');
  assert.match(
    buildDocumentCspHeader({ frameAncestors: "'none'" }),
    /frame-ancestors 'none'$/,
  );

  // The embed: XFO is deliberately omitted, and the CSP says the same thing
  // out loud rather than by absence.
  assert.equal(headersFor('/embed/abc123')['X-Frame-Options'], undefined);
  assert.match(
    buildDocumentCspHeader({ frameAncestors: '*' }),
    /frame-ancestors \*$/,
  );
});
