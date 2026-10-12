/** Shared AI parameters and the declarative image import funnel (B669). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import { getAiParams } from '../server/utils/request-validators.js';
import {
  deckToPresentationParts,
  SLIDE_TYPES,
  newSlide,
} from '../shared/slide-types.js';
import { DEFAULT_IMAGE_PLACEHOLDER } from '../shared/slide-types/image-placeholder.js';
import { validateAndFixRefinedSlides } from '../server/utils/ai/validate-slides/index.js';

test('AI parameters discard non-string raw/vendor and non-object settings', () => {
  assert.deepEqual(getAiParams({ raw: 42, vendor: {}, settings: [] }), {
    raw: '',
    vendor: null,
    settings: null,
    lang: null,
    theme: undefined,
  });
  const settings = { aspectRatio: '16:9' };
  assert.deepEqual(
    getAiParams({
      raw: ' text ',
      vendor: 'openai',
      settings,
      lang: 'nl',
      theme: 'default',
    }),
    {
      raw: ' text ',
      vendor: 'openai',
      settings,
      lang: 'nl',
      theme: 'default',
    },
  );
});

for (const type of ['image-slide', 'image-text-slide']) {
  test(`${type}: deck/array import and the AI fix pass agree on missing images`, () => {
    for (const image of [undefined, null, '', '   ', 42, {}]) {
      const raw = { type, content: { image } };
      const opts = { theme: null, lang: 'en-GB', slideTypes: SLIDE_TYPES };
      const fromDeck = deckToPresentationParts({ slides: [raw] }, opts).slides;
      const fromAppend = deckToPresentationParts([raw], opts).slides;
      const fixed = validateAndFixRefinedSlides(fromAppend, opts);
      for (const slides of [fromDeck, fromAppend, fixed]) {
        assert.equal(slides[0].content.image, DEFAULT_IMAGE_PLACEHOLDER);
      }
      assert.equal(raw.content.image, image, 'import never mutates input');
    }
    const slides = deckToPresentationParts(
      [{ type, content: { image: ' https://example.com/photo.jpg ' } }],
      {
        theme: null,
        lang: 'en-GB',
        slideTypes: SLIDE_TYPES,
      },
    ).slides;
    assert.equal(slides[0].content.image, 'https://example.com/photo.jpg');
    assert.equal(
      newSlide({ type, slideTypes: SLIDE_TYPES }).content.image,
      '',
      'editor insert keeps its empty default',
    );
  });
}

test('the import placeholder follows a field declaration rather than a type name', () => {
  const def = {
    ...SLIDE_TYPES['image-slide'],
    fields: [
      {
        key: 'picture',
        type: 'image',
        importPlaceholder: '/custom/sample.jpg',
      },
    ],
    defaults: { picture: '' },
  };
  const slides = deckToPresentationParts(
    [{ type: 'custom-photo', content: {} }],
    {
      theme: null,
      lang: 'en-GB',
      slideTypes: { 'custom-photo': def },
    },
  ).slides;
  assert.equal(slides[0].content.picture, '/custom/sample.jpg');
});

test('a configured image default wins over the import placeholder', () => {
  const type = 'image-slide';
  const def = {
    ...SLIDE_TYPES[type],
    defaults: { ...SLIDE_TYPES[type].defaults, image: '/configured/photo.jpg' },
  };
  const [slide] = deckToPresentationParts([{ type, content: { image: '' } }], {
    theme: null,
    lang: null,
    slideTypes: { [type]: def },
  }).slides;
  assert.equal(slide.content.image, '/configured/photo.jpg');
});

test('route validators cannot shadow the shared parameter extractors', async () => {
  const eslint = new ESLint();
  for (const source of [
    'function getAiParams(body) { return body; }',
    'const getConvertParams = (body) => body;',
    'const getAiParams = function(body) { return body; };',
  ]) {
    const [result] = await eslint.lintText(source, {
      filePath: 'server/routes/api/example.js',
    });
    assert.ok(
      result.messages.some(
        (m) =>
          m.ruleId === 'no-restricted-syntax' &&
          m.message.includes('request parameter validators'),
      ),
    );
  }
  const [result] = await eslint.lintText(
    "import { getAiParams } from '../../utils/request-validators.js'; getAiParams({});",
    { filePath: 'server/routes/api/example.js' },
  );
  assert.ok(!result.messages.some((m) => m.ruleId === 'no-restricted-syntax'));
});

test('the sample image path has a single source in server and shared code', async () => {
  const sites = [];
  for (const root of ['server', 'shared']) {
    for (const file of await fs.readdir(root, { recursive: true })) {
      if (!file.endsWith('.js')) continue;
      const filename = path.join(root, file);
      const source = await fs.readFile(filename, 'utf8');
      for (const match of source.matchAll(/demo-aurora/g))
        sites.push([filename, match.index]);
    }
  }
  assert.deepEqual(
    sites.map(([filename]) => filename),
    ['shared/slide-types/image-placeholder.js'],
  );
});
