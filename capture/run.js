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
 *   node capture/run.js --all                 # capture every recipe
 *   node capture/run.js --list                # list known recipes
 *
 * Options:
 *   --out <dir>    Output directory root. The recipe's registryPath is written
 *                  relative to this. Default: ../deckyard-website
 *                  (so PNGs land in ../deckyard-website/public/images/screenshots/).
 *   --base <url>   Dev server base URL. Default: http://localhost:4177
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
import {
  resolveNavigate,
  validateRecipe,
  hashRecipeFile,
} from './lib/recipe.js';
import { RECIPES, recipeFsPath } from './recipes/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const opts = {
    ids: [],
    all: false,
    list: false,
    base: process.env.CAPTURE_BASE_URL || 'http://localhost:4177',
    out: process.env.CAPTURE_OUT_DIR || path.resolve(REPO_ROOT, '..', 'deckyard-website'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--out') opts.out = path.resolve(argv[(i += 1)]);
    else if (a === '--base') opts.base = argv[(i += 1)];
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else opts.ids.push(a);
  }
  return opts;
}

/**
 * Capture one recipe end to end.
 * @param {import('./lib/recipe.js').Recipe} recipe
 * @param {import('./lib/api.js').ApiClient} api
 * @param {string} outRoot
 */
async function captureOne(recipe, api, outRoot) {
  const problems = validateRecipe(recipe);
  if (problems.length) {
    throw new Error(`Recipe "${recipe.id}" invalid: ${problems.join('; ')}`);
  }

  const ctx = recipe.state ? await recipe.state(api) : {};
  const page = await openPage(recipe.viewport);
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
      await page.waitForSelector(recipe.waitFor, { visible: true, timeout: 20_000 });
    }
    if (recipe.action) await recipe.action(page, ctx);
    await settle(page);

    const outPath = path.resolve(outRoot, recipe.registryPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: Boolean(recipe.fullPage) });
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
      const hash = hashRecipeFile(recipeFsPath(r.id));
      // eslint-disable-next-line no-console
      console.log(`${r.id.padEnd(24)} → ${r.registryPath}  [recipe ${hash}]`);
    }
    return;
  }

  const selected = opts.all ? RECIPES : RECIPES.filter((r) => opts.ids.includes(r.id));
  if (!selected.length) {
    const known = RECIPES.map((r) => r.id).join(', ');
    throw new Error(
      opts.ids.length
        ? `No matching recipe for: ${opts.ids.join(', ')}. Known: ${known}`
        : `Nothing to capture. Pass recipe id(s), --all, or --list. Known: ${known}`
    );
  }

  await assertServerUp(opts.base);
  const api = createApi(opts.base);

  const results = [];
  try {
    for (const recipe of selected) {
      process.stdout.write(`• ${recipe.id} … `);
      try {
        const outPath = await captureOne(recipe, api, opts.out);
        const hash = hashRecipeFile(recipeFsPath(recipe.id));
        // eslint-disable-next-line no-console
        console.log(`ok → ${path.relative(process.cwd(), outPath)}`);
        results.push({ id: recipe.id, registryPath: recipe.registryPath, recipeHash: hash });
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
    `\n${results.length - failed.length}/${results.length} captured.` +
      (failed.length ? ` ${failed.length} failed.` : '')
  );
  if (!failed.length) {
    // eslint-disable-next-line no-console
    console.log(
      '\nRegistry `recipe` references (for the deckyard-website session to fill in):'
    );
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.registryPath}\n    recipe: { "id": "${r.id}", ` +
          `"module": "../deckyard/capture/recipes/${r.id}.js", "hash": "${r.recipeHash}" }`
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
