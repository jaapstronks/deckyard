/**
 * The translate modals and their chrome are n-lingual (B182 fase 3, D72 #2/#7).
 *
 * These surfaces used to answer "which language is this?" with an NL/EN
 * ternary: `sourceLang === 'nl' ? 'NL (bron)' : 'EN (source)'`, a title that
 * could only end in `→ NL` or `→ EN`, a two-entry `LANG_SHORT` map, and a
 * follow-invite label that read "(Nederlands)" for anything that was not
 * English. On a deck whose active version is French every one of those said
 * something false, and the request itself was aimed with `otherLang()`, which
 * returns null outside the pair.
 *
 * What is pinned here is the third-language case throughout: the source is the
 * deck's dominant version (`translationSourceFor`), the target is the version
 * being edited, and both are named with their own native label off the twelve
 * language axis.
 *
 * Run with: node --test tests/translate-modals-n-lang.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;

const { normalizeLang } = await import('../client/lib/format/i18n.js');
const { openTranslateFieldModal } =
  await import('../client/views/editor/modals/translate-field-modal.js');
const { openTranslateSlideModal } =
  await import('../client/views/editor/modals/translate-slide-modal.js');
const { createRenderField } =
  await import('../client/views/editor/editor-form/render-field.js');
const { renderFollowInviteForm } =
  await import('../client/views/editor/editor-form/slide-forms/follow-invite.js');
const { h } = await import('../client/lib/dom.js');

const SLIDE_TYPES = {
  'title-slide': {
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'subtitle', label: 'Subtitle', type: 'string' },
    ],
  },
};

const titleSlide = (content) => ({
  id: 's1',
  type: 'title-slide',
  content: { ...content },
  notes: '',
});

/**
 * A deck written in Dutch with a French version being edited — the shape the
 * old bilingual chrome could not name. `pres.slides` is the active version, as
 * the editor keeps it.
 */
function makeDutchSourceFrenchTargetPres({ frenchContent = {} } = {}) {
  return {
    id: 'p1',
    title: 'Deck',
    slides: [titleSlide(frenchContent)],
    i18n: {
      active: 'fr',
      dominant: 'nl',
      versions: {
        nl: {
          title: 'Deck',
          slides: [titleSlide({ title: 'Goedemorgen', subtitle: 'Welkom' })],
        },
        fr: { title: 'Deck', slides: [titleSlide(frenchContent)] },
      },
    },
  };
}

const modalTitle = () => document.querySelector('.modal h2')?.textContent ?? '';
const helpTexts = () =>
  [...document.querySelectorAll('.modal .help')].map((el) => el.textContent);
const closeModal = () => document.body.replaceChildren();

const noopToast = { info: () => {}, success: () => {}, error: () => {} };

test('the field modal translates from the dominant version into the active one', async (t) => {
  t.after(closeModal);
  const pres = makeDutchSourceFrenchTargetPres();
  let sent = null;

  await openTranslateFieldModal({
    slideId: 's1',
    key: 'title',
    id: 'p1',
    pres,
    SLIDE_TYPES,
    toast: noopToast,
    root: document.body,
    normalizeLang,
    api: async (_url, opts) => {
      sent = JSON.parse(opts.body);
      return { translations: { title: 'Bonjour' } };
    },
  });

  assert.deepEqual(
    { from: sent.from, to: sent.to, fields: sent.fields },
    { from: 'nl', to: 'fr', fields: { title: 'Goedemorgen' } },
    'the request reads from the dominant version and writes into the active one',
  );
});

test('the field modal names both versions natively, never NL/EN', async (t) => {
  t.after(closeModal);
  const pres = makeDutchSourceFrenchTargetPres();

  await openTranslateFieldModal({
    slideId: 's1',
    key: 'title',
    id: 'p1',
    pres,
    SLIDE_TYPES,
    toast: noopToast,
    root: document.body,
    normalizeLang,
    api: async () => ({ translations: { title: 'Bonjour' } }),
  });

  assert.equal(modalTitle(), 'Fill field (translation) → Français');
  const help = helpTexts();
  assert.ok(
    help.includes('Nederlands (source)'),
    `expected a "Nederlands (source)" pill, got ${JSON.stringify(help)}`,
  );
  assert.ok(
    help.includes('Français (target)'),
    `expected a "Français (target)" pill, got ${JSON.stringify(help)}`,
  );
  assert.ok(
    help.some((s) => s.includes('“Title” (Français)')),
    `expected the hint to name the target version, got ${JSON.stringify(help)}`,
  );
});

