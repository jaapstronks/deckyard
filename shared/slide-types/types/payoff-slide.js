import { escapeHtml } from '../helpers.js';

export default {
  structure: 'chrome',
  // Chrome carries no authored content, so the fallback cannot be about
  // preserving fields — it is about which tier-1 slide keeps the beat this one
  // occupies in the sequence. For a payoff that is the closing slide.
  fallback: 'end-slide',
  runtime: 'static',
  label: 'Payoff',
  fields: [],
  defaults: {},
  renderHtml: (content, slide, ctx) => {
    const theme =
      ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
    const logo = String(
      theme?.assets?.payoffLogo ||
        theme?.assets?.logo ||
        '/assets/images/logo.svg',
    );
    const alt = String(
      theme?.assets?.payoffAlt || theme?.assets?.logoAlt || 'Logo',
    );
    return `
        <div class="slide slide-payoff slide-bg-lime">
          <div class="slide-inner">
            <img class="payoff-logo" data-morph-role="logo" src="${escapeHtml(logo)}" alt="${escapeHtml(alt)}" />
          </div>
        </div>
      `;
  },
};
