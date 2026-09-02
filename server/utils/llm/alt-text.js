import {
  DEFAULT_SUPPORTED_DECK_LANGS,
  TRANSLATION_LANG_LABELS,
  normalizeLang,
} from '../../../shared/i18n-utils.js';
import { getLlmConfig } from './config.js';
import { requestChatCompletionContent } from './index.js';
import { extractJsonObject } from '../openai/json.js';
import { truncateForPrompt } from '../openai/prompt.js';
import { resolveImageUrlForVisionInput } from './vision.js';
import { ValidationError } from '../errors.js';
import { LlmError } from './error.js';

/**
 * The languages one generation run writes, normalized onto the deck axis.
 *
 * The caller (the image library's alt panel) names the workspace's enabled
 * subset, because that is the set of inputs on screen — D72 #5. Before B182
 * fase 5 this was the hardcoded `nl` + `en-GB` pair, so a workspace running
 * German got an empty German field back from a button labelled "generate".
 * Off-axis codes are dropped rather than passed to the prompt; an empty result
 * falls back to the shipped subset so the endpoint always answers something.
 *
 * @param {unknown} langs
 * @returns {string[]}
 */
function resolveAltLangs(langs) {
  const out = [];
  for (const v of Array.isArray(langs) ? langs : []) {
    const l = normalizeLang(v);
    if (l && !out.includes(l)) out.push(l);
  }
  return out.length ? out : [...DEFAULT_SUPPORTED_DECK_LANGS];
}

function cleanTagList(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return arr
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

export async function generateImageAltTexts({
  repoRoot,
  imageUrl,
  description = '',
  tags = [],
  photographer = '',
  context = null,
  langs,
  vendor = 'openai',
} = {}) {
  const targetLangs = resolveAltLangs(langs);
  const url = String(imageUrl || '').trim();
  if (!url) {
    throw new ValidationError('imageUrl is required');
  }

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  if (resolvedVendor !== 'openai') {
    throw new ValidationError('Alt-text generation currently requires OpenAI.');
  }

  const vision = await resolveImageUrlForVisionInput(repoRoot, url);

  const ctxPresTitle = truncateForPrompt(context?.presentationTitle || '', 140);
  const ctxSlideTitle = truncateForPrompt(context?.slideTitle || '', 140);
  const ctxSlideType = truncateForPrompt(context?.slideType || '', 80);
  const desc = truncateForPrompt(description || '', 220);
  const tg = cleanTagList(tags);
  const photo = truncateForPrompt(photographer || '', 120);

  const shape = targetLangs.map((l) => `"${l}": "<alt text>"`).join(', ');
  const naming = targetLangs
    .map((l) => `natural ${TRANSLATION_LANG_LABELS[l]} for "${l}"`)
    .join(', ');

  const system = [
    'You are an expert accessibility assistant.',
    'Write concise, accurate alt text so blind/visually impaired users can understand what is in the image.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    'Output format MUST be exactly:',
    `{ ${shape} }`,
    '',
    'Rules:',
    '- Keep each alt text short (usually 6–18 words).',
    '- Do not start with "Image of" / "Photo of" unless necessary for clarity.',
    '- If the image is decorative or contains no meaningful information, return empty strings.',
    '- If there is visible text, summarize it only if it is central and short.',
    `- Use ${naming}.`,
  ].join('\n');

  const userText = [
    'This may be relevant context to determine the ALT text.',
    '',
    ctxPresTitle ? `Presentation title: ${ctxPresTitle}` : null,
    ctxSlideType ? `Slide type: ${ctxSlideType}` : null,
    ctxSlideTitle ? `Slide title: ${ctxSlideTitle}` : null,
    desc ? `Image library description: ${desc}` : null,
    photo ? `Photographer/credit: ${photo}` : null,
    tg.length ? `Tags: ${tg.join(', ')}` : null,
    '',
    'Provide a concise ALT text that we can use so that blind/visually impaired people have an idea of what is in the image.',
    'Return ONLY the JSON object.',
  ]
    .filter(Boolean)
    .join('\n');

  const userContent =
    vision.type === 'data' || vision.type === 'remote'
      ? [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: vision.url } },
        ]
      : [{ type: 'text', text: userText }];

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.2,
    responseFormat: { type: 'json_object' },
    // One short string per language plus its key, so a twelve-language run is
    // not capped by a budget sized for the old fixed pair. (The
    // OpenAI-compatible request transform drops `maxTokens` before it reaches
    // the wire — a seam of its own, not this module's to fix; the value stated
    // here is the one that holds the day it stops.)
    maxTokens: 200 + 120 * targetLangs.length,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });

  const obj = extractJsonObject(content);
  if (!obj || typeof obj !== 'object') {
    // The raw response rides along as a field for logging, never the envelope.
    throw new LlmError('LLM did not return valid alt-text JSON.', {
      statusCode: 502,
      response: content,
      phase: 'alt-text',
    });
  }

  const alts = {};
  for (const lang of targetLangs) {
    const v = typeof obj[lang] === 'string' ? obj[lang].trim() : '';
    alts[lang] = v.slice(0, 220);
  }

  return {
    alts,
    langs: targetLangs,
    _meta: {
      usedVision: vision.type === 'data' || vision.type === 'remote',
      visionType: vision.type,
    },
  };
}
