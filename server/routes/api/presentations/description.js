import { getPresentation } from '../../../storage/presentations/index.js';
import { getFeatureFlags } from '../../../config/flags-snapshot.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { isTextField } from '../../../../shared/slide-types/text-fields.js';
import { getLlmConfig } from '../../../utils/llm/config.js';
import { requestChatCompletionContent } from '../../../utils/llm/index.js';
import { extractJsonObject } from '../../../utils/openai/json.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';

function normalizeLangHint(v) {
  return normalizeLang(v) || DEFAULT_DECK_LANG;
}

function shouldIgnoreTextKey(key) {
  const k = String(key || '')
    .trim()
    .toLowerCase();
  if (!k) return true;
  // Usually not helpful for a meta description.
  if (k === 'alt' || k === 'altnl' || k === 'alten') return true;
  return false;
}

function extractSlideText(slide) {
  const def = SLIDE_TYPES?.[slide?.type];
  if (!def || !Array.isArray(def.fields)) return '';
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const parts = [];

  for (const f of def.fields || []) {
    if (!f || typeof f.key !== 'string') continue;
    const key = f.key;
    if (shouldIgnoreTextKey(key)) continue;
    const val = content[key];

    if (isTextField(f)) {
      if (typeof val === 'string' && val.trim()) parts.push(val.trim());
      continue;
    }
    if (f.type === 'items') {
      const arr = Array.isArray(val) ? val : [];
      const itemFields = Array.isArray(f.itemFields) ? f.itemFields : [];
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        for (const itf of itemFields) {
          if (!itf || typeof itf.key !== 'string') continue;
          if (shouldIgnoreTextKey(itf.key)) continue;
          if (!isTextField(itf)) continue;
          const iv = it[itf.key];
          if (typeof iv === 'string' && iv.trim()) parts.push(iv.trim());
        }
      }
    }
  }

  return parts.join('\n');
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
  const flags = getFeatureFlags();
  if (!flags.enableAi) return notFound(res);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const vendor = getOptionalString(body, 'vendor');

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);
  if (!canReadPresentation({ user: authedUser, pres })) return forbidden(res);

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
