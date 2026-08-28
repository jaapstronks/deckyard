#!/usr/bin/env node
/**
 * Deterministic screenshot capture runner for Deckyard docs.
 *
 * Reproduces documentation screenshots without hand-work: seed known state via
 * the REST API, navigate the running dev server by URL, drive any pre-shot
 * interaction with Puppeteer, then write a PNG to the exact path the
 * deckyard-website docs registry expects.
 *
 * Usage:
 *   AUTH_DEV_BYPASS=true npm run start        # terminal 1: dev server on :4177
 *   node capture/run.js <id> [<id>...]        # terminal 2: capture by recipe id
 *   node capture/run.js --all                 # capture every screenshot recipe
 *   node capture/run.js --list                # list known recipes
 *   node capture/run.js --video <id>          # record a clip instead of a shot
 *
 * Options:
 *   --out <dir>    Output directory root. Default: ../deckyard-website for
 *                  screenshots (the recipe's registryPath is written relative
 *                  to it), ../deckyard-video for takes.
 *   --base <url>   Dev server base URL. Default: http://localhost:4177
 *   --video        Record `kind: 'video'` recipes: a WebM master in
 *                  <out>/capture/takes/ and the event log the composition
 *                  derives its camera from in <out>/capture/events/.
 *
 * A deckyard session writes the PNGs but does NOT commit them into
 * deckyard-website (workspace rule). Committing + filling the registry `recipe`
 * field happens in a deckyard-website session — see the back-briefing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApi, assertServerUp } from './lib/api.js';
import { openPage, gotoStable, settle, closeBrowser } from './lib/browser.js';
import { recordTake } from './lib/record.js';
import {
  isVideoRecipe,
  resolveNavigate,
  resolveReducedMotion,
  validateRecipe,
  hashRecipeGraph,
} from './lib/recipe.js';
import { RECIPES, recipeFsPath } from './recipes/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/**
 * Where takes land. Not the website repo: a take is 4K intermediate material
 * that never ships — the composition repo turns it into the MP4 that does, and
 * keeps it gitignored. See `briefs/screencast-video-factory.md` § D4.
 */
const VIDEO_OUT_DEFAULT = path.resolve(REPO_ROOT, '..', 'deckyard-video');
const SHOT_OUT_DEFAULT = path.resolve(REPO_ROOT, '..', 'deckyard-website');

function parseArgs(argv) {
  const opts = {
    ids: [],
    all: false,
    list: false,
    video: false,
    base: process.env.CAPTURE_BASE_URL || 'http://localhost:4177',
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--video') opts.video = true;
    else if (a === '--out') opts.out = path.resolve(argv[(i += 1)]);
    else if (a === '--base') opts.base = argv[(i += 1)];
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else opts.ids.push(a);
  }
  // Resolved after the loop so `--out` and `--video` may appear in any order.
  opts.out ??=
    process.env.CAPTURE_OUT_DIR ||
    (opts.video ? VIDEO_OUT_DEFAULT : SHOT_OUT_DEFAULT);
  return opts;
}

/**
 * Seed state, open the page, navigate, and drive the recipe to the exact UI
 * state the artefact starts from.
 *
 * Shared by both kinds on purpose: a take begins where its screenshot would
 * have been shot. The one thing that differs is the motion preference, and
 * `resolveReducedMotion()` owns that difference.
 *
 * @param {import('./lib/recipe.js').Recipe | import('./lib/recipe.js').VideoRecipe} recipe
 * @param {import('./lib/api.js').ApiClient} api
 * @returns {Promise<{page: import('puppeteer-core').Page, ctx: object}>}
 */
async function stagePage(recipe, api) {
  const problems = validateRecipe(recipe);
  if (problems.length) {
    throw new Error(`Recipe "${recipe.id}" invalid: ${problems.join('; ')}`);
  }

  const ctx = recipe.state ? await recipe.state(api) : {};
  const page = await openPage(recipe.viewport, {
    reducedMotion: resolveReducedMotion(recipe),
    forRecording: isVideoRecipe(recipe),
  });
  try {
    // Seed localStorage before any app script runs — used to suppress one-time
    // hints/coach-marks so captures are clean and deterministic.
    if (recipe.localStorage) {
      await page.evaluateOnNewDocument((entries) => {
        for (const [k, v] of Object.entries(entries)) {
          try {
            window.localStorage.setItem(k, v);
          } catch {
            /* storage unavailable — ignore */
          }
        }
      }, recipe.localStorage);
    }
    const url = `${api.base}${resolveNavigate(recipe, ctx)}`;
    await gotoStable(page, url);
    if (recipe.waitFor) {
      await page.waitForSelector(recipe.waitFor, {
        visible: true,
        timeout: 20_000,
      });
    }
    if (recipe.action) await recipe.action(page, ctx);
    await settle(page);
  } catch (e) {
    await page.close();
    throw e;
  }
  return { page, ctx };
}

/**
 * Record one video recipe: a WebM master plus the event log beside it.
 *
 * The two files are written together and read together — a take without its
 * events is a video nobody can derive a camera from, so treat them as one
 * artefact in two files.
 *
 * @param {import('./lib/recipe.js').VideoRecipe} recipe
 * @param {import('./lib/api.js').ApiClient} api
 * @param {string} outRoot
 * @returns {Promise<{takePath: string, eventsPath: string, log: object}>}
 */
