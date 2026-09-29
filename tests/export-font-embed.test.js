import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inlineLocalFontUrls,
  buildEmbeddedFontCss,
} from '../server/utils/embed-fonts.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { curatedFontPath } from '../shared/theme-fonts.js';
import { buildThemeConfig } from '../server/utils/theme-builder.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * Standalone HTML export must be self-contained: a downloaded file has no
 * server to resolve `/assets/fonts/*.woff2`, so those font references must be
 * inlined as data URLs or the deck falls back to system fonts offline.
 */

/** A repo-relative woff2 that exists, or null when postinstall was skipped. */
const localFont = await (async () => {
  const rel = curatedFontPath('inter', 400, 'latin');
  try {
    await fs.access(path.join(repoRoot, rel));
    return `/${rel}`;
  } catch {
    return null; // assets/fonts/google/ is gitignored and filled by postinstall
  }
})();

const amethystSeed = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'themes', 'amethyst.json'), 'utf8'),
);
const amethystTheme = buildThemeConfig({
  id: '00000000-0000-4000-8000-0000000000aa',
  ...amethystSeed,
});

test('inlineLocalFontUrls embeds a referenced local woff2 as a data URL', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  const css = `@font-face {
    font-family: 'Custom Brand Face';
    src: url('${localFont}') format('woff2');
    font-weight: 700;
  }`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.ok(
    out.includes('data:font/woff2;base64,'),
    'referenced font should be inlined as a base64 data URL',
  );
  assert.ok(
    !out.includes('/assets/fonts/'),
    'the server-relative /assets/fonts path must be gone',
  );
  // The rest of the @font-face rule (family, format, weight) is preserved.
  assert.ok(out.includes("format('woff2')"));
  assert.ok(out.includes('font-weight: 700'));
});

// B542: a local font the export cannot read is refused in the same form as
// buildEmbeddedFontCss refuses one (B538) - a warning naming the path and the
// reason - and its face is dropped, so no `/assets/` source survives.
test('inlineLocalFontUrls drops the face of an unreadable font with the reason', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const css = `@font-face {
  font-family: 'Missing Face';
  src: url('/assets/fonts/does-not-exist-xyz.woff2') format('woff2');
}
.deck { color: red; }`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.ok(!out.includes('/assets/'), 'no /assets/ font URL survives');
  assert.ok(!out.includes('@font-face'), 'the unreadable face is dropped');
  assert.ok(out.includes('.deck { color: red; }'), 'other rules are kept');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments.join(' '),
    /Skipping font \/assets\/fonts\/does-not-exist-xyz\.woff2: local file unreadable \(ENOENT/,
  );
});

test('inlineLocalFontUrls refuses a font path outside the repo', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const css = `@font-face { font-family: 'Escape'; src: url('/../outside.woff2'); }`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.equal(out, '', 'the face is dropped');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments.join(' '),
    /Skipping font \/\.\.\/outside\.woff2: resolves outside the repo/,
  );
});

test('inlineLocalFontUrls ignores remote and data URLs', async () => {
  const css = `src: url('https://cdn.example/x.woff2'), url('data:font/woff2;base64,AAAA');`;
  const out = await inlineLocalFontUrls(repoRoot, css);
  assert.equal(out, css, 'non-local URLs must not be rewritten');
});

test('standalone HTML export embeds theme fonts and drops /assets/fonts references', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  const pres = {
    title: 'Font embed test',
    slides: [
      {
        id: 's1',
        type: 'text-slide',
        content: { title: 'Hello', body: 'World' },
      },
    ],
  };
  const html = await buildStandaloneHtml(repoRoot, pres, {
    theme: amethystTheme,
  });
  assert.ok(
    !html.includes('/assets/fonts/'),
    'downloaded standalone HTML must not reference server-hosted font files',
  );
  assert.ok(
    html.includes('data:font/woff2;base64,'),
    "the theme's fonts must be embedded as data URLs",
  );
});

