#!/usr/bin/env node

/**
 * Slide migration script
 *
 * Migrations:
 * 1. card-stack-slide → icon-card-grid-slide
 * 2. kpi-metrics-slide: merge delta into note
 * 3. icon-card-grid-slide: numbered fields → items[] array
 * 4. text-blocks-slide: numbered row/block fields → rows[].blocks[] array
 * 5. team-cards-slide: numbered card{N} fields → members[] array
 * 6. logo-wall-slide: numbered logo{N} fields → logos[] array
 *
 * Usage:
 *   node scripts/migrate-slides.js [--dry-run] [--dir path/to/decks]
 *
 * By default, reads from the data directory. Use --dry-run to preview changes.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const dataDir = dirIdx !== -1 ? resolve(args[dirIdx + 1]) : resolve('data/decks');

let totalDecks = 0;
let modifiedDecks = 0;
let cardStackMigrated = 0;
let deltaMerged = 0;
let iconCardItemsMigrated = 0;
let textBlocksRowsMigrated = 0;
let teamCardsMembersMigrated = 0;
let logoWallLogosMigrated = 0;

/**
 * Migrate card-stack-slide → icon-card-grid-slide
 *
 * card-stack has: card{N}Title, card{N}Body, cardCount
 * icon-card-grid has: card{N}Icon, card{N}Title, card{N}Body, cardCount
 *
 * We add a default icon for each card since icon-card-grid requires icons.
 */
function migrateCardStack(slide) {
  const c = slide.content || {};
  const count = parseInt(c.cardCount || '3', 10);

  const defaultIcons = ['lightbulb', 'target', 'users', 'star', 'rocket', 'globe'];

  const newContent = {
    title: c.title || '',
    subheading: c.subheading || c.subtitle || '',
    cardCount: String(Math.min(count, 6)),
    background: c.background || 'lime',
  };

  for (let i = 1; i <= count && i <= 6; i++) {
    newContent[`card${i}Icon`] = defaultIcons[(i - 1) % defaultIcons.length];
    newContent[`card${i}Title`] = c[`card${i}Title`] || c[`card${i}Label`] || '';
    newContent[`card${i}Body`] = c[`card${i}Body`] || '';
  }

  // Preserve accessibility fields
  if (c.a11yTitle) newContent.a11yTitle = c.a11yTitle;
  if (c.a11ySummary) newContent.a11ySummary = c.a11ySummary;

  return {
    ...slide,
    type: 'icon-card-grid-slide',
    content: newContent,
  };
}

/**
 * Migrate kpi-metrics-slide: merge delta into note
 *
 * Before: { delta: '+12%', note: 'vs last year' }
 * After:  { note: '+12% vs last year' }
 */
function migrateKpiDelta(slide) {
  const c = slide.content || {};
  if (!Array.isArray(c.metrics)) return slide;

  let changed = false;
  const newMetrics = c.metrics.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const delta = String(m.delta || '').trim();
    if (!delta) return m;

    changed = true;
    const note = String(m.note || '').trim();
    const merged = note ? `${delta} ${note}` : delta;

    const { delta: _removed, ...rest } = m;
    return { ...rest, note: merged };
  });

  if (!changed) return slide;

  return {
    ...slide,
    content: { ...c, metrics: newMetrics },
  };
}

/**
 * Migrate icon-card-grid-slide: numbered fields → items[] array
 *
 * Before: { cardCount: '4', card1Icon: 'lightbulb', card1Title: 'Insight', card1Body: '...' }
 * After:  { items: [{ icon: 'lightbulb', title: 'Insight', body: '...' }, ...] }
 *
 * Skips slides that already have items[].
 */
function migrateIconCardToItems(slide) {
  const c = slide.content || {};
  // Already migrated
  if (Array.isArray(c.items) && c.items.length > 0) return slide;
  // No numbered fields present
  if (!c.card1Title && !c.card1Icon) return slide;

  const count = Math.max(1, Math.min(6, parseInt(c.cardCount || '6', 10)));
  const items = [];

  for (let i = 1; i <= count; i++) {
    items.push({
      icon: c[`card${i}Icon`] || '',
      title: c[`card${i}Title`] || '',
      body: c[`card${i}Body`] || '',
    });
  }

  // Build new content: keep non-card fields, add items[], remove numbered fields
  const newContent = {};
  for (const [key, val] of Object.entries(c)) {
    if (/^card\d+(Icon|Title|Body)$/.test(key)) continue; // skip numbered
    if (key === 'cardCount') continue; // items.length replaces this
    newContent[key] = val;
  }
  newContent.items = items;

  return { ...slide, content: newContent };
}

