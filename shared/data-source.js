/**
 * Shared data source types and validation for live/dynamic slides.
 *
 * A dataSource object lives on a slide and describes how to fetch external
 * data and map it to the slide's content fields.
 */

/** Supported data source providers */
export const DATA_SOURCE_PROVIDERS = ['notion-database', 'notion-block', 'csv-url'];

/** Refresh mode controls when data is fetched */
export const REFRESH_MODES = ['frozen', 'manual', 'on-view'];

/** Human-readable labels for data source providers */
export const PROVIDER_LABELS = {
  'notion-database': 'Notion Database',
  'notion-block': 'Notion Block',
  'csv-url': 'CSV / Google Sheets',
};

/**
 * Validate a dataSource object.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateDataSource(ds) {
  if (!ds || typeof ds !== 'object') {
    return { valid: false, error: 'dataSource must be an object' };
  }

  if (!DATA_SOURCE_PROVIDERS.includes(ds.provider)) {
    return { valid: false, error: `Invalid provider: ${ds.provider}` };
  }

  if (!ds.config || typeof ds.config !== 'object') {
    return { valid: false, error: 'dataSource.config must be an object' };
  }

  if (!Array.isArray(ds.bindings)) {
    return { valid: false, error: 'dataSource.bindings must be an array' };
  }

  for (let i = 0; i < ds.bindings.length; i++) {
    const b = ds.bindings[i];
    if (!b || typeof b !== 'object') {
      return { valid: false, error: `bindings[${i}] must be an object` };
    }
    if (typeof b.target !== 'string' || !b.target.trim()) {
      return { valid: false, error: `bindings[${i}].target must be a non-empty string` };
    }
    if (typeof b.source !== 'string' || !b.source.trim()) {
      return { valid: false, error: `bindings[${i}].source must be a non-empty string` };
    }
  }

  if (!ds.refresh || typeof ds.refresh !== 'object') {
    return { valid: false, error: 'dataSource.refresh must be an object' };
  }

  if (!REFRESH_MODES.includes(ds.refresh.mode)) {
    return { valid: false, error: `Invalid refresh mode: ${ds.refresh.mode}` };
  }

  return { valid: true };
}

/**
 * Create a frozen snapshot of a data source (for inserting live slides into decks).
 */
export function freezeDataSource(ds) {
  if (!ds) return null;
  return {
    ...ds,
    refresh: { mode: 'frozen' },
    lastSync: ds.lastSync || new Date().toISOString(),
  };
}

/**
 * Check whether a data source is actively fetching data.
 */
export function isLiveDataSource(ds) {
  return ds && ds.refresh && ds.refresh.mode !== 'frozen';
}

/**
 * Slide types that support data source bindings and their bindable fields.
 */
export const BINDABLE_SLIDE_TYPES = {
  'kpi-metrics-slide': {
    label: 'KPI Metrics',
    fields: [
      { target: 'metrics[*].value', label: 'Metric value', sourceHint: 'cell or property' },
      { target: 'metrics[*].label', label: 'Metric label', sourceHint: 'cell or property' },
      { target: 'metrics[*].delta', label: 'Metric delta', sourceHint: 'cell or property' },
      { target: 'metrics[*].unit', label: 'Metric unit', sourceHint: 'cell or property' },
      { target: 'metrics[*].note', label: 'Metric note', sourceHint: 'cell or property' },
      { target: 'title', label: 'Title', sourceHint: 'cell or property' },
    ],
  },
  'table-slide': {
    label: 'Table',
    fields: [
      { target: 'rows[*].c*', label: 'Cell value', sourceHint: 'cell reference' },
      { target: 'title', label: 'Title', sourceHint: 'cell or property' },
    ],
  },
  'chart-slide': {
    label: 'Chart',
    fields: [
      { target: 'csvData', label: 'Chart data (CSV)', sourceHint: 'range or URL' },
      { target: 'title', label: 'Title', sourceHint: 'cell or property' },
    ],
  },
  'quote-slide': {
    label: 'Quote',
    fields: [
      { target: 'quote', label: 'Quote text', sourceHint: 'block or cell' },
      { target: 'attribution', label: 'Attribution', sourceHint: 'block or cell' },
    ],
  },
  'content-slide': {
    label: 'Content',
    fields: [
      { target: 'title', label: 'Title', sourceHint: 'block or cell' },
      { target: 'body', label: 'Body', sourceHint: 'block or cell' },
    ],
  },
  'timeline-slide': {
    label: 'Timeline',
    fields: [
      { target: 'items[*].time', label: 'Time', sourceHint: 'cell or property' },
      { target: 'items[*].title', label: 'Item title', sourceHint: 'cell or property' },
      { target: 'items[*].text', label: 'Item text', sourceHint: 'cell or property' },
      { target: 'title', label: 'Title', sourceHint: 'cell or property' },
    ],
  },
};