test('each distinct font file is inlined exactly once', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  // The regression this guards: a curated family is pinned once per weight but
  // Google serves one *variable* file per subset, so declaring one @font-face
  // per weight base64-inlined the same blob three or four times — ~930 KB of
  // fonts in the default theme where ~250 KB is unique, in every standalone
  // HTML and every PNG/PDF render document.
  const css = await buildEmbeddedFontCss(repoRoot, amethystTheme);
  const blobs = css.match(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g) || [];
  assert.ok(blobs.length > 0, 'the default theme should embed some fonts');
  assert.equal(
    new Set(blobs).size,
    blobs.length,
    'the same font file is base64-inlined more than once',
  );
  // Two families × two Latin subsets, each family variable across its weights.
  assert.equal(
    blobs.length,
    4,
    'the default theme should embed four distinct files',
  );
  assert.match(
    css,
    /font-weight: 400 700;/,
    'weights that share a variable file collapse into one range',
  );
});

test('duplicate embedFonts entries collapse instead of inlining twice', async (t) => {
  if (!localFont) return t.skip('fonts not downloaded in this checkout');
  // A hand-written custom theme that lists the same file under several weights
  // gets the same treatment as a generated one — the merge is a property of the
  // embedder, not of how the list happened to be produced.
  const rel = curatedFontPath('inter', 400, 'latin');
  const theme = {
    embedFonts: [400, 500, 700].map((weight) => ({
      family: 'Repeated',
      path: rel,
      weight,
      style: 'normal',
    })),
  };
  const css = await buildEmbeddedFontCss(repoRoot, theme);
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.match(css, /font-weight: 400 700;/);
});

// B508, point 1 + D244: a font the export cannot read costs that font, never
// the export. A URL that is not a managed-font route is no source at all (no
// request leaves the box): the face is dropped with a warning, and the
// family's token keeps its fallback stack for the render.
test('buildEmbeddedFontCss skips a non-managed font URL with a warning', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const theme = {
    embedFonts: [
      { family: 'Forked Face', url: '/custom/assets/fonts/x.woff2' },
      { family: 'Legacy Upload', url: '/uploads/x.woff2' },
      { family: 'Remote Face', url: 'https://cdn.example.com/x.woff2' },
    ],
  };
  const css = await buildEmbeddedFontCss(repoRoot, theme);
  assert.equal(css, '', 'every non-managed face is skipped, nothing thrown');
  assert.equal(warn.mock.callCount(), 3);
  for (const call of warn.mock.calls) {
    assert.match(call.arguments.join(' '), /not a managed font URL/);
  }
});

// B538: a curated file the export cannot read is refused in the same form as
// a managed object - one warning naming the path and the reason, then `null` -
// so a skipped postinstall download leaves a trace instead of a silent fallback.
test('buildEmbeddedFontCss skips an unreadable curated path with the reason', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const rel = 'assets/fonts/google/missing/does-not-exist.woff2';
  const css = await buildEmbeddedFontCss(repoRoot, {
    embedFonts: [{ family: 'Missing Face', path: rel, weight: 400 }],
  });
  assert.equal(css, '', 'the unreadable face is skipped, nothing thrown');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments.join(' '),
    /Skipping font assets\/fonts\/google\/missing\/does-not-exist\.woff2: curated file unreadable \(ENOENT/,
  );
});

// B508, point 2: every curated family a font token names is embedded, not only
// heading and body — a mono role the app renders must not fall back in the PDF.
test('buildThemeConfig embeds a curated family named in a third font role', () => {
  const theme = buildThemeConfig({
    id: '00000000-0000-4000-8000-0000000000ab',
    ...amethystSeed,
    config: {
      ...(amethystSeed.config || {}),
      typography: { mono: "'JetBrains Mono', monospace" },
      cssVarOverrides: { '--t-font-caption': "'Lora', serif" },
    },
  });
  const families = new Set(theme.embedFonts.map((f) => f.family));
  assert.ok(families.has('JetBrains Mono'), 'mono role is embedded');
  assert.ok(families.has('Lora'), 'an overridden caption role is embedded');
  for (const f of theme.embedFonts) {
    assert.ok(f.path || f.url, `${f.family} has a source`);
  }
});

test('buildThemeConfig embeds each curated family once across roles', () => {
  const theme = buildThemeConfig({
    id: '00000000-0000-4000-8000-0000000000ac',
    ...amethystSeed,
    config: {
      ...(amethystSeed.config || {}),
      typography: {
        mono: `'${amethystSeed.fonts?.body || 'Inter'}', monospace`,
      },
    },
  });
  const keys = theme.embedFonts.map(
    (f) => `${f.family}|${f.weight}|${f.unicodeRange}`,
  );
  assert.equal(new Set(keys).size, keys.length, 'no duplicate faces');
});
