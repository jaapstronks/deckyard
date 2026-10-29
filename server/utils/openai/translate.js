import {
  mapItemTexts,
  perLanguageKeys,
  textFieldSpecForType,
  translatableItemsFields,
  valueAtPath,
} from '../../../shared/slide-types/text-fields.js';
import { getLlmConfig } from '../llm/config.js';
import { LlmError } from '../llm/error.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { ValidationError } from '../errors.js';
import { slideTextRows } from '../../../shared/i18n-progress.js';
import { isNonEmptyString } from '../../../shared/i18n-utils.js';
import { extractJsonObject } from './json.js';
import { labelForLang, normalizeLang } from './lang.js';
import { translationReferenceLines } from './translation-instructions.js';

/**
 * The top-level keys to translate on one stored slide: its type's text fields,
 * plus any undeclared key whose stored value is prose. The undeclared ones are
 * remnants (a renamed key, a retired type) and are read per language
 * everywhere else, so leaving them out of the prompt would report them missing
 * forever (D79).
 * @param {Object} slide - Stored slide, in the language being read
 * @param {...Object} [others] - The same slide in other language versions
 * @returns {string[]}
 */
function translateKeysForSlide(slide, ...others) {
  const type = typeof slide?.type === 'string' ? slide.type : '';
  const contentOf = (s) =>
    s?.content && typeof s.content === 'object' ? s.content : {};
  return [
    ...perLanguageKeys(
      textFieldSpecForType(type),
      contentOf(slide),
      ...others.map(contentOf),
    ),
  ];
}

/**
 * The `items` fields to translate on one stored slide, as the model sees them
 * in `slideMeta.itemsFields`: `{ key, itemKeys, itemsFields? }` per items field
 * that carries prose at any depth. Read across the language versions, so an
 * undeclared string inside an entry is listed like the top-level remnants
 * `translateKeysForSlide` lists (D116).
 * @param {Object} slide - Stored slide, in the language being read
 * @param {...Object} [others] - The same slide in other language versions
 * @returns {{key: string, itemKeys: string[], itemsFields?: Object[]}[]}
 */
function itemsFieldsForSlide(slide, ...others) {
  const type = typeof slide?.type === 'string' ? slide.type : '';
  return translatableItemsFields(
    textFieldSpecForType(type),
    slide?.content,
    ...others.map((s) => s?.content),
  );
}

