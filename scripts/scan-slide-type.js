#!/usr/bin/env node

/**
 * Scan the deck population for a given slide type — the safety net for
 * archiving a slide type without silently orphaning content.
 *
 * When a type is deprecated (removed from the picker + AI but kept render-only),
 * existing decks keep rendering, but nobody knows *which* decks still use it.
 * Run this first: it reports every deck + slide of the type so each hit can be
 * consciously handled — converted to another type, or exported as a PNG and
 * replaced with an image slide — instead of quietly rotting behind the
 * render-only fallback.
 *
 * Usage:
 *   node scripts/scan-slide-type.js [slide-type] [--dir <path>] [--json]
 *
 *   slide-type   defaults to `content-columns-slide`
 *   --dir        deck directory (default: server/data/presentations)
 *   --json       machine-readable output instead of the human report
 *
 * Exit code: 0 when there are no hits, 1 when the type is still in use (so a
 * maintenance/CI step can gate the deprecation on a clean scan).
 *
 * File-based (like scripts/restore-orphaned-presentations.js): it reads deck
 * JSON straight off disk. On a Postgres-backed install, point --dir at an export
 * of the decks, or scan the DB separately.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = argv.slice(2);
  let type = 'content-columns-slide';
  let dir = path.join('server', 'data', 'presentations');
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--dir') dir = args[(i += 1)];
    else if (!a.startsWith('--')) type = a;
  }
  return { type, dir: path.resolve(dir), json };
}

/**
 * Collect every slide (deduped by id) across a deck's primary slide array and
 * any per-language i18n versions, so a hit is not missed on a deck whose
 * dominant language lives under `i18n.versions`.
 */
function allSlides(pres) {
  const byId = new Map();
  const push = (slides) => {
    if (!Array.isArray(slides)) return;
    for (const s of slides) {
      if (s && typeof s === 'object') byId.set(s.id || Symbol(), s);
    }
  };
  push(pres?.slides);
  const versions = pres?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    for (const v of Object.values(versions)) push(v?.slides);
  }
  return [...byId.values()];
}

async function main() {
  const { type, dir, json } = parseArgs(process.argv);

  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch (err) {
    console.error(`Cannot read deck directory ${dir}: ${err.message}`);
    process.exit(2);
  }

  const hits = [];
  let scanned = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    let pres;
    try {
      pres = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch {
      continue; // not a deck / unreadable — skip
    }
    if (!pres || typeof pres !== 'object' || !Array.isArray(pres.slides)) continue;
    scanned += 1;
    const matches = allSlides(pres).filter((s) => s?.type === type);
    if (matches.length) {
      hits.push({
        id: pres.id || file.replace(/\.json$/i, ''),
        title: typeof pres.title === 'string' ? pres.title : '(untitled)',
        file,
        slideIds: matches.map((s) => s.id).filter(Boolean),
        count: matches.length,
      });
    }
  }

  if (json) {
    console.log(JSON.stringify({ type, dir, scanned, hits }, null, 2));
    process.exit(hits.length ? 1 : 0);
  }

  console.log(`Scanned ${scanned} deck(s) in ${dir} for "${type}".`);
  if (!hits.length) {
    console.log(`No decks use "${type}". Safe to archive without migration.`);
    process.exit(0);
  }

  const totalSlides = hits.reduce((n, h) => n + h.count, 0);
  console.log(
    `\n⚠️  ${totalSlides} "${type}" slide(s) still in use across ${hits.length} deck(s):\n`,
  );
  for (const h of hits) {
    console.log(`  • ${h.title}  [${h.id}]  — ${h.count} slide(s)  (${h.file})`);
    for (const sid of h.slideIds) console.log(`      - slide ${sid}`);
  }
  console.log(
    `\nHandle each before the deprecation lands: convert (e.g. to text-blocks /\n` +
      `icon-cards) or export the slide as a PNG and replace it with an image slide.`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
