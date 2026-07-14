/**
 * Slide Diff Utilities
 * Computes differences between slide arrays for version comparison
 */

/**
 * Compute a content hash for a slide (used to detect modifications).
 * Uses JSON stringification of content for comparison.
 * @param {Object} slide - Slide object
 * @returns {string} Hash string
 */
function slideContentHash(slide) {
  if (!slide) return '';
  // Include type and content for comparison, exclude transient fields
  const relevant = {
    type: slide.type || '',
    content: slide.content || {},
    visibility: slide.visibility || {},
    parentId: slide.parentId || null,
  };
  return JSON.stringify(relevant);
}

/**
 * Compute the diff between two slide arrays.
 * @param {Array} currentSlides - Current presentation slides
 * @param {Array} snapshotSlides - Snapshot slides to compare against
 * @returns {Object} Diff result with categorized slides
 */
export function computeSlideDiff(currentSlides, snapshotSlides) {
  const current = Array.isArray(currentSlides) ? currentSlides : [];
  const snapshot = Array.isArray(snapshotSlides) ? snapshotSlides : [];

  // Build lookup maps by slide ID
  const currentById = new Map(current.map((s) => [s.id, s]));
  const snapshotById = new Map(snapshot.map((s) => [s.id, s]));

  // Build content hash maps
  const currentHashes = new Map(current.map((s) => [s.id, slideContentHash(s)]));
  const snapshotHashes = new Map(snapshot.map((s) => [s.id, slideContentHash(s)]));

  const added = []; // In current only
  const removed = []; // In snapshot only
  const modified = []; // In both but different content
  const unchanged = []; // In both with same content

  // Check current slides against snapshot
  for (const slide of current) {
    if (!snapshotById.has(slide.id)) {
      added.push({ slide, source: 'current' });
    } else if (currentHashes.get(slide.id) !== snapshotHashes.get(slide.id)) {
      modified.push({
        current: slide,
        snapshot: snapshotById.get(slide.id),
      });
    } else {
      unchanged.push({ slide, source: 'both' });
    }
  }

  // Find removed slides (in snapshot but not current)
  for (const slide of snapshot) {
    if (!currentById.has(slide.id)) {
      removed.push({ slide, source: 'snapshot' });
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: unchanged.length,
      currentTotal: current.length,
      snapshotTotal: snapshot.length,
    },
  };
}

/**
 * Get a display category for a slide in the diff.
 * @param {string} slideId - Slide ID
 * @param {Object} diff - Diff result from computeSlideDiff
 * @returns {string} Category: 'added', 'removed', 'modified', or 'unchanged'
 */
export function getSlideCategory(slideId, diff) {
  if (diff.added.some((d) => d.slide.id === slideId)) return 'added';
  if (diff.removed.some((d) => d.slide.id === slideId)) return 'removed';
  if (diff.modified.some((d) => d.current.id === slideId || d.snapshot.id === slideId))
    return 'modified';
  return 'unchanged';
}

/**
 * Merge slides from both versions for side-by-side display.
 * Returns slides in order, with alignment for comparison.
 * @param {Array} currentSlides - Current slides
 * @param {Array} snapshotSlides - Snapshot slides
 * @param {Object} diff - Diff result
 * @returns {Array} Array of { current, snapshot, category } pairs
 */
export function alignSlidesForComparison(currentSlides, snapshotSlides, diff) {
  const current = Array.isArray(currentSlides) ? currentSlides : [];
  const snapshot = Array.isArray(snapshotSlides) ? snapshotSlides : [];

  const result = [];
  const usedSnapshotIds = new Set();

  // Process current slides in order
  for (const slide of current) {
    const category = getSlideCategory(slide.id, diff);
    if (category === 'modified') {
      const snapshotSlide = diff.modified.find((m) => m.current.id === slide.id)?.snapshot;
      result.push({ current: slide, snapshot: snapshotSlide, category });
      if (snapshotSlide) usedSnapshotIds.add(snapshotSlide.id);
    } else if (category === 'added') {
      result.push({ current: slide, snapshot: null, category });
    } else {
      // unchanged
      const snapshotSlide = snapshot.find((s) => s.id === slide.id);
      result.push({ current: slide, snapshot: snapshotSlide, category });
      if (snapshotSlide) usedSnapshotIds.add(snapshotSlide.id);
    }
  }

  // Add removed slides (only in snapshot)
  for (const slide of snapshot) {
    if (!usedSnapshotIds.has(slide.id)) {
      result.push({ current: null, snapshot: slide, category: 'removed' });
    }
  }

  return result;
}

/**
 * Get category styling info.
 * @param {string} category - Diff category
 * @returns {Object} { className, indicator, label }
 */
export function getCategoryStyle(category) {
  switch (category) {
    case 'added':
      return {
        className: 'diff-added',
        indicator: '🟢',
        label: 'Added',
      };
    case 'removed':
      return {
        className: 'diff-removed',
        indicator: '🔴',
        label: 'Removed',
      };
    case 'modified':
      return {
        className: 'diff-modified',
        indicator: '🟡',
        label: 'Modified',
      };
    default:
      return {
        className: 'diff-unchanged',
        indicator: '⚪',
        label: 'Unchanged',
      };
  }
}
