import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { extractJsonObject } from './json.js';
import { labelForLang, normalizeTranslationLang } from './lang.js';

// Optional: load ciiic-translation-rules if available (CIIIC fork only)
let generateTerminologyPrompt = () => '';
let getGuidelines = () => '';
try {
  const rules = await import('ciiic-translation-rules');
  generateTerminologyPrompt = rules.generateTerminologyPrompt || generateTerminologyPrompt;
  getGuidelines = rules.getGuidelines || getGuidelines;
} catch {
  // ciiic-translation-rules not installed - using empty fallbacks
}

/**
 * Get top-level translatable keys for a slide type.
 * Returns keys for fields with type 'string' or 'markdown'.
 */
function translateKeysForSlideType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def || !Array.isArray(def.fields)) return [];
  return def.fields
    .filter((f) => f && (f.type === 'string' || f.type === 'markdown'))
    .map((f) => f.key)
    .filter((k) => typeof k === 'string' && k.trim());
}

/**
 * Get items fields info for a slide type.
 * Returns an array of { key, itemKeys } for each 'items' field,
 * where itemKeys are the translatable keys within each item.
 */
function itemsFieldsForSlideType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def || !Array.isArray(def.fields)) return [];
  return def.fields
    .filter((f) => f && f.type === 'items' && Array.isArray(f.itemFields))
    .map((f) => ({
      key: f.key,
      itemKeys: f.itemFields
        .filter((itemField) => itemField && (itemField.type === 'string' || itemField.type === 'markdown'))
        .map((itemField) => itemField.key)
        .filter((k) => typeof k === 'string' && k.trim()),
    }))
    .filter((info) => info.itemKeys.length > 0);
}

