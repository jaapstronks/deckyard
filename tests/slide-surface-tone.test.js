/**
 * Tests for the contrast-aware theme logo.
 *
 * A theme may ship one mark per pole (`assets.logoOnDark` /
 * `assets.logoOnLight`, plus the `titleLogoOn*` title-slide sizes). Both places
 * that draw a theme mark — the corner logo `renderSlideHtml` injects into any
 * slide type, and the title slide's own logo — have to pick the one that will
 * actually be visible on the slide's surface. The cascade cannot do it (an
 * <img> `src` is not a CSS property), so the surface is resolved from `content`
 * plus the theme and never from the DOM, because the same answer has to hold in
 * the editor preview, the export worker and the published artifact.
 *
 * The resolver is three-valued on purpose: '' means "no reliable signal" and
 * every caller keeps the neutral `assets.logo`, because guessing wrong flips
 * the mark to the invisible variant.
 *
 * Run with: node --test tests/slide-surface-tone.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSlideBgTone,
  resolveSlideSurfaceTone,
} from '../shared/slide-surface-tone.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { resolveThemeLogo } from '../shared/theme-logo.js';

const THEME = {
  id: 'test',
  assets: {
    logo: '/neutral.svg',
    logoOnDark: '/lime.svg',
    logoOnLight: '/black.svg',
    logoAlt: 'CIIIC',
  },
  slideBackgrounds: [
    {
      id: 'streaks',
      label: 'Streaks',
      value: "url('/bg.jpg'), #13393a",
      textColor: '#ffffff',
    },
    { id: 'paper', label: 'Paper', value: '#f4f2ec' },
  ],
  cssVars: {
    '--t-slide-bg-lime': '#e2fe52',
    '--t-slide-bg-mist': '#e4eae7',
    '--t-slide-bg-dark': '#13393a',
  },
};

test('background tone', async (t) => {
  await t.test('a variant that states light text is a dark surface', () => {
    assert.equal(resolveSlideBgTone({ background: 'streaks' }, THEME), 'dark');
  });

  await t.test(
    'a variant without textColor is read from its ground colour',
    () => {
      assert.equal(resolveSlideBgTone({ background: 'paper' }, THEME), 'light');
    },
  );

  await t.test('a url() in the value never supplies the ground colour', () => {
    const theme = {
      ...THEME,
      slideBackgrounds: [
        {
          id: 'x',
          label: 'X',
          value: "url('/a.jpg#ffffff') center / cover, #101010",
        },
      ],
    };
    assert.equal(resolveSlideBgTone({ background: 'x' }, theme), 'dark');
  });

  await t.test(
    'built-in slots come from the theme var, not the slot name',
    () => {
      assert.equal(resolveSlideBgTone({ background: 'lime' }, THEME), 'light');
      assert.equal(resolveSlideBgTone({ background: 'mist' }, THEME), 'light');
      assert.equal(resolveSlideBgTone({ background: 'dark' }, THEME), 'dark');
      // `midnight` paints its lime slot near-black; the tone has to follow.
      const midnight = {
        ...THEME,
        cssVars: { '--t-slide-bg-lime': '#111318' },
      };
      assert.equal(
        resolveSlideBgTone({ background: 'lime' }, midnight),
        'dark',
      );
    },
  );

  await t.test('an absent background defaults to the lime slot', () => {
    assert.equal(resolveSlideBgTone({}, THEME), 'light');
  });

  await t.test('an unknowable surface stays unknown', () => {
    assert.equal(resolveSlideBgTone({ background: 'accent' }, THEME), '');
    assert.equal(
      resolveSlideBgTone({ background: 'lime' }, { cssVars: {} }),
      '',
    );
    assert.equal(resolveSlideBgTone({ background: 'lime' }, null), '');
  });
});

test('surface tone', async (t) => {
  await t.test(
    'a settled background image outranks the colour under it',
    () => {
      const content = {
        background: 'lime',
        slideBgImage: '/photo.jpg',
        slideBgText: 'light',
      };
      // Light text over the photo means the photo is dark, even though the
      // background colour beneath it is a light lime.
      assert.equal(resolveSlideSurfaceTone(content, THEME), 'dark');
    },
  );

  await t.test('auto mode uses the recommendation stored at edit time', () => {
    const content = {
      background: 'streaks',
      slideBgImage: '/photo.jpg',
      slideBgText: 'auto',
      slideBgTextAuto: 'dark',
    };
    assert.equal(resolveSlideSurfaceTone(content, THEME), 'light');
  });

  await t.test(
    'an undecided photo falls through to the background colour',
    () => {
      const content = { background: 'streaks', slideBgImage: '/photo.jpg' };
      assert.equal(resolveSlideSurfaceTone(content, THEME), 'dark');
    },
  );
});

function renderLogo(content, theme) {
  const html = renderSlideHtml(
    { id: 's1', type: 'content-slide', content: { title: 'T', ...content } },
    { theme },
  );
  const m = html.match(/class="slide-logo-corner-img" src="([^"]*)"/);
  return m ? m[1] : null;
}

test('injected corner logo', async (t) => {
  await t.test('takes the dark-ground mark on a dark surface', () => {
    assert.equal(
      renderLogo({ background: 'streaks', slideLogo: 'top-right' }, THEME),
      '/lime.svg',
    );
  });

  await t.test('takes the light-ground mark on a light surface', () => {
    assert.equal(
      renderLogo({ background: 'paper', slideLogo: 'top-right' }, THEME),
      '/black.svg',
    );
  });

  await t.test(
    'falls back to the neutral mark when the surface is unknown',
    () => {
      assert.equal(
        renderLogo({ background: 'accent', slideLogo: 'top-right' }, THEME),
        '/neutral.svg',
      );
    },
  );

  await t.test('a one-mark theme is unaffected', () => {
    const plain = { ...THEME, assets: { logo: '/only.svg', logoAlt: 'X' } };
    assert.equal(
      renderLogo({ background: 'streaks', slideLogo: 'top-right' }, plain),
      '/only.svg',
    );
  });

  await t.test('no logo without the opt-in', () => {
    assert.equal(renderLogo({ background: 'streaks' }, THEME), null);
  });
});

function renderTitleLogo(content, theme) {
  const html = renderSlideHtml(
    { id: 's1', type: 'title-slide', content: { title: 'T', ...content } },
    { theme },
  );
  const m = html.match(/class="tsu-logo-img" src="([^"]*)"/);
  return m ? m[1] : null;
}

test('title slide logo', async (t) => {
  const TITLE_THEME = {
    ...THEME,
    assets: {
      ...THEME.assets,
      titleLogo: '/neutral-small.svg',
      titleLogoOnDark: '/lime-small.svg',
      titleLogoOnLight: '/black-small.svg',
    },
  };

  await t.test('takes the title-sized mark for its surface', () => {
    assert.equal(
      renderTitleLogo({ background: 'streaks' }, TITLE_THEME),
      '/lime-small.svg',
    );
    assert.equal(
      renderTitleLogo({ background: 'paper' }, TITLE_THEME),
      '/black-small.svg',
    );
  });

  await t.test('falls back to the neutral title mark, not the big one', () => {
    assert.equal(
      renderTitleLogo({ background: 'accent' }, TITLE_THEME),
      '/neutral-small.svg',
    );
  });

  await t.test(
    'reaches the full-size per-tone mark when no title size exists',
    () => {
      // A theme with one small mark and a pair of big ones: the visible pole
      // beats the size, because an invisible mark is worse than a large one.
      assert.equal(
        renderTitleLogo(
          { background: 'streaks' },
          { ...THEME, assets: { ...THEME.assets, titleLogo: '/small.svg' } },
        ),
        '/lime.svg',
      );
    },
  );

  await t.test('a one-mark theme is unaffected', () => {
    const plain = { ...THEME, assets: { logo: '/only.svg', logoAlt: 'X' } };
    assert.equal(
      renderTitleLogo({ background: 'streaks' }, plain),
      '/only.svg',
    );
  });
});

test('logo resolution order', async (t) => {
  await t.test('a themeless render still yields the default mark', () => {
    assert.equal(resolveThemeLogo(null, null), '/assets/images/logo.svg');
    assert.equal(
      resolveThemeLogo(null, null, { title: true }),
      '/assets/images/logo.svg',
    );
  });

  await t.test('an unresolvable surface never picks a pole', () => {
    assert.equal(
      resolveThemeLogo(THEME, { background: 'accent' }),
      '/neutral.svg',
    );
  });
});
