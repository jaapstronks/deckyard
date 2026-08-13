import { badRequest, serveJson, requireJsonBody } from '../../../utils/http.js';
import { getString, getOptionalString, getLang } from '../../../utils/request-validators.js';
import { generateOutlineOnly } from '../../../utils/ai/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';

/**
 * POST /api/ai/wizard-v2/outline — get the outline only (for debugging/preview).
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2Outline({ req, res, authedUser }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const raw = getString(body, 'raw');
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const vendor = getOptionalString(body, 'vendor');
  const lang = getLang(body);

  const userName = getDisplayNameForUser(authedUser);

  // LLM failures are AppErrors (LlmError/ValidationError) — the
  // withErrorHandler wrapper on the ai dispatcher serves them as the
  // canonical envelope with their own status.
  const outline = await generateOutlineOnly(raw, {
    userName,
    targetLang: lang,
    vendor,
  });
  serveJson(res, 200, outline);
  return true;
}
