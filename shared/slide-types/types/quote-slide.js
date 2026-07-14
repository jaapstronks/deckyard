import {
  curlyQuote,
  esc,
  gradientVarsForSlide,
  styleAttrFromVars,
} from '../helpers.js';

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
  ],
  // Defaults are language-aware (editor chooses based on current language mode).
  defaultsByLang: {
    nl: {
      quote: 'Een sterke quote komt hier.',
      authorName: 'Voornaam Achternaam',
      authorTitle: 'Functie / titel',
    },
    'en-GB': {
      quote: 'A strong quote goes here.',
      authorName: 'Name Surname',
      authorTitle: 'Function / title',
    },
  },
  // Back-compat fallback (used when language is unknown).
  defaults: {
    quote: 'A strong quote goes here.',
    authorName: 'Name Surname',
    authorTitle: 'Role / title',
  },
  renderHtml: (content, slide) => {
    const vars = gradientVarsForSlide(slide?.id, 'quote');
    return `
        <div class="slide slide-quote"${styleAttrFromVars(
          vars
        )}>
          <div class="slide-inner">
            <blockquote class="quote-text" data-morph-role="quote-text" dir="auto">
              <p data-inline-field="quote">${esc(curlyQuote(content?.quote))}</p>
            </blockquote>
            <footer class="quote-author" data-morph-role="quote-author">
              <div class="name" data-inline-field="authorName" dir="auto">${esc(
                content?.authorName
              )}</div>
              <div class="role" data-inline-field="authorTitle" dir="auto">${esc(
                content?.authorTitle
              )}</div>
            </footer>
          </div>
        </div>
      `;
  },
};