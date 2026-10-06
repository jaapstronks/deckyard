import {
  curlyQuote,
  escapeHtml,
  gradientVarsForSlide,
  pickAltText,
  styleAttrFromVars,
  imagePlaceholderHtml,
} from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/**
 * Quote, name and role are one composition — the type has always centred them
 * TOGETHER rather than centring each field inside its own box. That behaviour
 * used to be a hardcode reading one designated field's per-field alignment
 * (`textStyles.quote.align`); it is now the declared field-group model, which
 * is what text-roles.js has had booked as "retires the quote hardcode" since
 * the role rollout.
 *
 * `quoteAlign` is the ONE stored form. Decks authored before the group kept
 * their centring in `textStyles.quote.align`; that value is folded into
 * `quoteAlign` once by the v4 -> v5 schema migration (schema-version.js), so
 * nothing here reads the legacy key any more. A deck that somehow reaches the
 * renderer un-migrated falls back to the group's default, like any other
 * unrecognised alignment value.
 */
const QUOTE_BLOCK = alignGroup('quote-block', 'quoteAlign', {
  label: 'Quote block alignment',
  schematicKind: 'quote',
});

/**
 * Every quote on the slide lives in `quotes[]`, the first included (D314):
 * one storage form, so a quote, its byline and its portraits mean the same
 * keys wherever they stand. Stored decks from before the fold carried the
 * first quote in flat top-level keys; the v16 -> v17 schema step moved them.
 */
const MAX_QUOTES = 3;
// Each quote shows up to two round portraits (a duo shares one quote).
const PORTRAIT_SLOTS = 2;

/**
 * The `data-inline-photo` index of portrait `slot` (1-based) on quote `i`:
 * item-major, matching the `slots` media grammar in the inline-edit companion.
 * @param {number} i
 * @param {number} slot
 * @returns {number}
 */
export function portraitPhotoIndex(i, slot) {
  return i * PORTRAIT_SLOTS + (slot - 1);
}

/** One rendered portrait circle; `photoIdx` wires the canvas media popover. */
function portraitHtml(src, alt, photoIdx) {
  return `
              <div class="quote-portrait" data-inline-photo="${photoIdx}">
                <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />
              </div>`;
}

/** An empty portrait slot, drawn on the editor canvas only, so a portrait can
 * be added in-slide via the media popover. */
function placeholderPortraitHtml(photoIdx) {
  return `
              ${imagePlaceholderHtml({ className: 'quote-portrait', index: photoIdx, compact: true })}`;
}

/** Wrap portrait parts in their container (or nothing when there are none). */
function portraitsWrap(parts) {
  return parts.length
    ? `<div class="quote-portraits">${parts.join('')}</div>`
    : '';
}

/**
 * Render the blockquote + author footer for quote `i`. Shared by the single
 * and multi layouts so both stay in sync; `morph` only tags the single layout
 * (per-slide morph roles must be unique, and the single quote is the animated
 * hero case).
 */
function quoteBlockInnerHtml(item, i, portraitsHtml, { morph = false } = {}) {
  const morphQuote = morph ? ' data-morph-role="quote-text"' : '';
  const morphAuthor = morph ? ' data-morph-role="quote-author"' : '';
  return `
            <blockquote class="quote-text"${morphQuote} dir="auto">
              <p data-inline-field="quotes.${i}.quote">${escapeHtml(curlyQuote(item?.quote))}</p>
            </blockquote>
            <footer class="quote-author${portraitsHtml ? ' has-portraits' : ''}"${morphAuthor}>
              ${portraitsHtml}
              <div>
                <div class="name" data-inline-field="quotes.${i}.authorName" dir="auto">${escapeHtml(
                  item?.authorName,
                )}</div>
                <div class="role" data-inline-field="quotes.${i}.authorTitle" dir="auto">${escapeHtml(
                  item?.authorTitle,
                )}</div>
              </div>
            </footer>`;
}

/** Portrait parts for quote `i`. In the editor (`editMode`), the first empty
 * slot renders a clickable placeholder so a portrait can be added in-slide. */
function portraitParts(item, i, editMode = false) {
  const parts = [];
  let firstEmpty = 0;
  for (let n = 1; n <= PORTRAIT_SLOTS; n++) {
    const raw = item?.[`authorImage${n}`];
    const src = typeof raw === 'string' ? raw.trim() : '';
    if (!src) {
      if (!firstEmpty) firstEmpty = n;
      continue;
    }
    const alt = pickAltText({
      explicit: item?.[`authorImage${n}Alt`],
      src,
      fallbacks: [item?.authorName],
      hardFallback: 'Portrait',
    });
    parts.push(portraitHtml(src, alt, portraitPhotoIndex(i, n)));
  }
  if (editMode && firstEmpty) {
    parts.push(placeholderPortraitHtml(portraitPhotoIndex(i, firstEmpty)));
  }
  return parts;
}

