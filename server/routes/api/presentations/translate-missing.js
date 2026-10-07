/**
 * `POST /api/presentations/:id/translate/missing` — fill the gaps of a
 * language version. The route parses and answers; the work is the translate
 * service's plan + run (`server/services/translate.js`, B610).
 *
 * `mode: 'background'` answers as soon as the plan is made (the pair refused
 * or resolved, the gaps counted) and runs it after the response, at most
 * once per deck and pair at a time: the presenter asks for every incomplete
 * language when a deck opens, and a second request for the same pair would
 * spend the tokens twice. That mode and its lock are this contract's; v1 has
 * no background translate.
 */

import {
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import {
  planMissingTranslation,
  runMissingTranslation,
} from '../../../services/translate.js';

// In-process translation job lock (prevents double-spending tokens)
const missingTranslationJobs = new Map();

export async function handlePresentationTranslateMissing(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body || {};
  const vendor = getOptionalString(body, 'vendor');
  const mode = body.mode === 'background' ? 'background' : 'wait';
  const identity = { actor: authedUser };

  const plan = await planMissingTranslation(storageScope, identity, {
    presentationId: id,
    from: body.from,
    to: body.to,
  });
  const { from, to, missingCount } = plan;
  if (!missingCount) {
    serveJson(res, 200, { ok: true, from, to, updated: false, missingCount });
    return true;
  }

  if (mode === 'background') {
    const jobKey = `${id}:${from}->${to}`;
    if (!missingTranslationJobs.has(jobKey)) {
      const job = runMissingTranslation(storageScope, identity, plan, {
        vendor,
      })
        .catch(() => null)
        .finally(() => {
          missingTranslationJobs.delete(jobKey);
        });
      missingTranslationJobs.set(jobKey, job);
    }
    serveJson(res, 200, {
      ok: true,
      from,
      to,
      updated: true,
      started: true,
      missingCount,
    });
    return true;
  }

  const { presentation } = await runMissingTranslation(
    storageScope,
    identity,
    plan,
    { vendor },
  );
  serveJson(res, 200, {
    ok: true,
    from,
    to,
    updated: true,
    started: false,
    missingCount,
    presentation,
  });
  return true;
}