export async function translatePresentationStrings(
  presentation,
  { from, to, existingTarget = null, fillMissing = false, vendor = null } = {}
) {
  const fromLang = normalizeTranslationLang(from);
  const toLang = normalizeTranslationLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    const err = new Error('Invalid translation language pair.');
    err.statusCode = 400;
    throw err;
  }

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const srcTitle =
    typeof presentation?.title === 'string' ? presentation.title : '';
  const srcSlides = Array.isArray(presentation?.slides)
    ? presentation.slides
    : [];
  const targetTitle =
    typeof existingTarget?.title === 'string'
      ? existingTarget.title
      : '';
  const targetSlides = Array.isArray(existingTarget?.slides)
    ? existingTarget.slides
    : [];
  const targetById = new Map(
    targetSlides
      .filter(
        (s) =>
          s && typeof s === 'object' && typeof s.id === 'string'
      )
      .map((s) => [s.id, s])
  );

  const slideMeta = srcSlides.map((s) => ({
    id: typeof s?.id === 'string' ? s.id : '',
    type: typeof s?.type === 'string' ? s.type : '',
    translateKeys: translateKeysForSlideType(s?.type),
    itemsFields: itemsFieldsForSlideType(s?.type),
  }));

  const system = [
    'You are a careful, professional translation engine for a slide editor.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `SOURCE LANGUAGE: ${labelForLang(fromLang)}.`,
    `TARGET LANGUAGE: ${labelForLang(toLang)}.`,
    '',
    'CRITICAL RULES:',
    '- Keep slide count, order, ids, and types EXACTLY the same.',
    '- Do NOT change any non-text values: URLs, icon names, enums like layout/background/imageSide/cardCount, booleans, numbers.',
    '- Only translate string fields that are explicitly listed per slide in slideMeta.translateKeys and the top-level "title".',
    '- For array fields listed in slideMeta.itemsFields, translate only the specified itemKeys within each array item.',
    '- Preserve markdown structure in body fields (lists, headings, links).',
    '- Keep array item count and order EXACTLY the same.',
    '',
    '--- TERMINOLOGY RULES ---',
    generateTerminologyPrompt(),
    '',
    getGuidelines(toLang === 'nl' ? 'nl' : 'en'),
    '',
    'Output format MUST be exactly:',
    '{',
    '  "title": "...",',
    '  "slides": [',
    '    { "id": "...", "type": "...", "content": { ... } },',
    '    ...',
    '  ]',
    '}',
  ].join('\n');

  const user = [
    'TRANSLATE THIS PRESENTATION JSON:',
    JSON.stringify(
      {
        title: srcTitle,
        slides: srcSlides.map((s) => ({
          id: s?.id,
          type: s?.type,
          content:
            s?.content && typeof s.content === 'object'
              ? s.content
              : {},
        })),
      },
      null,
      2
    ),
    '',
    'SLIDE META (translate keys per slide id):',
    JSON.stringify(slideMeta, null, 2),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
    maxTokens: 8192,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  if (!obj || typeof obj !== 'object') {
    const err = new Error(
      `${resolvedVendor} did not return valid translation JSON.`
    );
    err.statusCode = 502;
    err.details = String(content || '').slice(0, 5000);
    throw err;
  }

  const llmTitle =
    typeof obj.title === 'string' ? obj.title : srcTitle;
  const outTitle =
    fillMissing && targetTitle.trim() ? targetTitle : llmTitle;
  const outSlides = Array.isArray(obj.slides) ? obj.slides : [];
  const outById = new Map(
    outSlides
      .filter(
        (s) =>
          s && typeof s === 'object' && typeof s.id === 'string'
      )
      .map((s) => [s.id, s])
  );

  // Post-process: only accept translated values for known text fields.
  const mergedSlides = srcSlides.map((src) => {
    const t = outById.get(src.id);
    const srcContent =
      src?.content && typeof src.content === 'object'
        ? src.content
        : {};
    const nextContent = { ...srcContent };
    const keys = translateKeysForSlideType(src?.type);
    const itemsFields = itemsFieldsForSlideType(src?.type);
    const tContent =
      t?.content && typeof t.content === 'object' ? t.content : null;
    const existing = targetById.get(src.id);
    const existingContent =
      existing?.content && typeof existing.content === 'object'
        ? existing.content
        : null;

    // Handle top-level string/markdown fields
    for (const k of keys) {
      const v = tContent?.[k];
      if (typeof v !== 'string') continue;
      if (fillMissing) {
        const cur = existingContent?.[k];
        if (typeof cur === 'string' && cur.trim()) {
          nextContent[k] = cur;
          continue;
        }
      }
      nextContent[k] = v;
    }

    // Handle items arrays (e.g., items, metrics, levels, cells, images)
    for (const { key: arrKey, itemKeys } of itemsFields) {
      const srcArr = Array.isArray(srcContent?.[arrKey]) ? srcContent[arrKey] : [];
      const tArr = Array.isArray(tContent?.[arrKey]) ? tContent[arrKey] : [];
      const existingArr = Array.isArray(existingContent?.[arrKey]) ? existingContent[arrKey] : [];

      // Merge translated items - preserve all source fields, only update translatable keys
      const mergedArr = srcArr.map((srcItem, idx) => {
        const tItem = tArr[idx] && typeof tArr[idx] === 'object' ? tArr[idx] : {};
        const existingItem = existingArr[idx] && typeof existingArr[idx] === 'object' ? existingArr[idx] : {};
        const mergedItem = { ...srcItem };

        for (const itemKey of itemKeys) {
          const v = tItem[itemKey];
          if (typeof v !== 'string') continue;
          if (fillMissing) {
            const cur = existingItem[itemKey];
            if (typeof cur === 'string' && cur.trim()) {
              mergedItem[itemKey] = cur;
              continue;
            }
          }
          mergedItem[itemKey] = v;
        }
        return mergedItem;
      });

      nextContent[arrKey] = mergedArr;
    }

    return {
      ...src,
      // Ensure ids/types are unchanged
      id: src.id,
      type: src.type,
      content: nextContent,
    };
  });

  return { title: outTitle, slides: mergedSlides };
}

export async function translateShortText(text, { from, to, vendor = null } = {}) {
  const fromLang = normalizeTranslationLang(from);
  const toLang = normalizeTranslationLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    const err = new Error('Invalid translation language pair.');
    err.statusCode = 400;
    throw err;
  }

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const src = String(text || '').trim();
  if (!src) return '';

  const system = [
    'You are a careful, professional translation engine.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `SOURCE LANGUAGE: ${labelForLang(fromLang)}.`,
    `TARGET LANGUAGE: ${labelForLang(toLang)}.`,
    '',
    'Rules:',
    '- Preserve meaning and tone.',
    '- Keep it as one text (do not add quotes).',
    '- Do not add extra explanations.',
    '',
    '--- TERMINOLOGY RULES ---',
    generateTerminologyPrompt(),
    '',
    getGuidelines(toLang === 'nl' ? 'nl' : 'en'),
    '',
    'Output format MUST be exactly:',
    '{ "text": "..." }',
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.1,
    maxTokens: 2048,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: src },
    ],
  });

  const obj = extractJsonObject(content);
  const out = typeof obj?.text === 'string' ? obj.text : '';
  return String(out || '').trim();
}

