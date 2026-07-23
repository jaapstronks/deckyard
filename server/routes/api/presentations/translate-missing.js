import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import { getFeatureFlags } from '../../../config/feature-flags.js';
import { translatePresentationStringsFillMissing } from '../../../utils/ai.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import {
  buildBlankTargetFromSource,
  computeMissingTranslation,
  normalizeLang,
  otherLang,
  pickVersion,
} from '../../../utils/translation-status.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';

// In-process translation job lock (prevents double-spending tokens)
const missingTranslationJobs = new Map();

export async function handlePresentationTranslateMissing(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const flags = getFeatureFlags();
  if (flags.disableAi) return notFound(res);

  const body = await json(req);
  const vendor = getOptionalString(body, 'vendor');
  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);
  if (!canWritePresentation({ user: authedUser, pres })) return unauthorized(res);

  pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions =
    pres.i18n.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};

  const from =
    normalizeLang(body?.from) ||
    normalizeLang(pres.i18n.active) ||
    normalizeLang(pres.i18n.dominant) ||
    'nl';
  const to = normalizeLang(body?.to) || otherLang(from);
  const mode = body?.mode === 'background' ? 'background' : 'wait';

  // Ensure from-version exists.
  const dominant = normalizeLang(pres.i18n.dominant) || from;
  pres.i18n.dominant = dominant;
  pres.i18n.active = from;
  if (!pres.i18n.versions[dominant]) {
    pres.i18n.versions[dominant] = { title: pres.title, slides: pres.slides };
  }
  if (!pres.i18n.versions[from]) {
    pres.i18n.versions[from] = { title: pres.title, slides: pres.slides };
  }

  const src = pickVersion(pres, from);
  const tgtExisting = pres.i18n.versions[to] ? pickVersion(pres, to) : null;
  const tgt = tgtExisting || buildBlankTargetFromSource(src);

  const missingInfo = computeMissingTranslation({ source: src, target: tgt });
  const missingCount = Number(missingInfo?.missingCount || 0) || 0;
  if (!missingCount) {
    serveJson(res, 200, { ok: true, from, to, updated: false, missingCount: 0 });
    return true;
  }

  const jobKey = `${id}:${from}->${to}`;
  const run = async () => {
    // Mark "running" (best-effort, persisted)
    pres.i18n.translation =
      pres.i18n.translation && typeof pres.i18n.translation === 'object'
        ? pres.i18n.translation
        : {};
    pres.i18n.translation[to] = {
      status: 'running',
      from,
      updatedAt: new Date().toISOString(),
      missingCount,
    };
    await updatePresentation(repoRoot, id, pres, {
      actorEmail: authedUser?.email || null,
    });

    const filled = await translatePresentationStringsFillMissing(
      {
        sourcePresentation: src,
        targetPresentation: tgt,
        missing: missingInfo.missing,
      },
      { from, to, vendor }
    );

    const fresh = await getPresentation(repoRoot, id);
    if (!fresh) return null;
    fresh.i18n = fresh.i18n && typeof fresh.i18n === 'object' ? fresh.i18n : {};
    fresh.i18n.versions =
      fresh.i18n.versions && typeof fresh.i18n.versions === 'object'
        ? fresh.i18n.versions
        : {};
    fresh.i18n.versions[to] = { title: filled.title, slides: filled.slides };
    fresh.i18n.translation =
      fresh.i18n.translation && typeof fresh.i18n.translation === 'object'
        ? fresh.i18n.translation
        : {};

    const afterMissing = computeMissingTranslation({
      source: pickVersion(fresh, from),
      target: pickVersion(fresh, to),
    });
    fresh.i18n.translation[to] = {
      status: 'done',
      from,
      updatedAt: new Date().toISOString(),
      missingCount: Number(afterMissing?.missingCount || 0) || 0,
    };

    return await updatePresentation(repoRoot, id, fresh, {
      actorEmail: authedUser?.email || null,
    });
  };

  if (mode === 'background') {
    if (!missingTranslationJobs.has(jobKey)) {
      const p = run()
        .catch(() => null)
        .finally(() => {
          missingTranslationJobs.delete(jobKey);
        });
      missingTranslationJobs.set(jobKey, p);
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

  // wait
  const updated = await run();
  serveJson(res, 200, {
    ok: true,
    from,
    to,
    updated: true,
    started: false,
    missingCount,
    presentation: updated,
  });
  return true;
}
