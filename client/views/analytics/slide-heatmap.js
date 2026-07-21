/**
 * Slide heatmap showing engagement per slide.
 */

import { t } from '../../lib/ui-i18n.js';
import { formatTimeShort as formatTime } from '../../lib/format/analytics-format.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Get color for engagement score (0-1).
 * Uses a blue gradient matching the --color-primary design system.
 * Note: These values are synchronized with the .analytics-heatmap-legend-gradient CSS.
 * @param {number} score - Engagement score between 0 and 1
 * @returns {string} HSL color string
 */
function getEngagementColor(score) {
  // Low engagement = light gray, high = blue (matches --color-primary hue)
  // Hue 210 is the standard blue used throughout the analytics dashboard
  const hue = 210;
  const saturation = Math.round(score * 80); // 0-80%
  const lightness = 95 - Math.round(score * 45); // 95-50%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Create slide heatmap component.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Array} options.slides - Slide engagement data
 * @param {Object} options.presentation - Presentation data
 * @returns {Object} Heatmap API with el and update method
 */
export function createSlideHeatmap({ h, slides, presentation }) {
  const el = h('div', { class: 'analytics-section analytics-heatmap' });

  const header = h('div', { class: 'analytics-section-header' }, [
    h('h3', { text: t('analytics.slideEngagement', 'Slide Engagement') }),
  ]);

  const container = h('div', { class: 'analytics-heatmap-container' });

  el.append(header, container);

  renderHeatmap(slides);

  function renderHeatmap(slideData) {
    container.innerHTML = '';

    if (!slideData || slideData.length === 0) {
      container.append(
        h('div', { class: 'analytics-empty-state' }, [
          h('img', { class: 'analytics-empty-state-icon', src: iconUrl('target'), alt: '', 'aria-hidden': 'true' }),
          h('p', { class: 'analytics-empty-state-title', text: t('analytics.noSlideEngagement', 'No slide engagement data') }),
          h('p', { class: 'analytics-empty-state-description', text: t('analytics.viewsNeededForEngagement', 'Once viewers start watching your presentation, you\'ll see which slides get the most attention.') }),
        ])
      );
      return;
    }

    // Get presentation slides for titles
    const presSlides = presentation?.slides || [];

    // Calculate max values for normalization
    const maxViews = Math.max(...slideData.map((s) => s.views || 0), 1);
    const maxTime = Math.max(...slideData.map((s) => s.avgTimeSeconds || 0), 1);

    // Create slide cards with accessibility
    const grid = h('div', {
      class: 'analytics-heatmap-grid',
      role: 'list',
      'aria-label': t('analytics.heatmapAriaLabel', 'Slide engagement heatmap showing {{count}} slides', { count: slideData.length }),
    });

    slideData.forEach((data) => {
      const slideIndex = data.slideIndex ?? 0;
      const presSlide = presSlides[slideIndex];
      const slideTitle = presSlide?.title || presSlide?.heading || `Slide ${slideIndex + 1}`;

      // Calculate engagement score
      const viewScore = (data.views || 0) / maxViews;
      const timeScore = (data.avgTimeSeconds || 0) / maxTime;
      const engagementScore = (viewScore * 0.4) + (timeScore * 0.6);

      const engagementPercent = Math.round(engagementScore * 100);
      const card = h('div', {
        class: 'analytics-heatmap-card',
        style: `background: ${getEngagementColor(engagementScore)};`,
        role: 'listitem',
        'aria-label': t('analytics.slideCardAriaLabel', 'Slide {{num}}: {{title}}, {{views}} views, {{time}} average time, {{engagement}}% engagement', {
          num: slideIndex + 1,
          title: slideTitle,
          views: data.views || 0,
          time: formatTime(data.avgTimeSeconds || 0),
          engagement: engagementPercent,
        }),
      });

      // Slide number
      const number = h('div', { class: 'analytics-heatmap-number', text: String(slideIndex + 1) });

      // Slide info
      const info = h('div', { class: 'analytics-heatmap-info' }, [
        h('div', { class: 'analytics-heatmap-title', text: slideTitle }),
        h('div', { class: 'analytics-heatmap-stats' }, [
          h('span', { text: t('analytics.heatmap.views', '{views} views', { views: data.views || 0 }) }),
          h('span', { text: ' · ' }),
          h('span', {
            text: t('analytics.heatmap.avgTime', '{time} avg', {
              time: formatTime(data.avgTimeSeconds || 0),
            }),
          }),
        ]),
      ]);

      // Engagement bar
      const barContainer = h('div', { class: 'analytics-heatmap-bar-container' });
      const bar = h('div', {
        class: 'analytics-heatmap-bar',
        style: `width: ${Math.round(engagementScore * 100)}%;`,
      });
      barContainer.append(bar);

      // Dropoff indicator if significant (guard against undefined)
      if ((data.dropoffRate ?? 0) > 0.1) {
        const dropoff = h('div', {
          class: 'analytics-heatmap-dropoff',
          text: `↓ ${Math.round(data.dropoffRate * 100)}%`,
          title: t('analytics.dropoffRate', 'Dropoff rate'),
        });
        info.append(dropoff);
      }

      card.append(number, info, barContainer);
      grid.append(card);
    });

    container.append(grid);

    // Legend
    const legend = h('div', { class: 'analytics-heatmap-legend' }, [
      h('span', { class: 'analytics-heatmap-legend-label', text: t('analytics.lowEngagement', 'Low') }),
      h('div', { class: 'analytics-heatmap-legend-gradient' }),
      h('span', { class: 'analytics-heatmap-legend-label', text: t('analytics.highEngagement', 'High') }),
    ]);
    container.append(legend);
  }

  function update(newSlides) {
    renderHeatmap(newSlides);
  }

  return { el, update };
}