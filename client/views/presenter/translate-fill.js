import {
  getLangDisplayName,
  translationSourceFor,
} from '../../../shared/i18n-utils.js';
import { translationProgress } from '../../../shared/i18n-progress.js';
import { getSupportedLangs, hasLangVersion } from '../../lib/format/i18n.js';
import { t } from '../../lib/ui-i18n.js';

/** How often to ask whether a background fill-job has finished. */
const POLL_MS = 1500;

/** How long the "ready" pill stays up before it clears itself. */
const DONE_LINGER_MS = 1400;

/**
 * The languages a follow-along audience may pick that this deck cannot serve
 * yet — either the version does not exist, or it exists with gaps.
 *
 * The candidate set is the workspace's enabled subset, not "the other language
 * of the pair": on a bilingual instance that is exactly the one language the
 * old `otherLang()` named, and on a wider one it is every language an author
 * could have switched on. The deck's dominant version is the translation
 * source, so it is never a target.
 *
 * @param {Object} pres - the deck being presented
 * @returns {string[]}
 */
function incompleteTargets(pres) {
  const { dominant, missing } = translationProgress(pres);
  const out = [];
  for (const lang of getSupportedLangs()) {
    if (!lang || lang === dominant) continue;
    if (!translationSourceFor(pres, lang)) continue;
    const gaps = missing[lang];
    if (!hasLangVersion(pres, lang) || (typeof gaps === 'number' && gaps > 0))
      out.push(lang);
  }
  return out;
}

/**
 * Fill in the missing translations of a deck in the background while it is
 * being presented, so the follow-along audience can read along in any language
 * the workspace offers.
 *
 * Gaps only — the server's fill-missing endpoint preserves anything already
 * translated by hand. Best-effort throughout: a failure hides the pill and the
 * presenter is never interrupted.
 *
 * @param {Object} args
 * @param {Function} args.api - the authenticated fetch wrapper
 * @param {string} args.presentationId
 * @param {Object} args.pres - the deck being presented
 * @param {HTMLElement} [args.translatePill] - status pill in the presenter topbar
 */
export function ensureFollowAlongTranslations({
  api,
  presentationId,
  pres,
  translatePill,
} = {}) {
  try {
    if (!translatePill) return;
    const targets = incompleteTargets(pres);
    if (!targets.length) return;

    translatePill.hidden = false;
    translatePill.textContent = t(
      'presenter.translateFill.running',
      'Translating ({langs})…',
      {
        langs: targets.map(getLangDisplayName).join(', '),
      },
    );

    // Background mode returns immediately, so the deck is polled until the job
    // reports done. Resolves either way — the pill clears when the last target
    // settles, successfully or not.
    const waitForJob = (to) =>
      new Promise((resolve) => {
        const tick = async () => {
          try {
            const fresh = await api(`/api/presentations/${presentationId}`);
            if (fresh?.i18n?.translation?.[to]?.status === 'done') {
              if (fresh?.i18n) pres.i18n = fresh.i18n;
              resolve(true);
              return;
            }
          } catch {
            resolve(false);
            return;
          }
          setTimeout(tick, POLL_MS);
        };
        setTimeout(tick, POLL_MS);
      });

    const fill = (to) =>
      api(`/api/presentations/${presentationId}/translate/missing`, {
        method: 'POST',
        body: JSON.stringify({
          from: translationSourceFor(pres, to),
          to,
          mode: 'background',
        }),
      })
        .then(() => waitForJob(to))
        .catch(() => false);

    Promise.all(targets.map(fill)).then(() => {
      translatePill.textContent = t(
        'presenter.translateFill.done',
        'Translations ready',
      );
      setTimeout(() => {
        translatePill.hidden = true;
      }, DONE_LINGER_MS);
    });
  } catch {
    // Best-effort: presenting must never fail on a translation job.
  }
}
