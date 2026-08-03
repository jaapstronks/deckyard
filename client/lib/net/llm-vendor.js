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
