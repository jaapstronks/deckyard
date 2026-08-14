import { getLlmConfig } from './config.js';
import { requestChatCompletionContent } from './index.js';
import { extractJsonObject } from '../openai/json.js';
import { truncateForPrompt } from '../openai/prompt.js';
import { resolveImageUrlForVisionInput } from './vision.js';
import { ValidationError } from '../errors.js';
import { LlmError } from './error.js';

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
  vendor = 'openai',
} = {}) {
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

  const system = [
    'You are an expert accessibility assistant.',
    'Write concise, accurate alt text so blind/visually impaired users can understand what is in the image.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    'Output format MUST be exactly:',
    '{ "nl": "<alt text>", "en-GB": "<alt text>" }',
    '',
    'Rules:',
    '- Keep each alt text short (usually 6–18 words).',
    '- Do not start with "Image of" / "Photo of" unless necessary for clarity.',
    '- If the image is decorative or contains no meaningful information, return empty strings.',
    '- If there is visible text, summarize it only if it is central and short.',
    '- Use natural Dutch for "nl" and British English for "en-GB".',
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
    maxTokens: 500,
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

  const nl = typeof obj.nl === 'string' ? obj.nl.trim() : '';
  const enGb = typeof obj['en-GB'] === 'string' ? obj['en-GB'].trim() : '';

  return {
    nl: nl.slice(0, 220),
    'en-GB': enGb.slice(0, 220),
    _meta: {
      usedVision: vision.type === 'data' || vision.type === 'remote',
      visionType: vision.type,
    },
  };
}
