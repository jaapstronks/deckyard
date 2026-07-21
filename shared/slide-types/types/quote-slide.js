import {
  curlyQuote,
  esc,
  gradientVarsForSlide,
  pickAltText,
  styleAttrFromVars,
  imagePlaceholderHtml,
} from '../helpers.js';

// Portraits on the primary (legacy) quote: two slots so a shared quote (a duo)
// can show both people. Extra quotes carry a single optional portrait each.
const MAX_PORTRAITS = 2;
// Extra quotes stacked under the primary one (quotes 2 and 3). The primary
// quote stays in the flat top-level fields, so existing single-quote decks are
// byte-for-byte unchanged and their duo portraits are preserved.
const MAX_EXTRA_QUOTES = 2;

/** One rendered portrait circle. `inlineIdx` wires the media popover (primary
 * quote only); extra quotes omit it and are edited via the side form. */
function portraitHtml(src, alt, inlineIdx) {
  const idxAttr = inlineIdx != null ? ` data-inline-photo="${inlineIdx}"` : '';
  return `
              <div class="quote-portrait"${idxAttr}>
                <img src="${esc(src)}" alt="${esc(alt)}" />
              </div>`;
}

/** An empty portrait slot rendered on the editor canvas only, so a FIRST
 * portrait can be added in-slide via the media popover (flat authorImage{n}).
 * `inlineIdx` is the 1-based slot number. */
function placeholderPortraitHtml(inlineIdx) {
  return `
              ${imagePlaceholderHtml({ className: 'quote-portrait', index: inlineIdx, compact: true })}`;
}

/** Wrap portrait parts in their container (or nothing when there are none). */
function portraitsWrap(parts) {
  return parts.length
    ? `<div class="quote-portraits">${parts.join('')}</div>`
    : '';
}

/**
 * Render the blockquote + author footer for one quote. Shared by the single
 * and multi layouts so both stay in sync; `morph` only tags the single layout
 * (per-slide morph roles must be unique, and the single quote is the animated
 * hero case).
 */
function quoteBlockInnerHtml({
  quote,
  authorName,
  authorTitle,
  portraitsHtml,
  quoteField,
  nameField,
  titleField,
  morph = false,
}) {
  const morphQuote = morph ? ' data-morph-role="quote-text"' : '';
  const morphAuthor = morph ? ' data-morph-role="quote-author"' : '';
  return `
            <blockquote class="quote-text"${morphQuote} dir="auto">
              <p data-inline-field="${quoteField}">${esc(curlyQuote(quote))}</p>
            </blockquote>
            <footer class="quote-author${portraitsHtml ? ' has-portraits' : ''}"${morphAuthor}>
              ${portraitsHtml}
              <div class="quote-author-text">
                <div class="name" data-inline-field="${nameField}" dir="auto">${esc(
                  authorName
                )}</div>
                <div class="role" data-inline-field="${titleField}" dir="auto">${esc(
                  authorTitle
                )}</div>
              </div>
            </footer>`;
}

/** Portrait parts for the primary quote, from the flat authorImage1/2 slots.
 * In the editor (`editMode`), the next empty slot renders a clickable
 * placeholder so a first portrait can be added in-slide. */
function primaryPortraitParts(content, editMode = false) {
  const parts = [];
  let firstEmpty = 0;
  for (let n = 1; n <= MAX_PORTRAITS; n++) {
    const src =
      typeof content?.[`authorImage${n}`] === 'string'
        ? content[`authorImage${n}`].trim()
        : '';
    if (!src) {
      if (!firstEmpty) firstEmpty = n;
      continue;
    }
    const alt = pickAltText({
      explicit: content?.[`authorImage${n}Alt`],
      src,
      fallbacks: [content?.authorName],
      hardFallback: 'Portrait',
    });
    parts.push(portraitHtml(src, alt, n));
  }
  if (editMode && firstEmpty) {
    parts.push(placeholderPortraitHtml(firstEmpty));
  }
  return parts;
}

