/**
 * Locale tiers — the one machine-readable reading of the tier policy.
 *
 * The policy itself (what a tier promises, why it exists) is prose in
 * docs/reference/i18n-locale-tiers.md. The machine source of truth is the
 * `tier` field on each locale in `client/i18n/manifest.json` — the same file
 * the UI language picker fetches — so the gate, the picker and the docs cannot
 * drift onto three different lists.
 *
 * Tier 1 (nl, en): blocking. Every key the code uses must exist; `npm test`
 * fails otherwise (tests/i18n-coverage.test.js reads TIER_1 from here).
 * Tier 2 (the rest): best effort. Missing keys fall back to the inline English
 * `t(key, fallback)` string, so they degrade to English instead of breaking;
 * the tooling reports the gap but does not gate on it.
 *
 * Node-only (reads the file synchronously at import). The browser reads the
 * same `tier` field straight off the fetched manifest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const MANIFEST_PATH = path.join(repoRoot, 'client', 'i18n', 'manifest.json');

/** @type {{locales: Array<{id: string, label: string, tier: number}>}} */
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

/** Every locale the app ships, in manifest order. */
export const LOCALES = manifest.locales.map((l) => ({
  id: String(l.id),
  label: String(l.label),
  tier: Number(l.tier),
}));

/** Blocking locales — complete-or-the-build-fails. */
export const TIER_1 = LOCALES.filter((l) => l.tier === 1).map((l) => l.id);

/** Best-effort locales — reported, never gated; fall back to English. */
export const TIER_2 = LOCALES.filter((l) => l.tier === 2).map((l) => l.id);

/**
 * The tier a locale sits in, or `null` when the id is not shipped.
 * @param {string} id
 * @returns {number|null}
 */
export function tierOf(id) {
  const found = LOCALES.find((l) => l.id === id);
  return found ? found.tier : null;
}
