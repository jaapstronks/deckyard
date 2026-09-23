/**
 * Whether a slide may be saved to the slide library is the type's declaration
 * (`library: false`), not a branch on a type name (B401).
 *
 * The editor's Save-to-library action used to decide on
 * `slide.type === 'follow-invite-slide'`, and the library create routes did
 * not decide at all, so the API put on a shelf what the UI withheld. Now one
 * predicate, `isLibrarySlideType()`, answers for both, and the declaration
 * travels on `/api/slide-types` so the editor — which holds that response,
 * not the registry — hears a fork type that says the same thing.
 *
 * Run with: node --test tests/slide-library-type-declaration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { isLibrarySlideType } from '../shared/slide-types/policy.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';
import { handleSlideLibrary } from '../server/routes/api/slide-library.js';
import { handleSlideTypes } from '../server/routes/api/slide-types.js';

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

test('the Follow-along invite declares itself out of the library; an ordinary type does not', () => {
  assert.equal(SLIDE_TYPES['follow-invite-slide'].library, false);
  assert.equal(isLibrarySlideType(SLIDE_TYPES['follow-invite-slide']), false);
  assert.equal(isLibrarySlideType(SLIDE_TYPES['content-slide']), true);
});

test('the predicate reads the declaration: absent or unknown means savable', () => {
  assert.equal(isLibrarySlideType({ library: false }), false);
  assert.equal(isLibrarySlideType({}), true);
  assert.equal(isLibrarySlideType(undefined), true);
});

test('a `library` value other than false is a validator warning, not a second spelling', () => {
  const def = SLIDE_TYPES['content-slide'];
  const { warnings } = validateSlideTypeDefinition(
    { ...def, library: true },
    'x-library-true',
  );
  assert.ok(
    warnings.some((w) => w.includes('`library` only takes `false`')),
    warnings.join('\n'),
  );
});

for (const shelf of ['personal', 'organization']) {
  test(`${shelf} POST: a type that declares library: false is refused before storage`, async () => {
    const req = Readable.from([
      Buffer.from(
        JSON.stringify({
          name: 'Invite',
          slideType: 'follow-invite-slide',
          content: { presentationId: '' },
        }),
      ),
    ]);
    req.method = 'POST';
    req.headers = {};
    const res = mockRes();
    const handled = await handleSlideLibrary({
      repoRoot: '/tmp',
      storageScope: {},
      authedUser: { email: 'a@b.test' },
      req,
      res,
      url: {
        pathname: `/api/slide-library/${shelf}`,
        searchParams: new URLSearchParams(),
      },
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'invalid');
    assert.deepEqual(res.payload.details, { field: 'slideType' });
  });
}

test('/api/slide-types carries the declaration to the editor', async () => {
  const res = mockRes();
  await handleSlideTypes({
    repoRoot: '/tmp',
    storageScope: {},
    authedUser: null,
    req: { method: 'GET', headers: {} },
    res,
    url: {
      pathname: '/api/slide-types',
      searchParams: new URLSearchParams(),
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload['follow-invite-slide'].library, false);
  assert.equal(res.payload['content-slide'].library, undefined);
});

test('the editor asks the predicate, not the type name', () => {
  const src = readFileSync(
    new URL(
      '../client/views/editor/editor-form/header-actions.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(src, /follow-invite-slide/);
  assert.match(src, /isLibrarySlideType\(SLIDE_TYPES\?\.\[slide\.type\]\)/);
});
