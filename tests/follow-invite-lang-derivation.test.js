/**
 * The follow-invite slide's language is derived, never stored.
 *
 * `follow-invite-slide` used to carry `sourceLang` / `targetLang` in its
 * content, written per language version by `normalizeFollowInviteSlides()`.
 * They were never authored: the value was always the language of the version
 * being written, which the render context already knows as `ctx.lang`. Two
 * copies of one fact meant they could disagree, and the collab codec — which
 * treats them as plain shared fields — is exactly the machinery that would let
 * a Dutch version end up claiming the English one's language.
 *
 * The fix was to remove the second copy rather than teach the codec a third
 * kind of field. These tests are what keeps that decision from eroding: they
 * assert the keys cannot survive a save, and that render output follows the
 * version rather than anything on the slide.
 *
 * Decision: docs/plans/briefs/collab-codec-per-language-fields.md
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeI18n } from '../server/storage/presentations/i18n.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import followInviteSlide from '../shared/slide-types/types/follow-invite-slide.js';

/** A deck with both versions, each holding a follow-invite slide. */
function deckWithInvites(inviteContentByLang) {
  const slideFor = (lang) => ({
    id: `invite-${lang}`,
    type: 'follow-invite-slide',
    content: { ...(inviteContentByLang[lang] || {}) },
  });
  return {
    id: 'deck-1',
    title: 'Deck',
    lang: 'nl',
    slides: [slideFor('nl')],
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: [slideFor('nl')] },
        'en-GB': { title: 'Deck', slides: [slideFor('en-GB')] },
      },
    },
  };
}

/** Every follow-invite slide in every version, flattened. */
function allInvites(pres) {
  const out = [];
  for (const version of Object.values(pres.i18n.versions)) {
    for (const s of version.slides) {
      if (s.type === 'follow-invite-slide') out.push(s);
    }
  }
  return out;
}

test('the slide type declares no language defaults', () => {
  assert.deepEqual(
    Object.keys(followInviteSlide.defaults).sort(),
    ['presentationId'],
    'a language default would reintroduce the stored copy the render derives',
  );
});

test('a save strips stored language keys from existing decks', () => {
  // The migration the brief expected to need: there isn't one. This function
  // runs on every save, so a deck written before the change sheds the keys the
  // first time it is stored.
  const pres = deckWithInvites({
    nl: { presentationId: 'deck-1', sourceLang: 'nl', targetLang: 'en-GB' },
    'en-GB': {
      presentationId: 'deck-1',
      sourceLang: 'en-GB',
      targetLang: 'nl',
    },
  });

  normalizeI18n(pres);

  for (const slide of allInvites(pres)) {
    assert.ok(
      !('sourceLang' in slide.content),
      `sourceLang survived a save on ${slide.id}`,
    );
    assert.ok(
      !('targetLang' in slide.content),
      `targetLang survived a save on ${slide.id}`,
    );
  }
});

test('divergent stored values cannot survive a save either', () => {
  // The failure mode itself: the Dutch version claiming to be English. After a
  // save there is nothing left to diverge.
  const pres = deckWithInvites({
    nl: { presentationId: 'deck-1', sourceLang: 'en-GB', targetLang: 'en-GB' },
    'en-GB': {
      presentationId: 'deck-1',
      sourceLang: 'en-GB',
      targetLang: 'nl',
    },
  });

  normalizeI18n(pres);

  const langKeys = allInvites(pres).flatMap((s) =>
    Object.keys(s.content).filter(
      (k) => k === 'sourceLang' || k === 'targetLang',
    ),
  );
  assert.deepEqual(
    langKeys,
    [],
    'no language key may remain on a stored invite',
  );
});

test('a save still sets presentationId, which is genuinely slide data', () => {
  const pres = deckWithInvites({ nl: {}, 'en-GB': {} });
  normalizeI18n(pres);
  for (const slide of allInvites(pres)) {
    assert.equal(slide.content.presentationId, 'deck-1');
    assert.equal(slide.content.enabled, true);
  }
});

test('render follows ctx.lang, not the slide', () => {
  const slide = {
    type: 'follow-invite-slide',
    content: { presentationId: 'deck-1' },
  };

  // Codes are keyed by deck language, one per version the deck has (B182/D72
  // #6) — the same spelling the render language uses, so the invite reads its
  // own version's code directly.
  const codes = { nl: '1111', 'en-GB': '2222' };
  const nl = renderSlideHtml(slide, { lang: 'nl', followCodes: codes });
  const en = renderSlideHtml(slide, { lang: 'en-GB', followCodes: codes });

  assert.match(
    nl,
    /Volg mee op je telefoon/,
    'the nl version should render Dutch copy',
  );
  assert.match(
    en,
    /Follow along on your phone/,
    'the en-GB version should render English copy',
  );
  assert.match(
    nl,
    /lang=nl/,
    'the QR target should carry the version language',
  );
  assert.match(
    en,
    /lang=en-GB/,
    'the QR target should carry the version language',
  );
  assert.match(nl, /1111/, 'the nl version should show the nl join code');
  assert.match(en, /2222/, 'the en-GB version should show the en-GB join code');
});

test('a stale stored language on an unsaved deck is ignored at render', () => {
  // Belt and braces: a deck read from disk before its first save still carries
  // the keys. The renderer must not look at them, or the divergence would keep
  // showing until something happened to save the deck.
  const stale = {
    type: 'follow-invite-slide',
    content: {
      presentationId: 'deck-1',
      sourceLang: 'en-GB',
      targetLang: 'nl',
    },
  };

  const html = renderSlideHtml(stale, {
    lang: 'nl',
    followCodes: { nl: '1111', en: '2222' },
  });

  assert.match(
    html,
    /Volg mee op je telefoon/,
    'the stored en-GB must not win over ctx.lang',
  );
  assert.doesNotMatch(html, /Follow along on your phone/);
});

test('rendering without a language falls back to nl, as before', () => {
  const html = renderSlideHtml(
    { type: 'follow-invite-slide', content: { presentationId: 'deck-1' } },
    {},
  );
  assert.match(html, /Volg mee op je telefoon/);
});