export async function translatePresentationStrings(
  presentation,
  {
    from,
    to,
    existingTarget = null,
    fillMissing = false,
    vendor = null,
    organizationId = null,
  } = {},
) {
  const fromLang = normalizeLang(from);
  const toLang = normalizeLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    throw new ValidationError('Invalid translation language pair.');
  }

  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const srcTitle =
    typeof presentation?.title === 'string' ? presentation.title : '';
  const srcSlides = Array.isArray(presentation?.slides)
    ? presentation.slides
    : [];
  const targetTitle =
    typeof existingTarget?.title === 'string' ? existingTarget.title : '';
  const targetSlides = Array.isArray(existingTarget?.slides)
    ? existingTarget.slides
    : [];
  const targetById = new Map(
    targetSlides
      .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
      .map((s) => [s.id, s]),
  );

  const slideMeta = srcSlides.map((s) => ({
    id: typeof s?.id === 'string' ? s.id : '',
    type: typeof s?.type === 'string' ? s.type : '',
    translateKeys: translateKeysForSlide(s, targetById.get(s?.id)),
    itemsFields: itemsFieldsForSlide(s, targetById.get(s?.id)),
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
    '- Do NOT change any non-text values: URLs, icon names, enums like layout/background/imageSide, booleans, numbers.',
    '- Only translate string fields that are explicitly listed per slide in slideMeta.translateKeys and the top-level "title".',
    '- For array fields listed in slideMeta.itemsFields, translate only the specified itemKeys within each array item; an entry may carry its own itemsFields for a nested array, which follows the same rule at that level.',
    '- Preserve markdown structure in body fields (lists, headings, links).',
    '- Keep array item count and order EXACTLY the same.',
    '',
    ...(await translationReferenceLines(organizationId, toLang)),
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
          content: s?.content && typeof s.content === 'object' ? s.content : {},
        })),
      },
      null,
      2,
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
    // The raw response rides along as a field for logging, never the envelope.
    throw new LlmError(
      `${resolvedVendor} did not return valid translation JSON.`,
      {
        statusCode: 502,
        vendor: resolvedVendor,
        response: content,
        phase: 'translate',
      },
    );
  }

  const llmTitle = typeof obj.title === 'string' ? obj.title : '';
  const outTitle = fillMissing && targetTitle.trim() ? targetTitle : llmTitle;
  const outSlides = Array.isArray(obj.slides) ? obj.slides : [];
  const outById = new Map(
    outSlides
      .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
      .map((s) => [s.id, s]),
  );

  // Post-process: only accept translated values for per-language fields.
  const mergedSlides = srcSlides.map((src) => {
    const t = outById.get(src.id);
    const srcContent =
      src?.content && typeof src.content === 'object' ? src.content : {};
    const nextContent = { ...srcContent };
    const existing = targetById.get(src.id);
    const keys = translateKeysForSlide(src, existing);
    const spec = textFieldSpecForType(src?.type);
    const tContent =
      t?.content && typeof t.content === 'object' ? t.content : null;
    const existingContent =
      existing?.content && typeof existing.content === 'object'
        ? existing.content
        : null;

    // Handle top-level string/markdown fields
    for (const k of keys) {
      const v = tContent?.[k];
      if (fillMissing) {
        const cur = existingContent?.[k];
        if (typeof cur === 'string' && cur.trim()) {
          nextContent[k] = cur;
          continue;
        }
      }
      if (typeof v === 'string') nextContent[k] = v;
      else if (typeof srcContent[k] === 'string') nextContent[k] = '';
    }

    // Handle items arrays (e.g., items, metrics, levels, cells, images) and
    // their nested items arrays: `mapItemTexts` walks to the bottom, so
    // `rows[].blocks[].title` is matched per index like any other text field.
    for (const [arrKey, itemSpec] of spec.items) {
      if (!Array.isArray(srcContent?.[arrKey])) continue;
      nextContent[arrKey] = mapItemTexts(srcContent[arrKey], itemSpec, {
        path: [arrKey],
        // Unanswered prose stays empty so the caller can report and retry it.
        resolve: (path) => {
          if (fillMissing) {
            const cur = valueAtPath(existingContent, path);
            if (typeof cur === 'string' && cur.trim()) return cur;
          }
          const v = valueAtPath(tContent, path);
          return typeof v === 'string' ? v : '';
        },
      });
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

export async function translateShortText(
  text,
  { from, to, vendor = null, organizationId = null } = {},
) {
  const fromLang = normalizeLang(from);
  const toLang = normalizeLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    throw new ValidationError('Invalid translation language pair.');
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
    ...(await translationReferenceLines(organizationId, toLang)),
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

export async function translateFieldMap(
  fields,
  { from, to, vendor = null, organizationId = null } = {},
) {
  const fromLang = normalizeLang(from);
  const toLang = normalizeLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    throw new ValidationError('Invalid translation language pair.');
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
    '- Each value stands alone: translate only that value, never move text between keys.',
    '- Preserve meaning and tone.',
    '- Preserve markdown formatting if present (lists, links).',
    '',
    ...(await translationReferenceLines(organizationId, toLang)),
    'Output format MUST be exactly:',
    '{ "translations": { "<key>": "<translated text>", ... } }',
  ].join('\n');

  const user = JSON.stringify(
    { fields: Object.fromEntries(keys.map((k) => [k, input[k]])) },
    null,
    2,
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

/** Source characters per fill-missing model call; a large deck is split. */
const FILL_BATCH_CHARS = 6000;

/**
 * Split a field map into batches of at most {@link FILL_BATCH_CHARS} source
 * characters (a single longer field gets a batch of its own).
 * @param {Record<string, string>} fields
 * @returns {Array<Record<string, string>>}
 */
function fieldBatches(fields) {
  const batches = [];
  let batch = {};
  let size = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (size && size + value.length > FILL_BATCH_CHARS) {
      batches.push(batch);
      batch = {};
      size = 0;
    }
    batch[key] = value;
    size += value.length;
  }
  if (size) batches.push(batch);
  return batches;
}

/**
 * Write `value` at `path` inside `root`, creating the containers on the way
 * (an array where the next step is an index).
 * @param {Object} root
 * @param {Array<string|number>} path
 * @param {string} value
 */
function setAtPath(root, path, value) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const step = path[i];
    if (!node[step] || typeof node[step] !== 'object')
      node[step] = typeof path[i + 1] === 'number' ? [] : {};
    node = node[step];
  }
  node[path.at(-1)] = value;
}

/**
 * Fill the empty texts of a target version from the source, one path at a
 * time: every gap gets the translation of the source value on the *same*
 * path, and nothing else.
 *
 * The model sees only the gaps' source strings, as an isolated field map,
 * never the two versions. A whole-deck prompt left it room to carry text from
 * one item into another: it filled an empty timeline entry with the texts of
 * three different items, one of which then blocked every save (DY-773). The
 * gaps are the rows `computeMissingTranslation` reports, so the fill
 * and the count agree about what is missing.
 *
 * @param {Object} args
 * @param {{title?: string, slides?: Object[]}} args.sourcePresentation - the version read from
 * @param {{title?: string, slides?: Object[]}} args.targetPresentation - the version written to
 * @param {Object} opts - `{ from, to, vendor, organizationId }`
 * @returns {Promise<{title: string, slides: Object[]}>} The target with its gaps filled
 */
export async function translatePresentationStringsFillMissing(
  { sourcePresentation, targetPresentation } = {},
  { from, to, vendor = null, organizationId = null } = {},
) {
  const fromLang = normalizeLang(from);
  const toLang = normalizeLang(to);
  if (!fromLang || !toLang || fromLang === toLang) {
    throw new ValidationError('Invalid translation language pair.');
  }

  const src = sourcePresentation || {};
  const tgt = targetPresentation || {};
  const out = {
    title: typeof tgt.title === 'string' ? tgt.title : '',
    slides: structuredClone(Array.isArray(tgt.slides) ? tgt.slides : []),
  };

  const gaps = slideTextRows(src, tgt).filter(
    (row) => isNonEmptyString(row.source) && !isNonEmptyString(row.target),
  );
  if (!gaps.length) return out;

  const fields = Object.fromEntries(gaps.map((g, i) => [`f${i}`, g.source]));
  const translations = {};
  for (const batch of fieldBatches(fields)) {
    Object.assign(
      translations,
      await translateFieldMap(batch, {
        from: fromLang,
        to: toLang,
        vendor,
        organizationId,
      }),
    );
  }

  const outById = new Map(
    out.slides
      .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
      .map((s) => [s.id, s]),
  );
  gaps.forEach((gap, i) => {
    const value = translations[`f${i}`];
    if (!isNonEmptyString(value)) return;
    if (gap.kind === 'deck') {
      out.title = value;
      return;
    }
    // The slide `slideTextRows` read the gap's target off: by id, else at
    // the same index.
    const slide =
      (gap.slideId && outById.get(gap.slideId)) || out.slides[gap.slideIndex];
    if (!slide || typeof slide !== 'object') return;
    if (!slide.content || typeof slide.content !== 'object') slide.content = {};
    setAtPath(slide.content, gap.path, value);
  });

  return out;
}
