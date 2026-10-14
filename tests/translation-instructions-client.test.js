import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

const { createTranslationInstructionsCard } =
  await import('../client/views/settings/translation-instructions/index.js');

function json(settings) {
  return new Response(JSON.stringify({ settings }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

test('instructions wait for a successful load and follow saved languages without losing draft text', async () => {
  const originalFetch = globalThis.fetch;
  const saved = [];
  let failOrg = true;
  globalThis.fetch = async (path, options) => {
    if (path === '/api/settings/app')
      return json({ supportedSlideLangs: ['nl', 'en-GB'] });
    if (path === '/api/settings/organization' && options.method === 'PATCH') {
      saved.push(JSON.parse(options.body).translationInstructions);
      return json({ translationInstructions: saved.at(-1) });
    }
    if (path === '/api/settings/organization') {
      if (failOrg) throw new Error('Temporary load failure');
      return json({
        translationInstructions: {
          terminology: 'Existing terms',
          styleByLanguage: {
            nl: 'Existing Dutch',
            'en-GB': 'Existing English',
          },
        },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    const card = createTranslationInstructionsCard();
    const save = card.el.querySelector('button');
    const terminology = card.el.querySelector('[name="terminology"]');
    assert.equal(save.disabled, true);
    save.dispatchEvent(new dom.window.Event('click'));
    assert.equal(saved.length, 0);

    await card.load();
    assert.equal(save.disabled, true);
    assert.equal(terminology.value, '');
    assert.match(card.el.textContent, /Temporary load failure/);

    failOrg = false;
    await card.load();
    assert.equal(save.disabled, false);
    assert.equal(terminology.value, 'Existing terms');
    assert.equal(
      card.el.querySelector('[name="styleByLanguage.nl"]').value,
      'Existing Dutch',
    );

    card.el.querySelector('[name="styleByLanguage.nl"]').value = 'Dutch draft';
    card.syncSupportedLanguages(['en-GB', 'fr']);
    assert.equal(card.el.querySelector('[name="styleByLanguage.nl"]'), null);
    assert.ok(card.el.querySelector('[name="styleByLanguage.fr"]'));

    save.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(saved.at(-1).styleByLanguage, {
      'en-GB': 'Existing English',
      fr: '',
    });

    card.syncSupportedLanguages(['nl', 'en-GB', 'fr']);
    assert.equal(
      card.el.querySelector('[name="styleByLanguage.nl"]').value,
      'Dutch draft',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
