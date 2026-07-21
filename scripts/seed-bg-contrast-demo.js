#!/usr/bin/env node
/**
 * Seed demo decks that showcase background-image contrast behaviour
 * (auto text colour + auto/gradient overlays) across several themes.
 *
 * Usage:
 *   npm run start           # in one terminal (AUTH_DEV_BYPASS=true)
 *   node scripts/seed-bg-contrast-demo.js [baseUrl] [--themes=deckyard,playful,midnight]
 *
 * It is idempotent: existing decks whose title starts with the demo prefix are
 * deleted first, then recreated. Neutral test images (a dark, a light and a
 * "busy" half/half SVG) are written to custom/assets/test-bg/ (gitignored) so
 * the demo is self-contained and theme-independent.
 *
 * Because the light/dark auto-detection runs in the browser, this script
 * pre-seeds the detection result (slideBgTextAuto / slideBgNeedsScrim) that the
 * editor would compute for each image, so the decks render correctly in
 * presenter and exports without opening each slide first.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const BASE =
  args.find((a) => a.startsWith('http')) ||
  process.env.BASE_URL ||
  'http://localhost:4177';
const themesArg = args.find((a) => a.startsWith('--themes='));
const THEMES = themesArg
  ? themesArg.slice('--themes='.length).split(',').filter(Boolean)
  : ['deckyard', 'playful', 'midnight'];

const DEMO_PREFIX = 'BG contrast demo';
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

const IMG_DIR_FS = path.join(repoRoot, 'custom', 'assets', 'test-bg');
const IMG_URL = {
  dark: '/custom/assets/test-bg/demo-dark.svg',
  light: '/custom/assets/test-bg/demo-light.svg',
  busy: '/custom/assets/test-bg/demo-busy.svg',
};

const SVG = {
  dark: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><radialGradient id="g" cx="28%" cy="26%" r="95%"><stop offset="0%" stop-color="#26324a"/><stop offset="100%" stop-color="#090d13"/></radialGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>`,
  light: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><radialGradient id="g" cx="28%" cy="26%" r="95%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#d8e1ec"/></radialGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>`,
  // Left half near-black, right half near-white: no single flat text colour
  // reads across the whole title region, so auto adds a scrim.
  busy: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="800" height="900" fill="#0a0e14"/><rect x="800" width="800" height="900" fill="#f4f7fb"/></svg>`,
};

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function slide({ title, body, image, tone, text = 'auto', overlay = 'auto' }) {
  const content = {
    title,
    subheading: '',
    layout: 'one-column',
    density: 'auto',
    body,
    background: 'mist',
    actions: [],
  };
  if (image) {
    content.slideBgImage = image;
    content.slideBgFit = 'cover';
    content.slideBgText = text;
    content.slideBgOverlay = overlay;
    if (text === 'auto') {
      // Pre-seed what the browser detector would compute for this test image.
      content.slideBgTextAuto = tone === 'light' ? 'dark' : 'light';
      content.slideBgNeedsScrim = tone === 'busy';
      content.slideBgAutoFor = image;
    }
  }
  return { id: randomUUID(), type: 'content-slide', content, notes: '', visibility: {} };
}

function buildSlides(themeId, isDarkTheme) {
  const darkNote = isDarkTheme
    ? ' (dit theme is al licht-op-donker, dus geen zichtbare swap)'
    : '';
  return [
    slide({
      title: `Demo: ${themeId}`,
      body: `- Elke slide zegt zelf wat je zou moeten zien.\n- Tekstkleur = auto (kiest theme's licht/donker), tenzij anders vermeld.\n- Vergelijk dit deck met de andere themes.`,
    }),
    slide({
      title: 'Donkere foto + Auto',
      body: `→ Titel hoort WIT te worden (auto koos licht). Geen scrim nodig${darkNote}.`,
      image: IMG_URL.dark,
      tone: 'dark',
    }),
    slide({
      title: 'Lichte foto + Auto',
      body: '→ Titel hoort DONKER te worden (auto koos donker), ook op een licht-op-donker theme. Geen scrim.',
      image: IMG_URL.light,
      tone: 'light',
    }),
    slide({
      title: 'Druk beeld (half licht / half donker) + Auto',
      body: '→ Geen enkele vlakke tekstkleur past overal, dus auto legt een subtiele scrim (needsScrim=true) onder de tekst.',
      image: IMG_URL.busy,
      tone: 'busy',
    }),
    slide({
      title: 'Zelfde druk beeld + handmatige gradient (bovenaan)',
      body: '→ Gradient-overlay bovenaan i.p.v. de vlakke scrim. Handmatige keuze voor beelden met veel licht én donker.',
      image: IMG_URL.busy,
      tone: 'busy',
      overlay: 'gradient-top',
    }),
    slide({
      title: 'Donkere foto + geforceerd DONKER',
      body: '→ Expres slecht leesbaar: forceren kan altijd. Auto zou hier wit kiezen.',
      image: IMG_URL.dark,
      tone: 'dark',
      text: 'dark',
    }),
    slide({
      title: 'Geen achtergrond (theme-default)',
      body: '→ Referentie: de normale themekleuren zonder achtergrondafbeelding.',
    }),
  ];
}

async function deleteExistingDemos() {
  let list;
  try {
    list = await api('GET', '/api/presentations');
  } catch {
    return 0;
  }
  const items = Array.isArray(list) ? list : list?.items || list?.presentations || [];
  const demos = items.filter((p) =>
    String(p?.title || '').startsWith(DEMO_PREFIX)
  );
  for (const p of demos) {
    try {
      await api('DELETE', `/api/presentations/${p.id}`);
    } catch (e) {
      console.warn(`  ! could not delete ${p.id}: ${e.message}`);
    }
  }
  return demos.length;
}

async function main() {
  await mkdir(IMG_DIR_FS, { recursive: true });
  await Promise.all([
    writeFile(path.join(IMG_DIR_FS, 'demo-dark.svg'), SVG.dark),
    writeFile(path.join(IMG_DIR_FS, 'demo-light.svg'), SVG.light),
    writeFile(path.join(IMG_DIR_FS, 'demo-busy.svg'), SVG.busy),
  ]);
  console.log(`Test images written to ${IMG_DIR_FS}`);

  const removed = await deleteExistingDemos();
  if (removed) console.log(`Removed ${removed} existing demo deck(s).`);

  const darkThemes = new Set(['midnight']);
  const created = [];
  for (const themeId of THEMES) {
    const title = `${DEMO_PREFIX} — ${themeId}`;
    const deck = await api('POST', '/api/presentations', { title, theme: themeId });
    const id = deck?.id || deck?.presentation?.id;
    if (!id) throw new Error(`No id returned creating ${title}`);
    const full = await api('GET', `/api/presentations/${id}`);
    full.theme = themeId;
    full.slides = buildSlides(themeId, darkThemes.has(themeId));
    await api('PUT', `/api/presentations/${id}`, full);
    created.push({ title, url: `${BASE}/app/${id}` });
  }

  console.log('\nDemo decks:');
  for (const c of created) console.log(`  ${c.title}\n    ${c.url}`);
  console.log(
    '\nOpen each in the editor/presenter. Tip: the auto values are pre-seeded;' +
      ' re-picking an image in the editor re-runs live detection.'
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
