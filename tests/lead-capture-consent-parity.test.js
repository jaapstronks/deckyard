/**
 * One consent rule, two runtimes — and the one place they differ, on purpose.
 *
 * The lead-capture form has two handlers. The canonical one is a client module
 * (`client/lib/slide-runtime/lead-capture-runtime.js`); the standalone/published
 * export bakes a copy into the page (`LEAD_CAPTURE_RUNTIME` in
 * `server/utils/script-chain.js`), because a download has no module graph to
 * import from. B103 found that the copy had quietly lost the consent gate and
 * hard-coded its error texts in English, with nothing anywhere saying whether
 * either was intended.
 *
 * D47 settled it — **the form is the consent** — which makes this file the
 * place the settlement is written down as behaviour rather than as prose:
 *
 *   1. **The shared assertion.** Both runtimes refuse to submit while the
 *      required consent checkbox is unticked, both post `consentGiven: true`
 *      with the checkbox's own text as `consentText` once it is ticked, and
 *      both take their error strings from the slide's `data-error-*`
 *      attributes — so a Dutch deck fails in Dutch on both.
 *   2. **The one divergence, pinned as deliberate.** With no marketing-cookie
 *      consent stored, the canonical runtime refuses (a banner exists in the
 *      app and can be answered) and the baked copy proceeds (a download has no
 *      banner, so the gate would not add a consent step — it would disable the
 *      form). Asserted in both directions, so "the copy lost the gate again"
 *      and "the copy grew a gate nobody can satisfy" both fail here.
 *
 * Both handlers are driven against the **real rendered markup** of the slide
 * type, in one jsdom document, with `fetch` stubbed — the payload each one puts
 * on the wire is what is compared, not what each file appears to do.
 *
 * Run with: node --test tests/lead-capture-consent-parity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://decks.example.test/p/pres-1',
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
globalThis.FormData = dom.window.FormData;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const { renderSlideHtml } = await import('../shared/slide-types.js');
const { buildScriptChain } = await import('../server/utils/script-chain.js');
const { initLeadCaptureSlides } =
  await import('../client/lib/slide-runtime/lead-capture-runtime.js');

const PRESENTATION_ID = 'pres-1';

// A Dutch deck on purpose: a hard-coded English error message is invisible in
// an English fixture and unmissable in this one.
const SLIDE = {
  id: 'lead-1',
  type: 'lead-capture-slide',
  content: {
    title: 'Blijf op de hoogte',
    nameLabel: 'Je naam',
    emailLabel: 'E-mailadres',
    submitLabel: 'Versturen',
    thankYouTitle: 'Bedankt!',
    privacyText: 'Ik ga akkoord met het ontvangen van communicatie.',
    privacyUrl: 'https://example.test/privacy',
    errorAcceptCookies:
      'Accepteer marketingcookies om dit formulier te versturen.',
    errorEnterName: 'Vul je naam in.',
    errorValidEmail: 'Vul een geldig e-mailadres in.',
    errorAcceptTerms: 'Accepteer de privacyvoorwaarden.',
    errorGeneric: 'Er is iets misgegaan. Probeer het opnieuw.',
  },
};

const CONSENT_TEXT = SLIDE.content.privacyText;

/** The consent state the app's banner writes when marketing is accepted. */
const BANNER_ACCEPTED = JSON.stringify({
  necessary: true,
  analytics: false,
  marketing: true,
  timestamp: '2026-08-22T00:00:00.000Z',
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Mount the slide's real markup and wire up one of the two runtimes.
 *
 * @param {'canonical'|'export'} which - Which handler to attach.
 * @param {Object} [options]
 * @param {boolean} [options.marketingConsent=true] - Seed the state the app's
 *   cookie banner writes when the visitor accepts marketing cookies.
 * @returns {{form: HTMLElement, error: HTMLElement, posts: Array<Object>,
 *   fill: (o?: {consent?: boolean, name?: string, email?: string}) => void,
 *   submit: () => Promise<void>, thankYouShown: () => boolean,
 *   cleanup: () => void}}
 */
function mount(which, { marketingConsent = true } = {}) {
  localStorage.clear();
  if (marketingConsent) localStorage.setItem('cookie_consent', BANNER_ACCEPTED);
  // Each runtime learns the deck id the way its own page supplies it: the app
  // renders `data-presentation-id` onto the deck element, the standalone export
  // bakes `window.__PRESENTATION_ID__` into the page (export/html.js).
  document.body.innerHTML = `<div class="deck" data-presentation-id="${PRESENTATION_ID}">${renderSlideHtml(SLIDE)}</div>`;
  dom.window.__PRESENTATION_ID__ = PRESENTATION_ID;
  const root = document.querySelector('.deck');
  const slideEl = root.querySelector('.slide-lead-capture');
  const form = slideEl.querySelector('[data-lead-form="1"]');
  const error = slideEl.querySelector('[data-lead-error="1"]');

  const posts = [];
  const respond = { ok: true, status: 200, body: { ok: true } };
  dom.window.fetch = async (url, init = {}) => {
    posts.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    return {
      ok: respond.ok,
      status: respond.status,
      headers: {
        get: (k) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => respond.body,
      text: async () => JSON.stringify(respond.body),
    };
  };
  globalThis.fetch = dom.window.fetch;

  let cleanup = () => {};
  if (which === 'canonical') {
    cleanup = initLeadCaptureSlides(root);
  } else {
    // The export's copy, taken from the assembler that emits it rather than
    // from a second transcription of the same source.
    const script = buildScriptChain({
      leadCapture: true,
      needs: { prism: false, katex: false },
    });
    const source = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    dom.window.eval(source);
  }

  return {
    form,
    error,
    posts,
    fill({ consent = true, name = 'Jip', email = 'jip@example.test' } = {}) {
      form.querySelector('input[name="name"]').value = name;
      form.querySelector('input[name="email"]').value = email;
      form.querySelector('input[name="consent"]').checked = consent;
    },
    async submit() {
      // `requestSubmit()` would run the browser's own required-field
      // validation and never reach the handler, which is precisely the code
      // under test — so the event is dispatched directly.
      form.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
      await flush();
      await flush();
    },
    thankYouShown: () =>
      slideEl.querySelector('[data-lead-state="thankyou"]').hidden === false,
    cleanup,
  };
}

const RUNTIMES = ['canonical', 'export'];

// ===========================================================================
// What both runtimes must agree on
// ===========================================================================

for (const which of RUNTIMES) {
  test(`${which}: an unticked consent checkbox posts nothing`, async () => {
    // The assertion D47 turns on. Whatever else differs between the two, the
    // checkbox is the consent, so no tick means no submission and no lead.
    const h = mount(which);
    h.fill({ consent: false });
    await h.submit();

    assert.equal(h.posts.length, 0, 'no lead left the page');
    assert.equal(h.error.textContent, SLIDE.content.errorAcceptTerms);
    assert.equal(h.thankYouShown(), false);
    h.cleanup();
  });

  test(`${which}: a ticked checkbox posts the consent text as the record`, async () => {
    const h = mount(which);
    h.fill();
    await h.submit();

    assert.equal(h.posts.length, 1, 'exactly one submission');
    const { url, body } = h.posts[0];
    assert.match(url, /\/api\/leads$/);
    assert.equal(body.presentationId, PRESENTATION_ID);
    assert.equal(body.slideId, SLIDE.id);
    assert.equal(body.consentGiven, true);
    assert.equal(
      body.consentText,
      CONSENT_TEXT,
      'the text the visitor ticked is what is stored as the consent record',
    );
    assert.equal(body.privacyUrl, SLIDE.content.privacyUrl);
    assert.equal(h.thankYouShown(), true);
    h.cleanup();
  });

  test(`${which}: error texts come from the slide, not from the code`, async () => {
    // B103's second half: the export copy hard-coded English, so a Dutch deck
    // failed in English on the download and in Dutch in the app.
    const h = mount(which);

    h.fill({ name: '' });
    await h.submit();
    assert.equal(h.error.textContent, SLIDE.content.errorEnterName);

    h.fill({ email: 'not-an-address' });
    await h.submit();
    assert.equal(h.error.textContent, SLIDE.content.errorValidEmail);

    assert.equal(h.posts.length, 0, 'neither invalid form reached the wire');
    h.cleanup();
  });
}

// ===========================================================================
// The one thing they differ on, and it is a decision (D47)
// ===========================================================================

test('without marketing consent the canonical runtime refuses', async () => {
  // In the app a banner exists and can be answered, so marketing consent is a
  // real, revocable signal — and this runtime follows it, gate and notice.
  const h = mount('canonical', { marketingConsent: false });
  h.fill();
  await h.submit();

  assert.equal(h.posts.length, 0, 'no lead without the banner answered');
  assert.equal(h.error.textContent, SLIDE.content.errorAcceptCookies);
  h.cleanup();
});

test('without marketing consent the export copy still submits', async () => {
  // Deliberate (D47): a standalone download carries no banner, so the gate
  // would not add a consent step — it would disable the form for everyone. The
  // consent is the checkbox, and the checkbox was ticked.
  const h = mount('export', { marketingConsent: false });
  h.fill();
  await h.submit();

  assert.equal(h.posts.length, 1, 'the form works on a page with no banner');
  assert.equal(h.posts[0].body.consentGiven, true);
  assert.equal(h.posts[0].body.consentText, CONSENT_TEXT);
  h.cleanup();
});

test('the divergence is documented on both sides', async () => {
  // The finding B103 recorded was not the behaviour — it was the *silence*: a
  // reader of either file could not tell an omission from a decision. If a
  // future edit drops one of these comments the pair stops being explainable,
  // so the pointer to the record is held here too.
  const { readFile } = await import('node:fs/promises');
  const files = [
    'client/lib/slide-runtime/lead-capture-runtime.js',
    'server/utils/script-chain.js',
  ];
  for (const rel of files) {
    const src = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.match(
      src,
      /D47/,
      `${rel} must name the decision that makes the two runtimes differ`,
    );
  }
});