test('applying the field translation writes into the active version', async (t) => {
  t.after(closeModal);
  const pres = makeDutchSourceFrenchTargetPres();
  let saved = false;

  await openTranslateFieldModal({
    slideId: 's1',
    key: 'title',
    id: 'p1',
    pres,
    SLIDE_TYPES,
    toast: noopToast,
    root: document.body,
    normalizeLang,
    api: async () => ({ translations: { title: 'Bonjour' } }),
    requestSave: async () => {
      saved = true;
    },
  });

  document.querySelector('.modal .btn-primary').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(pres.slides[0].content.title, 'Bonjour');
  assert.equal(saved, true);
});

test('the slide modal names both versions natively too', async (t) => {
  t.after(closeModal);
  const pres = makeDutchSourceFrenchTargetPres();
  let sent = null;

  await openTranslateSlideModal({
    slideId: 's1',
    id: 'p1',
    pres,
    SLIDE_TYPES,
    toast: noopToast,
    root: document.body,
    normalizeLang,
    translatableKeysForType: () => ['title', 'subtitle'],
    api: async (_url, opts) => {
      sent = JSON.parse(opts.body);
      return { translations: { title: 'Bonjour', subtitle: 'Bienvenue' } };
    },
  });

  assert.equal(sent.from, 'nl');
  assert.equal(sent.to, 'fr');
  assert.equal(modalTitle(), 'Fill slide (translation) → Français');
  const help = helpTexts();
  assert.ok(help.includes('Nederlands (source)'));
  assert.ok(help.includes('Français (target)'));
  assert.ok(
    help.some((s) => s.includes('(Français) slide from Nederlands')),
    `expected the preview hint to name both versions, got ${JSON.stringify(help)}`,
  );
});

test('a version the deck does not have is reported by its own name', async (t) => {
  t.after(closeModal);
  const pres = makeDutchSourceFrenchTargetPres();
  // The source version exists but carries no counterpart of this slide.
  pres.i18n.versions.nl.slides = [];
  const messages = [];

  await openTranslateFieldModal({
    slideId: 's1',
    key: 'title',
    id: 'p1',
    pres,
    SLIDE_TYPES,
    toast: { ...noopToast, info: (m) => messages.push(m) },
    root: document.body,
    normalizeLang,
    api: async () => ({ translations: {} }),
  });

  assert.deepEqual(messages, [
    'The Nederlands version has no version of this slide yet. Use “Translate” to create it.',
  ]);
  assert.equal(document.querySelector('.modal'), null);
});

test('the field-level "From …" button names the source version, not NL/EN', () => {
  const pres = makeDutchSourceFrenchTargetPres();
  const captured = [];
  const renderField = createRenderField({
    pres,
    slide: pres.slides[0],
    def: SLIDE_TYPES['title-slide'],
    fieldRenderers: {
      fieldText: (_label, _value, _onChange, opts) => {
        captured.push(opts?.labelRightEl ?? null);
        return h('div');
      },
    },
    onTranslateField: async () => {},
  });

  renderField({ key: 'title', label: 'Title', type: 'string' });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.textContent, 'From Nederlands');
  assert.match(captured[0]?.getAttribute('title') ?? '', /Nederlands/);
});

test('the follow-invite fields are labelled with the version being edited', () => {
  const pres = makeDutchSourceFrenchTargetPres();
  const labels = [];
  renderFollowInviteForm({
    form: h('div'),
    pres,
    slide: { id: 's2', type: 'follow-invite-slide', content: {} },
    fieldText: (label) => {
      labels.push(label);
      return h('div');
    },
    fieldTextarea: (label) => {
      labels.push(label);
      return h('div');
    },
  });

  assert.deepEqual(labels, ['Title (Français)', 'Text (Français)']);
});
