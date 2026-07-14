import { esc } from '../helpers.js';

export function chartErrorHtml(errors) {
  const items = (errors || []).map((e) => `<li>${esc(e)}</li>`).join('');
  return `
    <div class="chart-error" role="note" aria-label="Chart errors">
      <div class="chart-error-title">Kan chart niet renderen</div>
      <ul class="chart-error-list">${items}</ul>
    </div>
  `;
}
