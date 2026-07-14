import { esc } from '../helpers.js';

export default {
  label: 'Payoff',
  fields: [],
  defaults: {},
  renderHtml: (content, slide, ctx) => {
    const theme =
      ctx?.theme && typeof ctx.theme === 'object'
        ? ctx.theme
        : null;
    const logo = String(
      theme?.assets?.payoffLogo ||
        theme?.assets?.logo ||
        '/assets/images/logo.svg'
    );
    const alt = String(
      theme?.assets?.payoffAlt ||
        theme?.assets?.logoAlt ||
        'Logo'
    );
    return `
        <div class="slide slide-payoff slide-bg-lime">
          <div class="slide-inner">
            <img class="payoff-logo" data-morph-role="logo" src="${esc(logo)}" alt="${esc(alt)}" />
          </div>
        </div>
      `;
  },
};
