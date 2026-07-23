import { badRequest, json, serveJson } from '../../../utils/http.js';
import { getString, getOptionalString, getLang } from '../../../utils/request-validators.js';
import { generateOutlineOnly } from '../../../utils/ai/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { log } from './shared.js';

/**
 * POST /api/ai/wizard-v2/outline — get the outline only (for debugging/preview).
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2Outline({ req, res, authedUser }) {
  const body = await json(req);
  const raw = getString(body, 'raw');
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const vendor = getOptionalString(body, 'vendor');
  const lang = getLang(body);

  const userName = getDisplayNameForUser(authedUser);

  try {
    const outline = await generateOutlineOnly(raw, {
      userName,
      targetLang: lang,
      vendor,
    });
    serveJson(res, 200, outline);
  } catch (e) {
    log.error('[AI Outline] Error:', e);
    const statusCode = e?.statusCode || 500;
    serveJson(res, statusCode, {
      error: e?.message || 'Outline generation failed',
    });
  }
  return true;
}
