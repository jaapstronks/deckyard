/**
 * Media Provider Factory
 *
 * Exports a singleton media provider based on configuration.
 * Uses Scaleway when configured, falls back to local /uploads for OSS.
 */

import { getEffectiveMediaProvider, isScalewayConfigured } from './config.js';
import { LocalProvider } from './local.js';

let _provider = null;
let _repoRoot = null;

/**
 * Initialize the media provider.
 * Should be called once at server startup.
 * @param {string} repoRoot
 */
export async function initializeMediaProvider(repoRoot) {
  if (_provider) {
    console.warn('[media] Provider already initialized');
    return;
  }

  _repoRoot = repoRoot;
  const providerType = getEffectiveMediaProvider();

  if (providerType === 'scaleway') {
    const { ScalewayProvider } = await import('./scaleway.js');
    _provider = new ScalewayProvider();
    console.log('[media] Initialized Scaleway provider');
  } else {
    _provider = new LocalProvider(repoRoot);
    console.log('[media] Initialized local provider (/uploads)');
  }
}

/**
 * Get the initialized media provider.
 * @returns {import('./interface.js').MediaProvider}
 */
export function getMediaProvider() {
  if (!_provider) {
    throw new Error('Media provider not initialized. Call initializeMediaProvider() first.');
  }
  return _provider;
}

/**
 * Check if media provider is initialized.
 * @returns {boolean}
 */
export function isMediaProviderInitialized() {
  return _provider !== null;
}

/**
 * Get media status for client.
 * Returns info about current provider without exposing credentials.
 */
export function getMediaStatus() {
  const provider = _provider ? _provider.getStatus() : { name: 'none', configured: false, supportsPresigned: false };
  return {
    mode: provider.name,
    presignedSupported: provider.supportsPresigned,
    imagekitAvailable: !!process.env.IMAGEKIT_PUBLIC_KEY,
  };
}

/**
 * Create a media provider for a specific request context.
 * Useful when you need provider without the global singleton.
 * @param {string} repoRoot
 * @returns {Promise<import('./interface.js').MediaProvider>}
 */
export async function createMediaProvider(repoRoot) {
  const providerType = getEffectiveMediaProvider();

  if (providerType === 'scaleway') {
    const { ScalewayProvider } = await import('./scaleway.js');
    return new ScalewayProvider();
  }

  return new LocalProvider(repoRoot);
}