/**
 * Migrate text-blocks-slide: numbered row/block fields → rows[] array
 *
 * Before: { row1Count: '3', row1Color: 'yellow', row1Block1Title: 'A', ... }
 * After:  { rows: [{ color: 'yellow', arrow: 'none', blocks: [{ title: 'A', body: '...' }] }] }
 *
 * Skips slides that already have rows[].
 */
function migrateTextBlocksToRows(slide) {
  const c = slide.content || {};
  if (Array.isArray(c.rows) && c.rows.length > 0) return slide;
  // No legacy fields
  if (!c.row1Count && !c.row1Block1Title) return slide;

  const rows = [];

  // Row 1 always exists
  const row1Count = Math.max(1, Math.min(6, parseInt(c.row1Count || '3', 10)));
  const row1Blocks = [];
  for (let i = 1; i <= row1Count; i++) {
    row1Blocks.push({
      title: c[`row1Block${i}Title`] || '',
      body: c[`row1Block${i}Body`] || '',
    });
  }
  rows.push({
    title: '',
    color: c.row1Color || 'yellow',
    arrow: c.arrow1 || 'none',
    blocks: row1Blocks,
  });

  // Row 2
  if (c.row2Enabled === 'yes') {
    const row2Count = Math.max(1, Math.min(6, parseInt(c.row2Count || '3', 10)));
    const row2Blocks = [];
    for (let i = 1; i <= row2Count; i++) {
      row2Blocks.push({
        title: c[`row2Block${i}Title`] || '',
        body: c[`row2Block${i}Body`] || '',
      });
    }
    rows.push({
      title: c.row2Title || '',
      color: c.row2Color || 'black',
      arrow: c.arrow2 || 'none',
      blocks: row2Blocks,
    });
  }

  // Row 3
  if (c.row3Enabled === 'yes') {
    const row3Count = Math.max(1, Math.min(6, parseInt(c.row3Count || '3', 10)));
    const row3Blocks = [];
    for (let i = 1; i <= row3Count; i++) {
      row3Blocks.push({
        title: c[`row3Block${i}Title`] || '',
        body: c[`row3Block${i}Body`] || '',
      });
    }
    rows.push({
      title: c.row3Title || '',
      color: c.row3Color || 'yellow',
      arrow: 'none',
      blocks: row3Blocks,
    });
  }

  // Build new content: keep non-row fields, add rows[], remove numbered fields
  const newContent = {};
  for (const [key, val] of Object.entries(c)) {
    if (/^row\d/.test(key)) continue;
    if (/^arrow\d/.test(key)) continue;
    newContent[key] = val;
  }
  newContent.rows = rows;

  return { ...slide, content: newContent };
}

/**
 * Migrate team-cards-slide: numbered card{N} fields → members[] array
 *
 * Before: { cardCount: '3', card1Name: 'Alice', card1Byline: 'CEO', card1Image: '' }
 * After:  { members: [{ name: 'Alice', byline: 'CEO', image: '' }] }
 *
 * Skips slides that already have members[].
 */
function migrateTeamCardsToMembers(slide) {
  const c = slide.content || {};
  if (Array.isArray(c.members) && c.members.length > 0) return slide;
  if (!c.card1Name && !c.cardCount) return slide;

  const count = Math.max(1, Math.min(12, parseInt(c.cardCount || '1', 10)));
  // Scan beyond count for populated cards
  let maxUsed = 0;
  for (let i = 1; i <= 12; i++) {
    if (c[`card${i}Name`] || c[`card${i}Image`] || c[`card${i}Byline`]) maxUsed = i;
  }
  const scanCount = Math.max(count, maxUsed);

  const members = [];
  for (let i = 1; i <= scanCount; i++) {
    const name = c[`card${i}Name`] || '';
    const byline = c[`card${i}Byline`] || '';
    const image = c[`card${i}Image`] || '';
    if (name || byline || image) {
      members.push({
        image,
        alt: c[`card${i}Alt`] || '',
        imageFocusX: c[`card${i}ImageFocusX`] ?? 50,
        imageFocusY: c[`card${i}ImageFocusY`] ?? 50,
        name,
        byline,
      });
    }
  }

  if (members.length === 0) return slide;

  const newContent = {};
  for (const [key, val] of Object.entries(c)) {
    if (/^card\d+(Name|Byline|Image|Alt|ImageFocus[XY])$/.test(key)) continue;
    if (key === 'cardCount') continue;
    newContent[key] = val;
  }
  newContent.members = members;

  return { ...slide, content: newContent };
}