/**
 * Font scale for the quote text, chosen from how much content there is so short
 * quotes stay large and long ones shrink to fit - within a per-count bandwidth.
 * A single hero quote barely shrinks (default is fine; it only gives a little
 * when a long quote would overflow); 2-3 stacked quotes start smaller but grow
 * back toward the top of their band when the quotes are short one-liners. The
 * SAME scale is applied to every quote on the slide, so they stay uniform.
 *
 * @param {number} count 1-3 rendered quotes
 * @param {string[]} quoteTexts the quote strings on the slide
 * @returns {number} multiplier for --slide-font-size-title
 */
export function quoteFontScale(count, quoteTexts) {
  // [min, max] multiplier per quote count. min = the dense/long-content size
  // (the old fixed sizes: 1 / 0.6 / 0.46); max = the roomy/short-content size.
  const bands = { 1: [0.78, 1], 2: [0.6, 0.82], 3: [0.46, 0.62] };
  const [min, max] = bands[count] || bands[3];
  const lengths = quoteTexts.map((q) =>
    typeof q === 'string' ? q.trim().length : 0,
  );
  const avg = lengths.length
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 0;
  // Ramp on average chars-per-quote: at/below LO use the largest size, at/above
  // HI use the smallest, linear in between.
  const LO = 70;
  const HI = 240;
  const t = Math.max(0, Math.min(1, (avg - LO) / (HI - LO)));
  const scale = max - (max - min) * t;
  return Math.round(scale * 1000) / 1000;
}

/**
 * The quotes the slide shows, with their index into `quotes[]`: the first
 * always (it is the slide's quote, even while empty), the others only once
 * they hold quote text, up to three.
 * @param {Object} content
 * @returns {Array<{item: Object, i: number}>}
 */
export function displayQuotes(content) {
  const arr = Array.isArray(content?.quotes) ? content.quotes : [];
  return arr
    .slice(0, MAX_QUOTES)
    .map((item, i) => ({
      item: item && typeof item === 'object' ? item : {},
      i,
    }))
    .filter(
      ({ item, i }) =>
        i === 0 || (typeof item.quote === 'string' && item.quote.trim()),
    );
}

