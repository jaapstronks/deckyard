import {
  curlyQuote,
  esc,
  gradientVarsForSlide,
  pickAltText,
  styleAttrFromVars,
} from '../helpers.js';

const MAX_PORTRAITS = 2;

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
    },
    'en-GB': {
      quote: 'A strong quote goes here.',
      authorName: 'Name Surname',
      authorTitle: 'Function / title',
      authorImage1: '',
      authorImage1Alt: '',
      authorImage2: '',
      authorImage2Alt: '',
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
  },
  renderHtml: (content, slide, ctx) => {
    const vars = gradientVarsForSlide(slide?.id, 'quote');

    // Portraits: render every filled slot; in the editor canvas also render
    // one empty slot (the next free one) so a first/second portrait can be
    // added from the slide (media popover via data-inline-photo).
    const portraitParts = [];
    let placeholderAdded = false;
    for (let n = 1; n <= MAX_PORTRAITS; n++) {
      const src =
        typeof content?.[`authorImage${n}`] === 'string'
          ? content[`authorImage${n}`].trim()
          : '';
      if (src) {
        const alt = pickAltText({
          explicit: content?.[`authorImage${n}Alt`],
          src,
          fallbacks: [content?.authorName],
          hardFallback: 'Portrait',
        });
        portraitParts.push(`
              <div class="quote-portrait" data-inline-photo="${n}">
                <img src="${esc(src)}" alt="${esc(alt)}" />
              </div>`);
      } else if (ctx?.mode === 'edit' && !placeholderAdded) {
        // Editor canvas only: portraits are optional, so nothing ships to
        // present/export - but an empty slot must be clickable to add one.
        portraitParts.push(`
              <div class="quote-portrait quote-portrait-placeholder is-empty" data-inline-photo="${n}" aria-hidden="true"></div>`);
        placeholderAdded = true;
      }
    }
    const portraitsHtml = portraitParts.length
      ? `<div class="quote-portraits">${portraitParts.join('')}</div>`
      : '';

    return `
        <div class="slide slide-quote"${styleAttrFromVars(
          vars
        )}>
          <div class="slide-inner">
            <blockquote class="quote-text" data-morph-role="quote-text" dir="auto">
              <p data-inline-field="quote">${esc(curlyQuote(content?.quote))}</p>
            </blockquote>
            <footer class="quote-author${portraitsHtml ? ' has-portraits' : ''}" data-morph-role="quote-author">
              ${portraitsHtml}
              <div class="quote-author-text">
                <div class="name" data-inline-field="authorName" dir="auto">${esc(
                  content?.authorName
                )}</div>
                <div class="role" data-inline-field="authorTitle" dir="auto">${esc(
                  content?.authorTitle
                )}</div>
              </div>
            </footer>
          </div>
        </div>
      `;
  },
};
