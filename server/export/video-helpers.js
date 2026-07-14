/**
 * Video helpers for PPTX export.
 * Handles fetching Bunny videos and parsing video sources.
 */

/**
 * Parse a video source string and determine the provider and ID.
 * @param {string} source - The video source (URL or Bunny UUID)
 * @param {string} bunnyLibraryId - The Bunny library ID (default: '366590')
 * @returns {{ provider: 'bunny' | 'youtube' | 'vimeo' | null, videoId: string | null, libraryId: string | null, originalUrl: string }}
 */
export function parseVideoSource(source, bunnyLibraryId = '366590') {
  const raw = String(source || '').trim();
  if (!raw) {
    return { provider: null, videoId: null, libraryId: null, originalUrl: raw };
  }

  // Check for YouTube
  const ytMatch = parseYouTubeUrl(raw);
  if (ytMatch) {
    return {
      provider: 'youtube',
      videoId: ytMatch,
      libraryId: null,
      originalUrl: raw,
    };
  }

  // Check for Vimeo
  const vimeoMatch = parseVimeoUrl(raw);
  if (vimeoMatch) {
    return {
      provider: 'vimeo',
      videoId: vimeoMatch,
      libraryId: null,
      originalUrl: raw,
    };
  }

  // Check for Bunny
  const bunnyMatch = parseBunnySource(raw, bunnyLibraryId);
  if (bunnyMatch) {
    return {
      provider: 'bunny',
      videoId: bunnyMatch.videoId,
      libraryId: bunnyMatch.libraryId,
      originalUrl: raw,
    };
  }

  return { provider: null, videoId: null, libraryId: null, originalUrl: raw };
}

function parseYouTubeUrl(raw) {
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();

    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;

      const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
      if (embedMatch?.[1]) return embedMatch[1];

      const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch?.[1]) return shortsMatch[1];
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

function parseVimeoUrl(raw) {
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();

    if (host.endsWith('vimeo.com') || host.endsWith('player.vimeo.com')) {
      const videoMatch = u.pathname.match(/\/(?:video\/)?(\d+)/);
      if (videoMatch?.[1]) return videoMatch[1];
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

function parseBunnySource(raw, defaultLibraryId) {
  // Check for embed/play URL: https://iframe.mediadelivery.net/embed/366590/<uuid>
  const embedMatch = raw.match(
    /iframe\.mediadelivery\.net\/(?:embed|play)\/(\d+)\/([0-9a-f-]{36})/i
  );
  if (embedMatch) {
    return { videoId: embedMatch[2], libraryId: embedMatch[1] };
  }

  // Check for raw UUID
  if (looksLikeUuid(raw)) {
    return { videoId: raw, libraryId: defaultLibraryId };
  }

  return null;
}

/**
 * Build a Bunny CDN direct MP4 URL.
 * @param {string} pullZone - The Bunny pull zone hostname (e.g., 'vz-abc123-456.b-cdn.net')
 * @param {string} videoId - The video UUID
 * @param {number} resolution - The resolution (default: 720)
 * @returns {string} The direct MP4 URL
 */
export function buildBunnyMp4Url(pullZone, videoId, resolution = 720) {
  // Format: https://{pullzone}.b-cdn.net/{videoId}/play_{resolution}p.mp4
  // If pullZone already includes the full domain, use it; otherwise append .b-cdn.net
  const host = pullZone.includes('.') ? pullZone : `${pullZone}.b-cdn.net`;
  return `https://${host}/${videoId}/play_${resolution}p.mp4`;
}

/**
 * Build a Bunny CDN video thumbnail URL.
 * @param {string} pullZone - The Bunny pull zone hostname (e.g., 'vz-abc123-456.b-cdn.net')
 * @param {string} videoId - The video UUID
 * @returns {string} The thumbnail URL
 */
export function buildBunnyThumbnailUrl(pullZone, videoId) {
  // Format: https://{pullzone}.b-cdn.net/{videoId}/thumbnail.jpg
  // If pullZone already includes the full domain, use it; otherwise append .b-cdn.net
  const host = pullZone.includes('.') ? pullZone : `${pullZone}.b-cdn.net`;
  return `https://${host}/${videoId}/thumbnail.jpg`;
}

/**
 * Build a YouTube video thumbnail URL.
 * @param {string} videoId - The YouTube video ID
 * @param {string} quality - Thumbnail quality: 'default', 'mqdefault', 'hqdefault', 'sddefault', 'maxresdefault'
 * @returns {string} The thumbnail URL
 */
export function buildYouTubeThumbnailUrl(videoId, quality = 'hqdefault') {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

/**
 * Build a Vimeo video thumbnail URL via vumbnail service.
 * @param {string} videoId - The Vimeo video ID
 * @returns {string} The thumbnail URL
 */
export function buildVimeoThumbnailUrl(videoId) {
  // vumbnail.com provides direct thumbnail access without API calls
  return `https://vumbnail.com/${videoId}.jpg`;
}

/**
 * Fetch a video as a buffer from a URL.
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 60000)
 * @param {number} options.maxSizeMb - Maximum file size in MB (default: 100)
 * @returns {Promise<{ success: boolean, buffer?: Buffer, contentType?: string, error?: string }>}
 */
export async function fetchVideoBuffer(url, { timeoutMs = 60000, maxSizeMb = 100 } = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Deckyard-PPTX-Export/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get('content-length');
    const maxBytes = maxSizeMb * 1024 * 1024;

    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return {
        success: false,
        error: `Video too large (${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB, max ${maxSizeMb}MB)`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > maxBytes) {
      return {
        success: false,
        error: `Video too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB, max ${maxSizeMb}MB)`,
      };
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';

    return {
      success: true,
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Request timed out' };
    }
    return { success: false, error: err.message || 'Unknown error' };
  }
}

/**
 * Get Bunny CDN configuration from environment.
 * @returns {{ pullZone: string | null, configured: boolean }}
 */
export function getBunnyConfig() {
  const pullZone = process.env.BUNNY_PULLZONE || process.env.BUNNY_PULL_ZONE || null;
  return {
    pullZone,
    configured: Boolean(pullZone),
  };
}
