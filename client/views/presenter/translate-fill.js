import { otherLang, resolveDeckLang } from '../../../shared/i18n-utils.js';

export function ensureOtherLanguageFollowAlong({
  api,
  presentationId,
  pres,
  activeLang,
  translatePill,
} = {}) {
  try {
    if (!translatePill) return;
    const srcLang = activeLang || resolveDeckLang(pres) || null;
    const other = otherLang(srcLang);
    const prog =
      pres?.i18n?.progress && typeof pres.i18n.progress === 'object'
        ? pres.i18n.progress
        : null;
    // The stored progress counters are still NL↔EN-shaped; `otherLang` only
    // answers inside that pair, so a null `other` short-circuits everything
    // below and no other branch is reachable (B182).
    const missing =
      other === 'en-GB' ? prog?.missingNlToEnGb : prog?.missingEnGbToNl;
    const hasOther =
      !!other &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      !!pres.i18n.versions?.[other];
    const needs =
      !!other && (!hasOther || (typeof missing === 'number' && missing > 0));
    if (needs && srcLang) {
      translatePill.hidden = false;
      translatePill.textContent =
        other === 'nl' ? 'Vertalen (NL)…' : 'Translating (EN)…';
      // Use translate/missing with background mode so job status is tracked for follow-along viewers
      api(`/api/presentations/${presentationId}/translate/missing`, {
        method: 'POST',
        body: JSON.stringify({
          from: srcLang,
          to: other,
          mode: 'background',
        }),
      })
        .then(() => {
          // Poll for completion since background mode returns immediately
          const pollForCompletion = async () => {
            try {
              const freshPres = await api(
                `/api/presentations/${presentationId}`,
              );
              const job = freshPres?.i18n?.translation?.[other];
              if (job?.status === 'done') {
                if (freshPres?.i18n) pres.i18n = freshPres.i18n;
                translatePill.textContent =
                  other === 'nl' ? 'NL klaar' : 'EN ready';
                setTimeout(() => {
                  translatePill.hidden = true;
                }, 1400);
                return;
              }
              // Still running, poll again
              setTimeout(pollForCompletion, 1500);
            } catch {
              translatePill.hidden = true;
            }
          };
          setTimeout(pollForCompletion, 1500);
        })
        .catch(() => {
          translatePill.hidden = true;
        });
    }
  } catch {
    // ignore
  }
}