async function recordOne(recipe, api, outRoot) {
  const takePath = path.resolve(outRoot, 'capture/takes', `${recipe.id}.webm`);
  const eventsPath = path.resolve(
    outRoot,
    'capture/events',
    `${recipe.id}.json`,
  );
  const { page, ctx } = await stagePage(recipe, api);
  try {
    await fs.mkdir(path.dirname(takePath), { recursive: true });
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    const log = await recordTake(page, recipe, {
      takePath,
      viewport: recipe.viewport,
    });
    await fs.writeFile(eventsPath, `${JSON.stringify(log, null, 2)}\n`);
    return { takePath, eventsPath, log };
  } finally {
    await page.close();
    if (recipe.cleanup) await recipe.cleanup(api, ctx).catch(() => {});
  }
}

/**
 * Capture one screenshot recipe end to end.
 * @param {import('./lib/recipe.js').Recipe} recipe
 * @param {import('./lib/api.js').ApiClient} api
 * @param {string} outRoot
 */
async function captureOne(recipe, api, outRoot) {
  const { page, ctx } = await stagePage(recipe, api);
  try {
    const outPath = path.resolve(outRoot, recipe.registryPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    if (recipe.clip) {
      // Element shot: the surrounding app chrome is not the subject. Puppeteer
      // clips to the element's box at the page's deviceScaleFactor, so the PNG
      // stays retina without a second viewport.
      const el = await page.$(recipe.clip);
      if (!el) {
        throw new Error(
          `Recipe "${recipe.id}" clip selector matched nothing: ${recipe.clip}`,
        );
      }
      await el.screenshot({ path: outPath });
    } else {
      await page.screenshot({
        path: outPath,
        fullPage: Boolean(recipe.fullPage),
      });
    }
    return outPath;
  } finally {
    await page.close();
    if (recipe.cleanup) await recipe.cleanup(api, ctx).catch(() => {});
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    for (const r of RECIPES) {
      const hash = await hashRecipeGraph(recipeFsPath(r.id));
      const target = isVideoRecipe(r)
        ? `capture/takes/${r.id}.webm  (video)`
        : r.registryPath;
      // eslint-disable-next-line no-console
      console.log(`${r.id.padEnd(24)} → ${target}  [recipe ${hash}]`);
    }
    return;
  }

  // The two kinds do not mix in one run: they write to different repos and,
  // more to the point, want opposite motion settings. `--video` picks the pool.
  const pool = RECIPES.filter((r) => isVideoRecipe(r) === opts.video);
  const selected = opts.all
    ? pool
    : pool.filter((r) => opts.ids.includes(r.id));
  if (!selected.length) {
    const known = pool.map((r) => r.id).join(', ');
    const kind = opts.video ? 'video recipe' : 'recipe';
    throw new Error(
      opts.ids.length
        ? `No matching ${kind} for: ${opts.ids.join(', ')}. Known: ${known}`
        : `Nothing to capture. Pass ${kind} id(s), --all, or --list. Known: ${known}`,
    );
  }

  await assertServerUp(opts.base);
  const api = createApi(opts.base);

  const results = [];
  try {
    for (const recipe of selected) {
      process.stdout.write(`• ${recipe.id} … `);
      try {
        const hash = await hashRecipeGraph(recipeFsPath(recipe.id));
        if (opts.video) {
          const { takePath, eventsPath, log } = await recordOne(
            recipe,
            api,
            opts.out,
          );
          // eslint-disable-next-line no-console
          console.log(
            `ok → ${path.relative(process.cwd(), takePath)}\n` +
              `    ${log.events.length} events over ${log.durationMs}ms → ` +
              `${path.relative(process.cwd(), eventsPath)}` +
              (log.slipped
                ? '\n    WARNING: the schedule slipped — a step overran its slot, ' +
                  'so this take is not comparable frame-for-frame with another run.'
                : ''),
          );
          results.push({ id: recipe.id, recipeHash: hash });
          continue;
        }
        const outPath = await captureOne(recipe, api, opts.out);
        // eslint-disable-next-line no-console
        console.log(`ok → ${path.relative(process.cwd(), outPath)}`);
        results.push({
          id: recipe.id,
          registryPath: recipe.registryPath,
          recipeHash: hash,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`FAILED\n    ${e.message}`);
        results.push({ id: recipe.id, error: e.message });
      }
    }
  } finally {
    await closeBrowser();
  }

  const failed = results.filter((r) => r.error);
  // eslint-disable-next-line no-console
  console.log(
    `\n${results.length - failed.length}/${results.length} ` +
      `${opts.video ? 'recorded' : 'captured'}.` +
      (failed.length ? ` ${failed.length} failed.` : ''),
  );
  if (!failed.length && !opts.video) {
    // eslint-disable-next-line no-console
    console.log(
      '\nRegistry `recipe` references (for the deckyard-website session to fill in):',
    );
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.registryPath}\n    recipe: { "id": "${r.id}", ` +
          `"module": "../deckyard/capture/recipes/${r.id}.js", "hash": "${r.recipeHash}" }`,
      );
    }
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e.message || e);
  process.exit(1);
});