export default {
  structure: 'singleton',
  runtime: 'static',
  fidelity: { pptx: 'native' },
  label: 'Quote',
  labelField: 'quotes',
  fieldGroups: [QUOTE_BLOCK.group],
  layoutVariants: QUOTE_BLOCK.variants,
  fields: [
    QUOTE_BLOCK.field,
    // One to three quotes. A second or third stacks the quotes in an
    // alternating-alignment layout; each carries its own byline and up to two
    // optional portraits (a duo shares one quote).
    {
      key: 'quotes',
      // A quote slide without its quote is empty quotation marks. Essential
      // on a list means its first entry (D211): the first quote's text asks
      // for itself in-box, its `itemLabelField`.
      essential: true,
      label: 'Quotes',
      type: 'items',
      required: true,
      minItems: 1,
      maxItems: MAX_QUOTES,
      itemLabelField: 'quote',
      // Seeded with placeholder copy so a quote added on the canvas renders
      // and is click-to-edit immediately - a quote past the first without
      // text is not shown. The user replaces the placeholders, or removes the
      // quote with its × badge.
      itemDefaults: {
        quote: 'A strong quote goes here.',
        authorName: 'Name Surname',
        authorTitle: 'Role / title',
        authorImage1: '',
        authorImage1Alt: '',
        authorImage2: '',
        authorImage2Alt: '',
      },
      itemDefaultsByLang: {
        nl: {
          quote: 'Een sterke quote komt hier.',
          authorName: 'Voornaam Achternaam',
          authorTitle: 'Functie / titel',
          authorImage1: '',
          authorImage1Alt: '',
          authorImage2: '',
          authorImage2Alt: '',
        },
      },
      itemFields: [
        {
          key: 'quote',
          label: 'Quote',
          type: 'string',
          required: true,
          maxLength: 400,
          // Alignment belongs to the quote-block group, which moves quote,
          // byline and portraits together; `role` still governs colour/size
          // affordances.
          role: 'quote',
          group: 'quote-block',
        },
        {
          key: 'authorName',
          label: 'Name',
          type: 'string',
          required: true,
          maxLength: 80,
          role: 'attribution',
          group: 'quote-block',
        },
        {
          key: 'authorTitle',
          label: 'Role / title',
          type: 'string',
          required: false,
          maxLength: 120,
          role: 'attribution',
          group: 'quote-block',
        },
        {
          key: 'authorImage1',
          label: 'Portrait photo 1 (optional)',
          type: 'image',
          nameKey: 'authorName',
          required: false,
        },
        {
          key: 'authorImage1Alt',
          label: 'Portrait 1 alt text (optional)',
          type: 'string',
          required: false,
          maxLength: 180,
        },
        {
          key: 'authorImage2',
          label: 'Portrait photo 2 (optional)',
          type: 'image',
          nameKey: 'authorName',
          required: false,
        },
        {
          key: 'authorImage2Alt',
          label: 'Portrait 2 alt text (optional)',
          type: 'string',
          required: false,
          maxLength: 180,
        },
      ],
    },
  ],
  // Defaults are language-aware (editor chooses based on current language mode).
  defaultsByLang: {
    nl: {
      quoteAlign: 'left',
      quotes: [
        {
          quote: 'Een sterke quote komt hier.',
          authorName: 'Voornaam Achternaam',
          authorTitle: 'Functie / titel',
          authorImage1: '',
          authorImage1Alt: '',
          authorImage2: '',
          authorImage2Alt: '',
        },
      ],
    },
    'en-GB': {
      quoteAlign: 'left',
      quotes: [
        {
          quote: 'A strong quote goes here.',
          authorName: 'Name Surname',
          authorTitle: 'Function / title',
          authorImage1: '',
          authorImage1Alt: '',
          authorImage2: '',
          authorImage2Alt: '',
        },
      ],
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    quoteAlign: 'left',
    quotes: [
      {
        quote: 'A strong quote goes here.',
        authorName: 'Name Surname',
        authorTitle: 'Role / title',
        authorImage1: '',
        authorImage1Alt: '',
        authorImage2: '',
        authorImage2Alt: '',
      },
    ],
  },
  renderHtml: (content, slide, ctx) => {
    const editMode = ctx?.mode === 'edit';
    const vars = gradientVarsForSlide(slide?.id, 'quote');
    const quotes = displayQuotes(content);

    // A single quote keeps the hero layout. The font scale only dips below 1
    // for long quotes, so short/typical quotes still render at the default
    // hero size.
    if (quotes.length === 1) {
      const [{ item, i }] = quotes;
      const styleVars = {
        ...(vars || {}),
        '--quote-scale': quoteFontScale(1, [item.quote]),
      };
      // Centre the WHOLE block - quote, byline and portraits - in the slide,
      // not just the text within a left-hung column. Driven by the quote-block
      // group (Layout chip); `quoteAlign` is the only stored form.
      const groupClass = groupAlignClass(QUOTE_BLOCK.group, content);
      const alignClass = groupClass ? ` ${groupClass}` : '';
      const inner = quoteBlockInnerHtml(
        item,
        i,
        portraitsWrap(portraitParts(item, i, editMode)),
        { morph: true },
      );
      return `
        <div class="slide slide-quote${alignClass}"${styleAttrFromVars(styleVars)}>
          <div class="slide-inner">${inner}
          </div>
        </div>
      `;
    }

    // Several quotes stacked, alignment alternating L / R / L via
    // :nth-child CSS. Font scales down with the count (data-quote-count).
    // Each item carries its index into quotes[] for the editor's card
    // affordances (remove ×, reorder).
    const count = quotes.length;
    const itemsHtml = quotes
      .map(({ item, i }) => {
        const inner = quoteBlockInnerHtml(
          item,
          i,
          portraitsWrap(portraitParts(item, i, editMode)),
        );
        return `<div class="quote-item" data-inline-item="quotes" data-inline-item-index="${i}">${inner}\n            </div>`;
      })
      .join('\n            ');

    const styleVars = {
      ...(vars || {}),
      '--quote-scale': quoteFontScale(
        count,
        quotes.map(({ item }) => item.quote),
      ),
    };

    return `
        <div class="slide slide-quote is-multi" data-quote-count="${count}"${styleAttrFromVars(
          styleVars,
        )}>
          <div class="slide-inner">
            ${itemsHtml}
          </div>
        </div>
      `;
  },
};