/**
 * Migrate logo-wall-slide: numbered logo{N} fields → logos[] array
 *
 * Before: { logoCount: '3', logo1Name: 'Acme', logo1Image: '/img/acme.png' }
 * After:  { logos: [{ name: 'Acme', image: '/img/acme.png' }] }
 *
 * Skips slides that already have logos[].
 */
function migrateLogoWallToLogos(slide) {
  const c = slide.content || {};
  if (Array.isArray(c.logos) && c.logos.length > 0) return slide;
  if (!c.logo1Name && !c.logoCount) return slide;

  const count = Math.max(1, Math.min(12, parseInt(c.logoCount || '1', 10)));
  let maxUsed = 0;
  for (let i = 1; i <= 12; i++) {
    if (c[`logo${i}Name`] || c[`logo${i}Image`]) maxUsed = i;
  }
  const scanCount = Math.max(count, maxUsed);

  const logos = [];
  for (let i = 1; i <= scanCount; i++) {
    const name = c[`logo${i}Name`] || '';
    const image = c[`logo${i}Image`] || '';
    if (name || image) {
      logos.push({
        image,
        name,
        alt: c[`logo${i}Alt`] || '',
      });
    }
  }

  if (logos.length === 0) return slide;

  const newContent = {};
  for (const [key, val] of Object.entries(c)) {
    if (/^logo\d+(Name|Image|Alt)$/.test(key)) continue;
    if (key === 'logoCount') continue;
    newContent[key] = val;
  }
  newContent.logos = logos;

  return { ...slide, content: newContent };
}

async function processFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let deck;
  try {
    deck = JSON.parse(raw);
  } catch {
    return; // skip non-JSON
  }

  if (!deck || !Array.isArray(deck.slides)) return;
  totalDecks++;

  let modified = false;

  deck.slides = deck.slides.map((slide) => {
    if (!slide || !slide.type) return slide;

    if (slide.type === 'card-stack-slide') {
      cardStackMigrated++;
      modified = true;
      return migrateCardStack(slide);
    }

    if (slide.type === 'kpi-metrics-slide') {
      const migrated = migrateKpiDelta(slide);
      if (migrated !== slide) {
        deltaMerged++;
        modified = true;
      }
      return migrated;
    }

    if (slide.type === 'icon-card-grid-slide') {
      const migrated = migrateIconCardToItems(slide);
      if (migrated !== slide) {
        iconCardItemsMigrated++;
        modified = true;
      }
      return migrated;
    }

    if (slide.type === 'text-blocks-slide') {
      const migrated = migrateTextBlocksToRows(slide);
      if (migrated !== slide) {
        textBlocksRowsMigrated++;
        modified = true;
      }
      return migrated;
    }

    if (slide.type === 'team-cards-slide') {
      const migrated = migrateTeamCardsToMembers(slide);
      if (migrated !== slide) {
        teamCardsMembersMigrated++;
        modified = true;
      }
      return migrated;
    }

    if (slide.type === 'logo-wall-slide') {
      const migrated = migrateLogoWallToLogos(slide);
      if (migrated !== slide) {
        logoWallLogosMigrated++;
        modified = true;
      }
      return migrated;
    }

    return slide;
  });

  if (modified) {
    modifiedDecks++;
    if (!dryRun) {
      await writeFile(filePath, JSON.stringify(deck, null, 2) + '\n', 'utf8');
    }
  }
}

async function walkDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`Cannot read directory: ${dir}`);
    process.exit(1);
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full);
    } else if (entry.name.endsWith('.json')) {
      await processFile(full);
    }
  }
}

console.log(`${dryRun ? '[DRY RUN] ' : ''}Migrating slides in: ${dataDir}`);
await walkDir(dataDir);
console.log(`\nResults:`);
console.log(`  Decks scanned:        ${totalDecks}`);
console.log(`  Decks modified:       ${modifiedDecks}`);
console.log(`  card-stack → icon-card-grid: ${cardStackMigrated}`);
console.log(`  KPI delta → note merged:     ${deltaMerged}`);
console.log(`  icon-card → items[] array:   ${iconCardItemsMigrated}`);
console.log(`  text-blocks → rows[]:        ${textBlocksRowsMigrated}`);
console.log(`  team-cards → members[]:      ${teamCardsMembersMigrated}`);
console.log(`  logo-wall → logos[]:         ${logoWallLogosMigrated}`);
if (dryRun) console.log(`\n  [DRY RUN] No files were modified.`);