export async function translateFieldMap(fields, { from, to, vendor = null } = {}) {
  const fromLang = normalizeTranslationLang(from);
  const toLang = normalizeTranslationLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    const err = new Error('Invalid translation language pair.');
    err.statusCode = 400;
    throw err;
  }

  const input = fields && typeof fields === 'object' ? fields : {};
  const keys = Object.keys(input).filter((k) => {
    const v = input[k];
    return typeof k === 'string' && typeof v === 'string' && v.trim();
  });
  if (!keys.length) return {};

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const system = [
    'You are a careful, professional translation engine.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `SOURCE LANGUAGE: ${labelForLang(fromLang)}.`,
    `TARGET LANGUAGE: ${labelForLang(toLang)}.`,
    '',
    'Rules:',
    '- Translate each value string.',
    '- Preserve meaning and tone.',
    '- Preserve markdown formatting if present (lists, links).',
    '',
    '--- TERMINOLOGY RULES ---',
    generateTerminologyPrompt(),
    '',
    getGuidelines(toLang === 'nl' ? 'nl' : 'en'),
    '',
    'Output format MUST be exactly:',
    '{ "translations": { "<key>": "<translated text>", ... } }',
  ].join('\n');

  const user = JSON.stringify(
    { fields: Object.fromEntries(keys.map((k) => [k, input[k]])) },
    null,
    2
  );

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
    maxTokens: 4096,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  const out = obj?.translations;
  if (!out || typeof out !== 'object') return {};
  const mapped = {};
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') mapped[k] = String(v).trim();
  }
  return mapped;
}

