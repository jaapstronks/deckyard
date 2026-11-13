import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { renderSlideHtml } from '../shared/slide-types.js';
import { staticVideoContext } from '../server/export/static-video.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { buildSlidePngHtml } from '../server/render/png.js';
import { getSlideCopy } from '../shared/slide-types/slide-copy.js';
import { seedThemeConfig } from './helpers/theme-seed.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';

/**
 * A video cannot play in a PDF or PNG, so the export hands the video slide a
 * still (`ctx.staticVideo`) and the slide draws it in its own frame: the page
 * keeps the slide's ground, title and frame instead of being a page of its own
 * on the default ground (DY-871). docs/reference/video-slide-pdf-export.md.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
// The PDF build probes gradients in Chrome; release it so the run can end.
after(closePuppeteerBrowser);
const STILL = 'data:image/png;base64,iVBORw0KGgo=';

function videoSlide(content = {}) {
  return {
    id: 'v1',
    type: 'video-slide',
    content: { title: 'Ons programma', ...content },
  };
}

const render = (slide, staticVideo, extra = {}) =>
  renderSlideHtml(slide, {
    stripEditorAttrs: true,
    lang: 'nl',
    staticVideo,
    ...extra,
  });

test('the still frame keeps the slide ground, title and frame, without a player', () => {
  const html = render(videoSlide({ background: 'calm' }), { still: STILL });
  assert.match(html, /class="slide slide-video slide-bg-calm/);
  assert.doesNotMatch(html, /slide-bg-mist/);
  assert.match(html, /<h2 class="heading"[^>]*>Ons programma<\/h2>/);
  assert.match(html, /class="video-frame video-frame--still"/);
  assert.match(html, /<img class="video-still" src="data:image\/png;base64,/);
  assert.match(html, /class="video-play"/);
  assert.doesNotMatch(html, /<iframe/);
  // The PNG asks for no caption: a picture cannot be clicked.
  assert.doesNotMatch(html, /<p class="video-caption"/);
});

test('without a poster the frame shows the neutral ground and the play badge', () => {
  const html = render(videoSlide(), { still: '' });
  assert.match(html, /class="video-still video-still--empty"/);
  assert.match(html, /class="video-play"/);
  assert.doesNotMatch(html, /<img/);
});

test('the caption links the watch URL and prints it without its scheme', () => {
  const html = render(videoSlide(), {
    still: STILL,
    caption: true,
    watchUrl: 'https://go.ciiic.nl/programma/',
  });
  assert.match(
    html,
    /<a class="video-caption-link" href="https:\/\/go\.ciiic\.nl\/programma\/" target="_blank" rel="noopener noreferrer">go\.ciiic\.nl\/programma<\/a>/,
  );
  assert.ok(html.includes(getSlideCopy('nl').videoPdfLead));
});

test('no watch URL, or one that is not a web address, prints the "not online" line', () => {
  for (const watchUrl of ['', 'javascript:alert(1)']) {
    const html = render(videoSlide(), { still: '', caption: true, watchUrl });
    assert.ok(html.includes(getSlideCopy('nl').videoPdfNoUrl), watchUrl);
    assert.doesNotMatch(html, /<a /, watchUrl);
  }
});

test('staticVideoContext: only a video slide gets one, and only the PDF a caption', async () => {
  assert.equal(
    await staticVideoContext({ type: 'content-slide', content: {} }),
    null,
  );
  // No source: nothing to fetch, so no network in this test.
  assert.deepEqual(await staticVideoContext(videoSlide()), { still: '' });

  const watch = { pres: { slides: [] }, baseUrl: '', slideIndex: 0 };
  assert.deepEqual(await staticVideoContext(videoSlide(), { watch }), {
    still: '',
    caption: true,
    watchUrl: '',
  });
  assert.deepEqual(
    await staticVideoContext(videoSlide({ watchUrl: 'go.ciiic.nl/video' }), {
      watch,
    }),
    { still: '', caption: true, watchUrl: 'https://go.ciiic.nl/video' },
  );
});

test('the PDF and PNG exports render a themed video slide on its own ground', async () => {
  const theme = await seedThemeConfig('amethyst');
  const slide = videoSlide({
    background: 'calm',
    watchUrl: 'https://go.ciiic.nl/programma',
  });
  const pdf = await buildSlidesPdfHtml(
    repoRoot,
    { id: 'p', title: 'Deck', lang: 'nl', slides: [slide] },
    { theme },
  );
  // The theme's light-text contrast class rides along, so the caption and
  // link read on the dark ground (renderSlideHtml adds it, not the type).
  assert.match(
    pdf,
    /class="slide slide-video slide-bg-calm has-slide-bg-light-text"/,
  );
  assert.doesNotMatch(pdf, /class="slide slide-video slide-bg-mist/);
  assert.match(
    pdf,
    /class="video-caption-link" href="https:\/\/go\.ciiic\.nl\/programma"/,
  );

  const png = await buildSlidePngHtml(repoRoot, slide, { theme, lang: 'nl' });
  assert.match(png, /class="slide slide-video slide-bg-calm/);
  assert.match(png, /class="video-frame video-frame--still"/);
  assert.doesNotMatch(png, /<p class="video-caption"/);
});
