/**
 * Doctor check for the theme seeds and the env that names them.
 *
 * Every seed, core and fork, must validate: boot upserts them all in one
 * transaction and refuses on the first bad one. `DEFAULT_THEME` and
 * `ENABLED_THEMES` name seeds by slug (D237); a default that names none refuses
 * at the first default deck, and an unknown enabled slug is dropped without a
 * word (`getEnabledThemeIds()`), so both are findings here.
 */

import { envStr } from '../config/utils.js';
import { readThemeSeeds } from '../utils/theme-seeds.js';
import { ok, fail } from './finding.js';

/** @type {import('./finding.js').DoctorCheck} */
export const themesCheck = {
  id: 'themes',
  label: 'Theme seeds',
  async run({ repoRoot }) {
    let seeds;
    try {
      seeds = await readThemeSeeds(repoRoot);
    } catch (err) {
      return fail(
        String(err?.message || err),
        'Fix or remove that seed file; boot refuses on the same error.',
      );
    }
    const slugs = seeds.map(({ record }) => record.slug);
    const known = `Known seeds: ${slugs.join(', ')}.`;
    const enabled = envStr('ENABLED_THEMES')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);
    const unknown = enabled.filter((slug) => !slugs.includes(slug));
    if (unknown.length) {
      return fail(
        `ENABLED_THEMES names ${unknown.join(', ')}, which no seed carries; the picker drops it silently.`,
        known,
      );
    }
    const fallback = envStr('DEFAULT_THEME');
    if (fallback && !slugs.includes(fallback)) {
      return fail(
        `DEFAULT_THEME=${fallback} names no seed; every deck on the default theme would refuse to render.`,
        known,
      );
    }
    if (fallback && enabled.length && !enabled.includes(fallback)) {
      return fail(
        `DEFAULT_THEME=${fallback} is not in ENABLED_THEMES; new decks would get a theme nobody can pick.`,
        `Add ${fallback} to ENABLED_THEMES, or choose a default from it.`,
      );
    }
    return ok(
      `${slugs.length} seeds${fallback ? `, default ${fallback}` : ''}`,
    );
  },
};