export async function translatePresentationStringsFillMissing(
  { sourcePresentation, targetPresentation, missing = [] } = {},
  { from, to, vendor = null } = {}
) {
  const fromLang = normalizeTranslationLang(from);
  const toLang = normalizeTranslationLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    const err = new Error('Invalid translation language pair.');
    err.statusCode = 400;
    throw err;
  }

  const src = sourcePresentation || {};
  const tgt = targetPresentation || {};
  const srcTitle = typeof src?.title === 'string' ? src.title : '';
  const srcSlides = Array.isArray(src?.slides) ? src.slides : [];
  const tgtTitle = typeof tgt?.title === 'string' ? tgt.title : '';
  const tgtSlides = Array.isArray(tgt?.slides) ? tgt.slides : [];

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const slideMeta = srcSlides.map((s) => ({
    id: typeof s?.id === 'string' ? s.id : '',
    type: typeof s?.type === 'string' ? s.type : '',
    translateKeys: translateKeysForSlideType(s?.type),
    itemsFields: itemsFieldsForSlideType(s?.type),
  }));

  const system = [
    'You are a careful, professional translation engine for a slide editor.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    `SOURCE LANGUAGE: ${labelForLang(fromLang)}.`,
    `TARGET LANGUAGE: ${labelForLang(toLang)}.`,
    '',
    'CRITICAL RULES:',
    '- Keep slide count, order, ids, and types EXACTLY the same as the TARGET presentation.',
    '- Only fill in MISSING/EMPTY target strings for the requested fields. Do NOT overwrite any non-empty target strings.',
    '- Do NOT change any non-text values: URLs, icon names, enums like layout/background/imageSide/cardCount, booleans, numbers.',
    '- For array fields listed in slideMeta.itemsFields, translate only the specified itemKeys within each array item.',
    '- Preserve markdown structure in body fields (lists, headings, links).',
    '- Keep array item count and order EXACTLY the same.',
    '',
    '--- TERMINOLOGY RULES ---',
    generateTerminologyPrompt(),
    '',
    getGuidelines(toLang === 'nl' ? 'nl' : 'en'),
    '',
    'You will receive:',
    '- SOURCE presentation JSON (truth)',
    '- TARGET presentation JSON (some fields may be blank and need filling)',
    '- A list of missing fields to fill (missing[])',
    '- Slide meta indicating which keys are translatable for each slide type',
    '',
    'Output format MUST be exactly:',
    '{',
    '  "title": "...",',
    '  "slides": [',
    '    { "id": "...", "type": "...", "content": { ... } },',
    '    ...',
    '  ]',
    '}',
  ].join('\n');

  const user = [
    'SOURCE PRESENTATION JSON:',
    JSON.stringify(
      {
        title: srcTitle,
        slides: srcSlides.map((s) => ({
          id: s?.id,
          type: s?.type,
          content:
            s?.content && typeof s.content === 'object'
              ? s.content
              : {},
        })),
      },
      null,
      2
    ),
    '',
    'TARGET PRESENTATION JSON (fill missing fields only):',
    JSON.stringify(
      {
        title: tgtTitle,
        slides: tgtSlides.map((s) => ({
          id: s?.id,
          type: s?.type,
          content:
            s?.content && typeof s.content === 'object'
              ? s.content
              : {},
        })),
      },
      null,
      2
    ),
    '',
    'MISSING FIELDS (fill these only):',
    JSON.stringify(Array.isArray(missing) ? missing : [], null, 2),
    '',
    'SLIDE META (translate keys per slide id):',
    JSON.stringify(slideMeta, null, 2),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.1,
    responseFormat: { type: 'json_object' },
    maxTokens: 8192,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  if (!obj || typeof obj !== 'object') {
    const err = new Error(
      `${resolvedVendor} did not return valid translation JSON.`
    );
    err.statusCode = 502;
    err.details = String(content || '').slice(0, 5000);
    throw err;
  }

  const outTitle = typeof obj.title === 'string' ? obj.title : tgtTitle;
  const outSlides = Array.isArray(obj.slides) ? obj.slides : [];
  const outById = new Map(
    outSlides
      .filter(
        (s) =>
          s && typeof s === 'object' && typeof s.id === 'string'
      )
      .map((s) => [s.id, s])
  );

  const mergedSlides = tgtSlides.map((tSlide, idx) => {
    const out = outById.get(tSlide?.id) || outSlides[idx] || null;
    const srcSlide = srcSlides.find((s) => s?.id === tSlide?.id) || srcSlides[idx] || null;
    const tgtContent =
      tSlide?.content && typeof tSlide.content === 'object'
        ? tSlide.content
        : {};
    const srcContent =
      srcSlide?.content && typeof srcSlide.content === 'object'
        ? srcSlide.content
        : {};
    const nextContent = { ...tgtContent };
    const keys = translateKeysForSlideType(tSlide?.type);
    const itemsFields = itemsFieldsForSlideType(tSlide?.type);
    const outContent =
      out?.content && typeof out.content === 'object' ? out.content : null;

    // Handle top-level string/markdown fields
    for (const k of keys) {
      const cur = nextContent[k];
      if (typeof cur === 'string' && cur.trim()) continue; // don't overwrite
      const v = outContent?.[k];
      if (typeof v === 'string') nextContent[k] = v;
    }

    // Handle items arrays (e.g., items, metrics, levels, cells, images)
    for (const { key: arrKey, itemKeys } of itemsFields) {
      const srcArr = Array.isArray(srcContent?.[arrKey]) ? srcContent[arrKey] : [];
      const tgtArr = Array.isArray(tgtContent?.[arrKey]) ? tgtContent[arrKey] : [];
      const outArr = Array.isArray(outContent?.[arrKey]) ? outContent[arrKey] : [];

      // Merge translated items - preserve all target fields, only fill missing keys
      const mergedArr = srcArr.map((srcItem, itemIdx) => {
        const tgtItem = tgtArr[itemIdx] && typeof tgtArr[itemIdx] === 'object' ? tgtArr[itemIdx] : {};
        const outItem = outArr[itemIdx] && typeof outArr[itemIdx] === 'object' ? outArr[itemIdx] : {};
        const mergedItem = { ...tgtItem };

        for (const itemKey of itemKeys) {
          const cur = mergedItem[itemKey];
          if (typeof cur === 'string' && cur.trim()) continue; // don't overwrite
          const v = outItem[itemKey];
          if (typeof v === 'string') mergedItem[itemKey] = v;
        }
        return mergedItem;
      });

      nextContent[arrKey] = mergedArr;
    }

    return {
      ...tSlide,
      id: tSlide?.id,
      type: tSlide?.type,
      content: nextContent,
    };
  });

  return { title: outTitle, slides: mergedSlides };
}
