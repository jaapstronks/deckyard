import {
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import { slideProse } from '../../../../shared/slide-types/text-fields.js';
import { getLlmConfig } from '../../../utils/llm/config.js';
import { requestChatCompletionContent } from '../../../utils/llm/index.js';
import { extractJsonObject } from '../../../utils/openai/json.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';

function normalizeLangHint(v) {
  return normalizeLang(v) || DEFAULT_DECK_LANG;
}

// Alt text is usually not helpful for a meta description.
function shouldIgnoreTextKey(key) {
  return key === 'alt';
}

/**
 * The prose on one slide, for the description prompt (alt text left out).
 * @param {Object} slide - Stored slide
 * @returns {string}
 */
function extractSlideText(slide) {
  return slideProse(slide, { skipKey: shouldIgnoreTextKey }).join('\n');
}

function pickSlidesForPrompt(slides) {
  const arr = Array.isArray(slides) ? slides : [];
  if (arr.length <= 8) return arr;
  const first = arr.slice(0, 4);
  const last = arr.slice(Math.max(0, arr.length - 4));
  return [...first, ...last];
}

export async function handlePresentationDescriptionGenerate(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const vendor = getOptionalString(body, 'vendor');

  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const lang = normalizeLangHint(
    (pres?.i18n && typeof pres.i18n === 'object' && pres.i18n.active) ||
      pres?.lang,
  );
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const picked = pickSlidesForPrompt(slides);
  const slideSnippets = picked
    .map((s, idx) => {
      const text = extractSlideText(s);
      if (!text.trim()) return null;
      const type = typeof s?.type === 'string' ? s.type : '';
      // Include original slide index for better context.
      const originalIndex = slides.indexOf(s);
      return {
        slide: originalIndex >= 0 ? originalIndex + 1 : idx + 1,
        type,
        text,
      };
    })
    .filter(Boolean);

  const title = typeof pres?.title === 'string' ? pres.title : '';
  const theme = typeof pres?.theme === 'string' ? pres.theme : '';

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const system = [
    'You write short meta descriptions for published slide decks.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    'CRITICAL RULES:',
    '- Output exactly TWO sentences.',
    '- Keep it concise (ideally under 260 characters).',
    '- Do not use bullet points, hashtags, emojis, or quotes.',
    '- Do not invent facts; base it only on the provided slide text.',
    '',
    lang === 'en-GB'
      ? 'Write in British English (en-GB).'
      : 'Schrijf in natuurlijk Nederlands.',
    '',
    'Output format MUST be exactly:',
    '{ "description": "..." }',
  ].join('\n');

  const user = [
    'DECK CONTEXT:',
    JSON.stringify(
      {
        title,
        theme,
        slideCount: slides.length,
        includedSlides: slideSnippets,
      },
      null,
      2,
    ),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
    maxTokens: 512,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  const descriptionRaw =
    typeof obj?.description === 'string' ? obj.description : '';
  const description = String(descriptionRaw || '').trim();
  serveJson(res, 200, { ok: true, description });
  return true;
}
