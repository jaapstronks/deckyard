import { optionalEnv, requireEnv } from './env.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { KNOWN_VENDORS } from '../../../shared/llm-vendors.js';

export function normalizeLlmVendor(vendor) {
  if (typeof vendor !== 'string') return null;
  const v = vendor.trim().toLowerCase();
  if (!v) return null;
  if (KNOWN_VENDORS.includes(v)) return v;
  return null;
}

export function listConfiguredVendors() {
  const out = [];
  if (optionalEnv('OPENAI_API')) out.push('openai');
  if (optionalEnv('CLAUDE_API')) out.push('claude');
  if (optionalEnv('MISTRAL_API')) out.push('mistral');
  if (optionalEnv('DEEPSEEK_API')) out.push('deepseek');
  if (optionalEnv('OPENAI_COMPAT_ENDPOINT') && optionalEnv('OPENAI_COMPAT_MODEL')) out.push('openai-compat');
  return out;
}

export function detectDefaultVendor() {
  // Sandbox stance: only allow Mistral (to keep costs and governance predictable).
  if (sandboxEnabled()) {
    if (optionalEnv('MISTRAL_API')) return 'mistral';
    return null;
  }
  const explicit = normalizeLlmVendor(optionalEnv('LLM_VENDOR'));
  if (explicit) return explicit;
  // Back-compat: OPENAI-only setups should keep working without changes.
  if (optionalEnv('OPENAI_API')) return 'openai';
  if (optionalEnv('CLAUDE_API')) return 'claude';
  if (optionalEnv('MISTRAL_API')) return 'mistral';
  if (optionalEnv('DEEPSEEK_API')) return 'deepseek';
  if (optionalEnv('OPENAI_COMPAT_ENDPOINT') && optionalEnv('OPENAI_COMPAT_MODEL')) return 'openai-compat';
  return null;
}

/**
 * Resolve the LLM config for a call.
 *
 * @param {Object} options
 * @param {string} [options.vendor] - Explicit vendor override
 * @param {string} [options.role] - 'plan' for outline/structure calls (deck
 *   planning), where type selection quality matters most. For the Claude
 *   vendor this selects a stronger model (Opus) than the generation default
 *   (Sonnet); other vendors ignore the role. Overridable via CLAUDE_MODEL_PLAN.
 */
export function getLlmConfig({ vendor = null, role = null } = {}) {
  const normalized = normalizeLlmVendor(vendor);
  if (vendor != null && typeof vendor === 'string' && vendor.trim() && !normalized) {
    const err = new Error(
      `Invalid LLM vendor "${vendor}". Expected one of: ${KNOWN_VENDORS.join(', ')}.`
    );
    err.statusCode = 400;
    throw err;
  }

  // Sandbox stance: enforce Mistral-only even if clients request another vendor.
  if (sandboxEnabled()) {
    if (normalized && normalized !== 'mistral') {
      const err = new Error('Sandbox mode only supports the Mistral LLM vendor.');
      err.statusCode = 400;
      throw err;
    }
    return {
      vendor: 'mistral',
      apiKey: requireEnv('MISTRAL_API'),
      model: (optionalEnv('MISTRAL_MODEL') || 'mistral-small-latest').trim(),
    };
  }

  const resolved = normalized || detectDefaultVendor();
  if (!resolved) {
    const err = new Error(
      'No LLM vendor configured. Set OPENAI_API, CLAUDE_API, MISTRAL_API, DEEPSEEK_API, or OPENAI_COMPAT_ENDPOINT in .env.'
    );
    err.statusCode = 400;
    throw err;
  }

  if (resolved === 'openai') {
    return {
      vendor: 'openai',
      apiKey: requireEnv('OPENAI_API'),
      model: (optionalEnv('OPENAI_MODEL') || 'gpt-5.2').trim(),
    };
  }

  if (resolved === 'claude') {
    // Default: claude-sonnet-5 for generation/fill; claude-opus-4-8 for the
    // plan/outline step (role 'plan'), where structure + type selection
    // matter most. A pinned CLAUDE_MODEL keeps applying everywhere unless
    // CLAUDE_MODEL_PLAN overrides the plan step separately.
    const fillModel = (optionalEnv('CLAUDE_MODEL') || 'claude-sonnet-5').trim();
    const planModel = (
      optionalEnv('CLAUDE_MODEL_PLAN') ||
      optionalEnv('CLAUDE_MODEL') ||
      'claude-opus-4-8'
    ).trim();
    return {
      vendor: 'claude',
      apiKey: requireEnv('CLAUDE_API'),
      model: role === 'plan' ? planModel : fillModel,
    };
  }

  if (resolved === 'mistral') {
    return {
      vendor: 'mistral',
      apiKey: requireEnv('MISTRAL_API'),
      model: (optionalEnv('MISTRAL_MODEL') || 'mistral-large-latest').trim(),
    };
  }

  if (resolved === 'deepseek') {
    return {
      vendor: 'deepseek',
      apiKey: requireEnv('DEEPSEEK_API'),
      model: (optionalEnv('DEEPSEEK_MODEL') || 'deepseek-chat').trim(),
    };
  }

  if (resolved === 'openai-compat') {
    requireEnv('OPENAI_COMPAT_ENDPOINT');
    return {
      vendor: 'openai-compat',
      apiKey: optionalEnv('OPENAI_COMPAT_API') || '',
      model: requireEnv('OPENAI_COMPAT_MODEL'),
    };
  }

  // Should never happen; keep it explicit for safety.
  const err = new Error(`Unsupported LLM vendor: ${String(resolved)}`);
  err.statusCode = 400;
  throw err;
}

export function getLlmStatus() {
  const configuredVendors = listConfiguredVendors();
  const defaultVendor = detectDefaultVendor();
  if (sandboxEnabled()) {
    const only = configuredVendors.includes('mistral') ? ['mistral'] : [];
    return {
      knownVendors: ['mistral'],
      configuredVendors: only,
      defaultVendor: defaultVendor === 'mistral' ? 'mistral' : null,
    };
  }
  const vendorLabels = {};
  const compatLabel = optionalEnv('OPENAI_COMPAT_LABEL');
  if (compatLabel) vendorLabels['openai-compat'] = compatLabel;

  return {
    knownVendors: [...KNOWN_VENDORS],
    configuredVendors,
    defaultVendor,
    vendorLabels,
  };
}
