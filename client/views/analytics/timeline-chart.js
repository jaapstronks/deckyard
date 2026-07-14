/**
 * Timeline chart showing views over time (inline SVG).
 */

import { t } from '../../lib/ui-i18n.js';
import { formatDate } from '../../lib/analytics-format.js';

/**
 * Format date for chart display (short format: M/D).
 * @param {string} dateStr - ISO date string
 * @returns {string}
 */
function formatDateShort(dateStr) {
  return formatDate(dateStr, { short: true });
}

const CHART_WIDTH = 800;
const CHART_HEIGHT = 200;
const PADDING = { top: 20, right: 20, bottom: 40, left: 50 };

/**
 * Create a timeline chart component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Array} options.data - Array of {date, views} objects
 * @returns {Object} Chart API with el and update method
 */
export function createTimelineChart({ h, data }) {
  const el = h('div', { class: 'analytics-section analytics-timeline' });

  const header = h('div', { class: 'analytics-section-header' }, [
    h('h3', { text: t('analytics.viewsOverTime', 'Views Over Time') }),
  ]);

  const chartContainer = h('div', { class: 'analytics-timeline-chart' });

  el.append(header, chartContainer);

  renderChart(data);

  function renderChart(chartData) {
    chartContainer.innerHTML = '';

    if (!chartData || chartData.length === 0) {
      chartContainer.append(
        h('div', { class: 'analytics-empty-state' }, [
          h('img', { class: 'analytics-empty-state-icon', src: '/client/vendor/lucide-icons/chart-column.svg', alt: '', 'aria-hidden': 'true' }),
          h('p', { class: 'analytics-empty-state-title', text: t('analytics.noViewsYet', 'No views yet') }),
          h('p', { class: 'analytics-empty-state-description', text: t('analytics.shareToGetViews', 'Share your presentation to start seeing view analytics here.') }),
        ])
      );
      return;
    }

    // Calculate dimensions
    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

    // Get data bounds
    const maxViews = Math.max(...chartData.map((d) => d.views), 1);

    // Create SVG with accessibility attributes
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
    svg.setAttribute('class', 'analytics-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('analytics.chartAriaLabel', 'Bar chart showing views over time'));

    // Add description for screen readers
    const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
    const totalViews = chartData.reduce((sum, d) => sum + d.views, 0);
    desc.textContent = t('analytics.chartDescription', 'Chart showing {{count}} data points with {{total}} total views', {
      count: chartData.length,
      total: totalViews,
    });
    svg.appendChild(desc);

    // Create group for chart content
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${PADDING.left}, ${PADDING.top})`);

    // Draw Y-axis gridlines
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = innerHeight - (i / yTicks) * innerHeight;
      const value = Math.round((i / yTicks) * maxViews);

      // Gridline
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(innerWidth));
      line.setAttribute('y2', String(y));
      line.setAttribute('class', 'analytics-chart-grid');
      g.appendChild(line);

      // Y-axis label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '-8');
      text.setAttribute('y', String(y + 4));
      text.setAttribute('class', 'analytics-chart-label analytics-chart-label-y');
      text.textContent = String(value);
      g.appendChild(text);
    }

    // Calculate bar width
    const barWidth = Math.max(1, Math.min(20, (innerWidth / chartData.length) - 2));
    const barGap = (innerWidth - (barWidth * chartData.length)) / (chartData.length + 1);

    // Draw bars
    chartData.forEach((d, i) => {
      const barHeight = (d.views / maxViews) * innerHeight;
      const x = barGap + i * (barWidth + barGap);
      const y = innerHeight - barHeight;

      // Bar with accessibility
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('class', 'analytics-chart-bar');
      rect.setAttribute('data-views', String(d.views));
      rect.setAttribute('data-date', d.date);
      rect.setAttribute('role', 'graphics-symbol');
      rect.setAttribute('aria-label', t('analytics.barAriaLabel', '{{date}}: {{views}} views', {
        date: formatDateShort(d.date),
        views: d.views,
      }));

      // Tooltip on hover
      rect.addEventListener('mouseenter', (e) => {
        showTooltip(e, d);
      });
      rect.addEventListener('mouseleave', hideTooltip);

      g.appendChild(rect);

      // X-axis label (show every nth label to avoid overlap)
      const showLabel = chartData.length <= 15 || i % Math.ceil(chartData.length / 10) === 0;
      if (showLabel) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x + barWidth / 2));
        text.setAttribute('y', String(innerHeight + 20));
        text.setAttribute('class', 'analytics-chart-label analytics-chart-label-x');
        text.textContent = formatDateShort(d.date);
        g.appendChild(text);
      }
    });

    svg.appendChild(g);
    chartContainer.append(svg);

    // Add tooltip element
    const tooltip = h('div', { class: 'analytics-chart-tooltip', style: 'display: none;' });
    chartContainer.append(tooltip);

    function showTooltip(e, d) {
      const rect = e.target.getBoundingClientRect();
      const containerRect = chartContainer.getBoundingClientRect();
      tooltip.textContent = `${formatDateShort(d.date)}: ${d.views} ${t('analytics.views', 'views')}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${rect.left - containerRect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - containerRect.top - 30}px`;
    }

    function hideTooltip() {
      tooltip.style.display = 'none';
    }
  }

  function update(newData) {
    renderChart(newData);
  }

  return { el, update };
}