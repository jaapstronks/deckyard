/**
 * Version Comparison Modal
 * Side-by-side diff view showing changes between current version and a snapshot
 */

import { createPromiseModal } from '../../../lib/dom/modal.js';
import { renderSlideElement } from '../../../lib/slide-runtime/slide-render.js';
import { computeSlideDiff, alignSlidesForComparison, getCategoryStyle } from '../../../lib/slide-authoring/slide-diff.js';
import { fmtDate } from '../../../lib/format/format.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Opens a modal comparing current presentation with a snapshot version.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element for modal
 * @param {Function} options.api - API function
 * @param {string} options.presentationId - Presentation ID
 * @param {Object} options.currentPres - Current presentation data
 * @param {Object} options.version - Version metadata to compare against
 * @param {Object} options.theme - Theme for rendering
 * @param {Set} options.openOverlayClosers - Overlay closers set
 * @returns {Promise} Modal promise
 */
export function openVersionCompareModal({
  h,
  root,
  api,
  presentationId,
  currentPres,
  version,
  theme,
  openOverlayClosers,
} = {}) {
  const versionDate = fmtDate(version?.created);
  const versionLabel = version?.label || '';

  const modal = createPromiseModal(h, {
    title: t('editor.versions.compare.title', 'Compare versions'),
    modalClass: 'modal-wide modal-compare',
    closeOnBackdrop: true,
  });

  const status = h('div', { class: 'help modal-status', text: t('common.loading', 'Loading…') });

  // Summary section
  const summary = h('div', { class: 'version-compare-summary' });

  // Legend
  const legend = h('div', { class: 'version-compare-legend' }, [
    h('span', { class: 'legend-item diff-added', text: '🟢 ' + t('editor.versions.compare.added', 'Added') }),
    h('span', { class: 'legend-item diff-removed', text: '🔴 ' + t('editor.versions.compare.removed', 'Removed') }),
    h('span', { class: 'legend-item diff-modified', text: '🟡 ' + t('editor.versions.compare.modified', 'Modified') }),
    h('span', { class: 'legend-item diff-unchanged', text: '⚪ ' + t('editor.versions.compare.unchanged', 'Unchanged') }),
  ]);

  // Headers for columns (3 columns to match grid: current | indicator | snapshot)
  const snapshotHeaderText = versionLabel || t('editor.versions.compare.snapshot', 'Snapshot ({date})', { date: versionDate });
  const headers = h('div', { class: 'version-compare-headers' }, [
    h('div', { class: 'compare-header compare-header-current', text: t('editor.versions.compare.current', 'Current') }),
    h('div', { class: 'compare-header-spacer' }), // Empty middle cell for indicator column
    h('div', {
      class: 'compare-header compare-header-snapshot',
      text: snapshotHeaderText,
      title: snapshotHeaderText, // Show full text on hover
    }),
  ]);

  // AI analysis button (insights will be shown inline with rows)
  const aiSection = h('div', { class: 'version-compare-ai' });
  const aiButton = h('button', {
    class: 'btn btn-secondary btn-sm',
    text: t('editor.versions.compare.analyzeAi', 'Analyze with AI'),
    onclick: analyzeWithAi,
  });
  const aiStatus = h('span', { class: 'version-compare-ai-status' });
  aiSection.append(aiButton, aiStatus);

  // Comparison grid
  const grid = h('div', { class: 'version-compare-grid' });

  // Map to store insight containers by slide ID for inline display
  const insightContainers = new Map();

  modal.content.append(status, summary, aiSection, legend, headers, grid);
  modal.show(root, openOverlayClosers);

  // AI analysis handler - populates insights inline with each row
  async function analyzeWithAi() {
    aiButton.disabled = true;
    aiButton.textContent = t('editor.versions.compare.analyzing', 'Analyzing…');
    aiStatus.textContent = '';

    try {
      const result = await api(
        `/api/presentations/${presentationId}/versions/${version.id}/compare-ai`,
        { method: 'POST' }
      );

      if (result?.ok && Array.isArray(result.insights)) {
        // Clear any existing insights
        for (const container of insightContainers.values()) {
          container.innerHTML = '';
          container.style.display = 'none';
        }

        // Populate insights into the appropriate rows
        let insightCount = 0;
        for (const insight of result.insights) {
          const container = insightContainers.get(insight.slideId);
          if (container) {
            container.style.display = 'block';
            container.textContent = insight.comment;
            insightCount++;
          }
        }

        if (insightCount > 0) {
          aiStatus.textContent = t('editor.versions.compare.insightsAdded', '{count} insights added', { count: insightCount });
          aiButton.style.display = 'none';
        } else {
          aiStatus.textContent = t('editor.versions.compare.noInsights', 'No additional insights.');
          aiButton.style.display = 'none';
        }
      } else {
        aiStatus.textContent = result?.error || t('editor.versions.compare.aiFailed', 'AI analysis failed.');
        aiButton.textContent = t('editor.versions.compare.analyzeAi', 'Analyze with AI');
        aiButton.disabled = false;
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('503') || msg.includes('not available')) {
        // AI not configured - hide the section entirely
        aiSection.style.display = 'none';
      } else {
        aiStatus.textContent = msg;
        aiButton.textContent = t('editor.versions.compare.analyzeAi', 'Analyze with AI');
        aiButton.disabled = false;
      }
    }
  }

  // Load and compare
  loadAndCompare();

  async function loadAndCompare() {
    try {
      const versionData = await api(
        `/api/presentations/${presentationId}/versions/${version.id}`
      );
      const snapshotSlides = versionData?.presentation?.slides || [];
      const currentSlides = currentPres?.slides || [];

      // Compute diff
      const diff = computeSlideDiff(currentSlides, snapshotSlides);

      // Update summary
      summary.innerHTML = '';
      summary.append(
        h('div', { class: 'summary-stat' }, [
          h('span', { class: 'summary-label', text: t('editor.versions.compare.currentSlides', 'Current:') }),
          h('span', { class: 'summary-value', text: String(diff.summary.currentTotal) }),
        ]),
        h('div', { class: 'summary-stat' }, [
          h('span', { class: 'summary-label', text: t('editor.versions.compare.snapshotSlides', 'Snapshot:') }),
          h('span', { class: 'summary-value', text: String(diff.summary.snapshotTotal) }),
        ]),
        h('div', { class: 'summary-stat diff-added' }, [
          h('span', { class: 'summary-value', text: `+${diff.summary.addedCount}` }),
        ]),
        h('div', { class: 'summary-stat diff-removed' }, [
          h('span', { class: 'summary-value', text: `-${diff.summary.removedCount}` }),
        ]),
        h('div', { class: 'summary-stat diff-modified' }, [
          h('span', { class: 'summary-value', text: `~${diff.summary.modifiedCount}` }),
        ])
      );

      // Status
      if (diff.summary.addedCount === 0 && diff.summary.removedCount === 0 && diff.summary.modifiedCount === 0) {
        status.textContent = t('editor.versions.compare.identical', 'Versions are identical.');
      } else {
        status.textContent = '';
      }

      // Align slides for comparison
      const aligned = alignSlidesForComparison(currentSlides, snapshotSlides, diff);

      // Helper to show enlarged slide preview
      function showEnlargedSlide(slide, label) {
        const overlay = h('div', { class: 'compare-lightbox' });
        const closeBtn = h('button', {
          class: 'compare-lightbox-close',
          text: '×',
          onclick: () => overlay.remove(),
        });
        const labelEl = h('div', { class: 'compare-lightbox-label', text: label });
        const content = h('div', { class: 'compare-lightbox-content' });
        try {
          const slideEl = renderSlideElement(slide, {
            mode: 'thumb',
            theme,
            presentationId,
          });
          content.append(slideEl);
        } catch {
          content.textContent = t('editor.versions.compare.renderFailed', 'Could not render slide');
        }
        overlay.append(closeBtn, labelEl, content);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.remove();
        });
        document.body.append(overlay);
      }

      // Render comparison rows
      for (let i = 0; i < aligned.length; i++) {
        const { current, snapshot, category } = aligned[i];
        const style = getCategoryStyle(category);

        const row = h('div', { class: `version-compare-row ${style.className}` });

        // Current side
        const currentCell = h('div', { class: 'compare-cell compare-cell-current' });
        if (current) {
          const thumb = h('div', {
            class: 'compare-thumb compare-thumb-clickable',
            title: t('editor.versions.compare.clickToEnlarge', 'Click to enlarge'),
            onclick: () => showEnlargedSlide(
              current,
              t('editor.versions.compare.sideSlideLabel', '{side} - Slide {n}', {
                side: t('editor.versions.compare.current', 'Current'),
                n: i + 1,
              })
            ),
          });
          try {
            const slideEl = renderSlideElement(current, {
              mode: 'thumb',
              theme,
              presentationId,
            });
            thumb.append(slideEl);
          } catch {
            thumb.textContent = '?';
          }
          currentCell.append(thumb);
        } else {
          currentCell.append(h('div', { class: 'compare-empty', text: '—' }));
        }

        // Category indicator
        const indicator = h('div', {
          class: 'compare-indicator',
          text: style.indicator,
          title: style.label,
        });

        // Snapshot side
        const snapshotCell = h('div', { class: 'compare-cell compare-cell-snapshot' });
        if (snapshot) {
          const thumb = h('div', {
            class: 'compare-thumb compare-thumb-clickable',
            title: t('editor.versions.compare.clickToEnlarge', 'Click to enlarge'),
            onclick: () => showEnlargedSlide(
              snapshot,
              t('editor.versions.compare.sideSlideLabel', '{side} - Slide {n}', {
                side: snapshotHeaderText,
                n: i + 1,
              })
            ),
          });
          try {
            const slideEl = renderSlideElement(snapshot, {
              mode: 'thumb',
              theme,
              presentationId,
            });
            thumb.append(slideEl);
          } catch {
            thumb.textContent = '?';
          }
          snapshotCell.append(thumb);
        } else {
          snapshotCell.append(h('div', { class: 'compare-empty', text: '—' }));
        }

        row.append(currentCell, indicator, snapshotCell);

        // Add insight container for this row (only for changed slides)
        if (category !== 'unchanged') {
          const slideId = current?.id || snapshot?.id;
          if (slideId) {
            const insightRow = h('div', {
              class: 'version-compare-insight',
              style: 'display: none;', // Hidden until AI populates it
            });
            insightContainers.set(slideId, insightRow);
            grid.append(row, insightRow);
          } else {
            grid.append(row);
          }
        } else {
          grid.append(row);
        }
      }
    } catch (e) {
      status.textContent = String(e?.message || e);
    }
  }

  return modal.promise;
}
