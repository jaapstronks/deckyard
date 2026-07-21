import { storage } from '../storage.js';
import { KNOWN_VENDORS } from '../../../shared/llm-vendors.js';

const LS_KEY = 'sb.llmVendor';

export function normalizeLlmVendor(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (KNOWN_VENDORS.includes(s)) return s;
  return null;
}

export function readPreferredLlmVendor() {
  return normalizeLlmVendor(storage.get(LS_KEY, null));
}

export function writePreferredLlmVendor(vendor) {
  const v = normalizeLlmVendor(vendor);
  if (!v) storage.remove(LS_KEY);
  else storage.set(LS_KEY, v);
}

export async function fetchLlmStatus(api) {
  try {
    return await api('/api/ai/vendors');
  } catch {
    return null;
  }
}

export function pickInitialVendor(status) {
  const stored = readPreferredLlmVendor();
  const configured = Array.isArray(status?.configuredVendors)
    ? status.configuredVendors
    : [];
  const defaultVendor = normalizeLlmVendor(status?.defaultVendor);

  if (stored && configured.includes(stored)) return stored;
  if (defaultVendor && configured.includes(defaultVendor)) return defaultVendor;
  const first = normalizeLlmVendor(configured[0]);
  return first || stored || defaultVendor || null;
}

export function labelForVendor(v, status) {
  const s = normalizeLlmVendor(v);
  if (s === 'openai') return 'OpenAI';
  if (s === 'claude') return 'Claude';
  if (s === 'mistral') return 'Mistral';
  if (s === 'deepseek') return 'DeepSeek';
  if (s === 'openai-compat') return status?.vendorLabels?.['openai-compat'] || 'Custom LLM';
  return String(v || '');
}

/**
 * Create an LLM vendor selector component.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element factory (h('select', {...}))
 * @param {Function} options.api - API fetch function
 * @param {string} [options.label='LLM'] - Label text
 * @param {string} [options.wrapClass='stack modal-field-narrow'] - Wrapper CSS class
 * @param {Function} [options.onChange] - Callback when vendor changes (vendor) => {}
 * @returns {Object} { wrap, select, getVendor, setDisabled, populate }
 */
export function createLlmSelector({
  h,
  api,
  label = 'LLM',
  wrapClass = 'stack modal-field-narrow',
  onChange,
} = {}) {
  let llmVendor = null;
  let llmStatus = null;
  let disabled = false;

  const wrap = h('div', { class: wrapClass });
  const labelEl = h('div', { class: 'field-label', text: label });
  const select = h('select', { class: 'form-input is-compact' });
  select.append(h('option', { value: '', text: '---' }));
  select.value = '';

  select.addEventListener('change', () => {
    llmVendor = normalizeLlmVendor(select.value) || null;
    writePreferredLlmVendor(llmVendor);
    onChange?.(llmVendor);
  });

  wrap.append(labelEl, select);

  const getVendor = () => llmVendor;

  const setDisabled = (v) => {
    disabled = !!v;
    const configured = Array.isArray(llmStatus?.configuredVendors)
      ? llmStatus.configuredVendors
      : [];
    select.disabled = disabled || configured.length <= 1;
  };

  const populate = async () => {
    try {
      llmStatus = await fetchLlmStatus(api);
      const configured = Array.isArray(llmStatus?.configuredVendors)
        ? llmStatus.configuredVendors
        : [];
      const initial = pickInitialVendor(llmStatus);

      select.innerHTML = '';
      for (const v of configured) {
        const norm = normalizeLlmVendor(v);
        if (!norm) continue;
        select.append(h('option', { value: norm, text: labelForVendor(norm, llmStatus) }));
      }

      llmVendor = initial;
      if (llmVendor) {
        select.value = llmVendor;
        writePreferredLlmVendor(llmVendor);
      } else {
        select.append(h('option', { value: '', text: '---' }));
        select.value = '';
      }
      select.disabled = disabled || configured.length <= 1;
    } catch {
      // Keep default state on error
    }
  };

  // Auto-populate on creation
  populate();

  return { wrap, select, getVendor, setDisabled, populate };
}