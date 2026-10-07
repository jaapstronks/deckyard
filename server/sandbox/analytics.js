/**
 * Sandbox insights seed (B353).
 *
 * A sandbox guest only ever has fresh copies, so `/insights` showed zeros and
 * "No view data": nothing the guest could see told them what the dashboard is
 * for. An example deck may therefore declare a viewing profile, and opening
 * that example writes a plausible history of views for the guest's copy.
 *
 * The profile is declared in the example file itself, beside the deck, under
 * `sandbox.analytics` (the key never reaches the browser or the stored deck;
 * `listSandboxExamples` splits it off):
 *
 * ```json
 * "sandbox": {
 *   "analytics": {
 *     "sessions": 140,
 *     "days": 60,
 *     "returningShare": 0.3,
 *     "completion": 0.55,
 *     "secondsPerSlide": 24,
 *     "sources": { "share_link": 5, "published": 3, "embed": 2, "follow": 1 }
 *   }
 * }
 * ```
 *
 * `sessions` visits spread over the last `days` days (weighted towards the
 * recent end, so the 7- and 30-day views both fill); `returningShare` of them
 * come back on an earlier device; `completion` of them reach the last slide,
 * the rest drop off along the way; `sources` weighs where each visit came from.
 * The history is a pure function of the profile, the slides and a seed string
 * (the copy's id), so it is reproducible and testable without a database.
 *
 * Written only with `SANDBOX_MODE` on (and the analytics cluster on); the
 * storage writer refuses on its own as well, so no other route can reach it.
 */

import { createHash } from 'node:crypto';
import { sandboxEnabled } from '../config/sandbox.js';
import { isAnalyticsEnabled } from '../config/features.js';
import { insertSeededViewSessions } from '../storage/analytics/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sandbox-analytics');

/** The source types a view session can carry (docs/reference/analytics.md). */
const SOURCE_TYPES = ['share_link', 'follow', 'embed', 'published'];

/** Upper bound on one profile, so a typo cannot write a million rows. */
const MAX_SESSIONS = 500;
const MAX_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Read a declared profile into its settled form, or `null` when the example
 * declares none (or declares something that is not an object).
 * @param {unknown} raw - The `sandbox.analytics` value of an example file.
 * @returns {{sessions:number,days:number,returningShare:number,completion:number,secondsPerSlide:number,sources:Array<[string,number]>}|null}
 */
export function normalizeAnalyticsProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const sources = Object.entries(raw.sources || {})
    .filter(([type]) => SOURCE_TYPES.includes(type))
    .map(([type, weight]) => [type, clampNumber(weight, 0, 1000, 0)])
    .filter(([, weight]) => weight > 0);
  return {
    sessions: Math.round(clampNumber(raw.sessions, 1, MAX_SESSIONS, 100)),
    days: Math.round(clampNumber(raw.days, 1, MAX_DAYS, 30)),
    returningShare: clampNumber(raw.returningShare, 0, 0.9, 0.25),
    completion: clampNumber(raw.completion, 0, 1, 0.5),
    secondsPerSlide: clampNumber(raw.secondsPerSlide, 3, 600, 20),
    sources: sources.length ? sources : [['share_link', 1]],
  };
}

/** A small seeded PRNG (mulberry32), so the history is reproducible. */
function createRandom(seed) {
  let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(entries, r) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let x = r * total;
  for (const [value, w] of entries) {
    x -= w;
    if (x < 0) return value;
  }
  return entries[entries.length - 1][0];
}

/**
 * Build the view history a profile describes for a deck's slides.
 *
 * @param {ReturnType<typeof normalizeAnalyticsProfile>} profile
 * @param {Array<{id:string}>} slides - The stored deck's slides, in order.
 * @param {{now?: number, seed?: string}} [opts]
 * @returns {Array<{startedAt:string,endedAt:string,durationSeconds:number,sourceType:string,deviceId:string,exitSlideId:string,exitSlideIndex:number,slideViews:Array<{slideId:string,slideIndex:number,enteredAt:string,exitedAt:string,durationSeconds:number,visitNumber:number}>}>}
 */
export function buildSeedSessions(profile, slides, opts = {}) {
  const ids = (Array.isArray(slides) ? slides : [])
    .map((s) => s?.id)
    .filter((id) => typeof id === 'string' && id);
  if (!profile || !ids.length) return [];

  const random = createRandom(opts.seed ?? 'sandbox');
  const now = opts.now ?? Date.now();
  const devices = Math.max(
    1,
    Math.round(profile.sessions * (1 - profile.returningShare)),
  );

  const sessions = [];
  for (let i = 0; i < profile.sessions; i++) {
    // sqrt skews the offset towards today: more recent visits than old ones.
    const daysAgo = profile.days * (1 - Math.sqrt(random()));
    // Stay at least an hour in the past, so no visit looks like it is live.
    const start = now - Math.max(daysAgo * DAY_MS, 60 * 60 * 1000);
    const device = i < devices ? i : Math.floor(random() * devices);

    const reached =
      random() < profile.completion
        ? ids.length
        : 1 + Math.floor(random() * Math.max(1, ids.length - 1));
    const path = [];
    for (let s = 0; s < reached; s++) path.push(s);
    // Now and then a viewer steps back one slide before going on.
    if (reached > 2 && random() < 0.15) {
      const at = 1 + Math.floor(random() * (reached - 2));
      path.splice(at + 1, 0, at - 1);
    }

    const visits = new Map();
    const slideViews = [];
    let cursor = start;
    for (const index of path) {
      const visitNumber = (visits.get(index) || 0) + 1;
      visits.set(index, visitNumber);
      const seconds = Math.max(
        2,
        Math.round(profile.secondsPerSlide * (0.4 + random() * 1.2)),
      );
      slideViews.push({
        slideId: ids[index],
        slideIndex: index,
        enteredAt: new Date(cursor).toISOString(),
        exitedAt: new Date(cursor + seconds * 1000).toISOString(),
        durationSeconds: seconds,
        visitNumber,
      });
      cursor += seconds * 1000;
    }

    const last = slideViews[slideViews.length - 1];
    sessions.push({
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(cursor).toISOString(),
      durationSeconds: Math.round((cursor - start) / 1000),
      sourceType: pickWeighted(profile.sources, random()),
      deviceId: `sandbox-seed-${device}`,
      exitSlideId: last.slideId,
      exitSlideIndex: last.slideIndex,
      slideViews,
    });
  }
  return sessions;
}

/**
 * Write the declared view history for a guest's fresh copy of an example.
 * A no-op outside sandbox mode, with the analytics cluster off, or when the
 * example declares no profile.
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The guest's scope.
 * @param {{id:string, slides:Array<{id:string}>}} presentation - The stored copy.
 * @param {unknown} profile - The example's `sandbox.analytics` declaration.
 * @returns {Promise<{sessions:number}>}
 */
export async function seedSandboxAnalytics(scope, presentation, profile) {
  if (!sandboxEnabled() || !isAnalyticsEnabled()) return { sessions: 0 };
  const settled = normalizeAnalyticsProfile(profile);
  const sessions = buildSeedSessions(settled, presentation?.slides, {
    seed: presentation?.id,
  });
  if (!sessions.length) return { sessions: 0 };
  try {
    return await insertSeededViewSessions(scope, presentation.id, sessions);
  } catch (error) {
    // An empty dashboard is the old state, not a reason to refuse the example.
    log.warn('Could not seed sandbox insights', {
      presentationId: presentation.id,
      error: error?.message,
    });
    return { sessions: 0 };
  }
}