/** Portrait parts for an extra quote (single optional portrait, no inline idx). */
function extraPortraitParts(item) {
  const src =
    typeof item?.authorImage === 'string' ? item.authorImage.trim() : '';
  if (!src) return [];
  const alt = pickAltText({
    explicit: item?.authorImageAlt,
    src,
    fallbacks: [item?.authorName],
    hardFallback: 'Portrait',
  });
  return [portraitHtml(src, alt, null)];
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
 * @returns {number} multiplier for --font-size-title
 */
export function quoteFontScale(count, quoteTexts) {
  // [min, max] multiplier per quote count. min = the dense/long-content size
  // (the old fixed sizes: 1 / 0.6 / 0.46); max = the roomy/short-content size.
  const bands = { 1: [0.78, 1], 2: [0.6, 0.82], 3: [0.46, 0.62] };
  const [min, max] = bands[count] || bands[3];
  const lengths = quoteTexts.map((q) =>
    typeof q === 'string' ? q.trim().length : 0
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

/** Extra quotes worth rendering: those with actual quote text. */
function activeExtraQuotes(content) {
  const arr = Array.isArray(content?.quotes) ? content.quotes : [];
  return arr
    .slice(0, MAX_EXTRA_QUOTES)
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => typeof item?.quote === 'string' && item.quote.trim());
}

export default {
  label: 'Quote',
  fields: [
    {
      key: 'quote',
      label: 'Quote',
      type: 'string',
      required: true,
      maxLength: 400,
    },
    {
      key: 'authorName',
      label: 'Name',
      type: 'string',
      required: true,
      maxLength: 80,
    },
    {
      key: 'authorTitle',
      label: 'Role / title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    // Optional round portrait photos, shown next to the name/byline. Two
    // slots so a shared quote (e.g. a duo) can show both people.
    {
      key: 'authorImage1',
      label: 'Portrait photo 1 (optional)',
      type: 'image',
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
      required: false,
    },
    {
      key: 'authorImage2Alt',
      label: 'Portrait 2 alt text (optional)',
      type: 'string',
      required: false,
      maxLength: 180,
    },
    // Optional extra quotes (2 and 3). When present, the slide switches to a
    // stacked, alternating-alignment layout. Each carries its own attribution
    // and a single optional portrait. Kept separate from the primary quote so
    // existing single-quote decks (incl. duos with two portraits) are untouched.
    {
      key: 'quotes',
      label: 'Extra quotes (optional, max 2)',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: MAX_EXTRA_QUOTES,
      // Seeded with placeholder copy (like the primary quote's defaults) so a
      // quote added on the canvas renders and is click-to-edit immediately -
      // an empty quote is filtered out by activeExtraQuotes and would appear to
      // do nothing. The user replaces the placeholders, or removes the quote
      // with its × badge.
      itemDefaults: {
        quote: 'A strong quote goes here.',
        authorName: 'Name Surname',
        authorTitle: 'Role / title',
        authorImage: '',
        authorImageAlt: '',
      },
      itemFields: [
        {
          key: 'quote',
          label: 'Quote',
          type: 'string',
          required: true,
          maxLength: 400,
        },
        {
          key: 'authorName',
          label: 'Name',
          type: 'string',
          required: false,
          maxLength: 80,
        },
        {
          key: 'authorTitle',
          label: 'Role / title',
          type: 'string',
          required: false,
          maxLength: 120,
        },
        {
          key: 'authorImage',
          label: 'Portrait photo (optional)',
          type: 'image',
          required: false,
        },
        {
          key: 'authorImageAlt',
          label: 'Portrait alt text (optional)',
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
      quote: 'Een sterke quote komt hier.',
      authorName: 'Voornaam Achternaam',
      authorTitle: 'Functie / titel',
      authorImage1: '',
      authorImage1Alt: '',
      authorImage2: '',
      authorImage2Alt: '',
      quotes: [],
    },
    'en-GB': {
      quote: 'A strong quote goes here.',
      authorName: 'Name Surname',
      authorTitle: 'Function / title',
      authorImage1: '',
      authorImage1Alt: '',
      authorImage2: '',
      authorImage2Alt: '',
      quotes: [],
    },
  },
  // Back-compat fallback (used when language is unknown).
  defaults: {
    quote: 'A strong quote goes here.',
    authorName: 'Name Surname',
    authorTitle: 'Role / title',
    authorImage1: '',
    authorImage1Alt: '',
    authorImage2: '',
    authorImage2Alt: '',
    quotes: [],
  },
  renderHtml: (content, slide, ctx) => {
    const editMode = ctx?.mode === 'edit';
    const vars = gradientVarsForSlide(slide?.id, 'quote');
    const extras = activeExtraQuotes(content);

    // Single-quote (the common, legacy case): keep the hero layout. The font
    // scale only dips below 1 for long quotes, so short/typical quotes still
    // render at the default hero size.
    if (!extras.length) {
      const styleVars = {
        ...(vars || {}),
        '--quote-scale': quoteFontScale(1, [content?.quote]),
      };
      const portraitsHtml = portraitsWrap(primaryPortraitParts(content, editMode));
      const inner = quoteBlockInnerHtml({
        quote: content?.quote,
        authorName: content?.authorName,
        authorTitle: content?.authorTitle,
        portraitsHtml,
        quoteField: 'quote',
        nameField: 'authorName',
        titleField: 'authorTitle',
        morph: true,
      });
      return `
        <div class="slide slide-quote"${styleAttrFromVars(styleVars)}>
          <div class="slide-inner">${inner}
          </div>
        </div>
      `;
    }

    // Multi-quote: primary + extras stacked, alignment alternating L / R / L
    // via :nth-child CSS. Font scales down with the count (data-quote-count).
    // `inlineIdx` is the item's index into quotes[] for the editor's card
    // affordances (remove ×); the primary quote lives in the flat top-level
    // fields, so it carries no index and gets no remove badge.
    const items = [];
    items.push({
      inner: quoteBlockInnerHtml({
        quote: content?.quote,
        authorName: content?.authorName,
        authorTitle: content?.authorTitle,
        portraitsHtml: portraitsWrap(primaryPortraitParts(content, editMode)),
        quoteField: 'quote',
        nameField: 'authorName',
        titleField: 'authorTitle',
      }),
      inlineIdx: null,
    });
    for (const { item, i } of extras) {
      items.push({
        inner: quoteBlockInnerHtml({
          quote: item?.quote,
          authorName: item?.authorName,
          authorTitle: item?.authorTitle,
          portraitsHtml: portraitsWrap(extraPortraitParts(item)),
          quoteField: `quotes.${i}.quote`,
          nameField: `quotes.${i}.authorName`,
          titleField: `quotes.${i}.authorTitle`,
        }),
        inlineIdx: i,
      });
    }

    const count = items.length;
    const itemsHtml = items
      .map(({ inner, inlineIdx }) => {
        const idxAttr =
          inlineIdx != null
            ? ` data-inline-item="quotes" data-inline-item-index="${inlineIdx}"`
            : '';
        return `<div class="quote-item"${idxAttr}>${inner}\n            </div>`;
      })
      .join('\n            ');

    const styleVars = {
      ...(vars || {}),
      '--quote-scale': quoteFontScale(
        count,
        [content?.quote, ...extras.map(({ item }) => item?.quote)]
      ),
    };

    return `
        <div class="slide slide-quote is-multi" data-quote-count="${count}"${styleAttrFromVars(
          styleVars
        )}>
          <div class="slide-inner">
            ${itemsHtml}
          </div>
        </div>
      `;
  },
};
