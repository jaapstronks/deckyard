/**
 * Video stream provider detection, embed URL building, and position presets.
 * Shared between client and server (ESM).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize protocol-relative URLs to absolute https. */
function toAbsoluteUrl(raw) {
  return raw.startsWith('//') ? `https:${raw}` : raw;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const PROVIDERS = [
  {
    id: 'youtube',
    match: (url) => {
      const h = url.hostname.toLowerCase();
      return h === 'youtu.be' || h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com');
    },
  },
  {
    id: 'vimeo',
    match: (url) => url.hostname.toLowerCase().endsWith('vimeo.com'),
  },
  {
    id: 'bunny',
    match: (url) => {
      const h = url.hostname.toLowerCase();
      return h.endsWith('mediadelivery.net') || h === 'video.bunnycdn.com';
    },
  },
  {
    id: 'mux',
    match: (url) => {
      const h = url.hostname.toLowerCase();
      return h.endsWith('mux.com') || h.endsWith('mux.dev');
    },
  },
  {
    id: 'cloudflare',
    match: (url) => {
      const h = url.hostname.toLowerCase();
      // Covers customer-<id>.cloudflarestream.com and *.videodelivery.net
      return h.endsWith('cloudflarestream.com') || h.endsWith('videodelivery.net');
    },
  },
];

/**
 * Detect the stream provider from a URL string.
 * Returns one of: 'youtube' | 'vimeo' | 'bunny' | 'mux' | 'cloudflare' | 'hls' | 'dash' | null.
 */
export function detectStreamProvider(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Direct stream URLs (HLS / DASH) - match by file extension before hostname checks
  if (/\.m3u8(\?|$)/i.test(raw)) return 'hls';
  if (/\.mpd(\?|$)/i.test(raw)) return 'dash';

  try {
    const u = new URL(toAbsoluteUrl(raw));
    for (const p of PROVIDERS) {
      if (p.match(u)) return p.id;
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

// ---------------------------------------------------------------------------
// Embed URL builders
// ---------------------------------------------------------------------------

function extractYouTubeId(raw) {
  try {
    const u = new URL(toAbsoluteUrl(raw));
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || '';
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
      if (m?.[1]) return m[1];
    }
  } catch {
    // ignore
  }
  return '';
}

function extractVimeoId(raw) {
  try {
    const u = new URL(toAbsoluteUrl(raw));
    if (u.hostname.toLowerCase().endsWith('vimeo.com')) {
      const m1 = u.pathname.match(/\/video\/(\d+)/);
      if (m1?.[1]) return m1[1];
      const m2 = u.pathname.match(/\/(\d+)/);
      if (m2?.[1]) return m2[1];
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Extract Bunny Stream library ID and video ID from a mediadelivery.net URL.
 * Handles both /play/{lib}/{id} and /embed/{lib}/{id} URL forms.
 */
function extractBunnyIds(raw) {
  try {
    const u = new URL(toAbsoluteUrl(raw));
    // https://iframe.mediadelivery.net/play/{libraryId}/{videoId}
    // https://iframe.mediadelivery.net/embed/{libraryId}/{videoId}
    // https://video.bunnycdn.com/play/{libraryId}/{videoId}
    const m = u.pathname.match(/\/(?:play|embed)\/(\d+)\/([0-9a-f-]{36})/i);
    if (m?.[1] && m?.[2]) return { libraryId: m[1], videoId: m[2] };
  } catch {
    // ignore
  }
  return null;
}

function extractCloudflareId(raw) {
  try {
    const u = new URL(toAbsoluteUrl(raw));
    // https://customer-<x>.cloudflarestream.com/<videoId>/...
    // https://watch.videodelivery.net/<videoId>
    // https://iframe.videodelivery.net/<videoId>
    const m = u.pathname.match(/^\/([a-z0-9]{32})/i);
    if (m?.[1]) return m[1];
  } catch {
    // ignore
  }
  return '';
}

function extractMuxPlaybackId(raw) {
  try {
    const u = new URL(toAbsoluteUrl(raw));
    // https://stream.mux.com/<playbackId>.m3u8
    // https://stream.mux.com/<playbackId>
    const seg = u.pathname.replace(/^\//, '').split('/')[0] || '';
    return seg.replace(/\.[^.]+$/, '') || '';
  } catch {
    // ignore
  }
  return '';
}

/**
 * Build an embeddable URL for the given stream URL + provider.
 * For iframe-based providers returns an embed URL; for native streams returns the raw URL.
 * All embeds include autoplay + muted params for browser autoplay policies.
 */
export function buildEmbedUrl(input, provider) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const prov = provider || detectStreamProvider(raw);

  switch (prov) {
    case 'youtube': {
      const id = extractYouTubeId(raw);
      if (!id) return '';
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1`;
    }
    case 'vimeo': {
      const id = extractVimeoId(raw);
      if (!id) return '';
      return `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1&muted=1&background=0&playsinline=1`;
    }
    case 'bunny': {
      const ids = extractBunnyIds(raw);
      if (!ids) return '';
      return `https://iframe.mediadelivery.net/embed/${encodeURIComponent(ids.libraryId)}/${encodeURIComponent(ids.videoId)}?autoplay=true&muted=true&preload=true`;
    }
    case 'cloudflare': {
      const id = extractCloudflareId(raw);
      if (!id) return '';
      return `https://iframe.videodelivery.net/${encodeURIComponent(id)}?autoplay=true&muted=true`;
    }
    case 'mux': {
      // Mux streams use native HLS; return the .m3u8 URL for <video> + hls.js
      const playbackId = extractMuxPlaybackId(raw);
      if (!playbackId) return raw;
      return `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8`;
    }
    case 'hls':
    case 'dash':
      // Native stream URL - return as-is
      return raw;
    default:
      return '';
  }
}

/**
 * Returns true when the provider should be rendered in an <iframe>.
 */
export function isIframeProvider(provider) {
  return provider === 'youtube' || provider === 'vimeo' || provider === 'bunny' || provider === 'cloudflare';
}

// ---------------------------------------------------------------------------
// Position presets (percentage-based: { x, y, width })
// ---------------------------------------------------------------------------

export const POSITION_PRESETS = {
  'pip-top-right':    { x: 72, y: 4, width: 25 },
  'pip-top-left':     { x: 3,  y: 4, width: 25 },
  'pip-bottom-right': { x: 72, y: 58, width: 25 },
  'pip-bottom-left':  { x: 3,  y: 58, width: 25 },
  'strip-top':        { x: 0,  y: 0, width: 100 },
  'strip-bottom':     { x: 0,  y: 75, width: 100 },
  'center':           { x: 25, y: 15, width: 50 },
};

export const POSITION_PRESET_LABELS = {
  'pip-top-right':    'PiP top-right',
  'pip-top-left':     'PiP top-left',
  'pip-bottom-right': 'PiP bottom-right',
  'pip-bottom-left':  'PiP bottom-left',
  'strip-top':        'Strip top',
  'strip-bottom':     'Strip bottom',
  'center':           'Center',
};

export const MOBILE_POSITIONS = {
  bottom: 'Bottom dock',
  top: 'Top dock',
  hidden: 'Hidden on mobile',
  pip: 'Small PiP',
};

/**
 * Resolve a preset name or custom { x, y, width } object to coordinates.
 * Returns { x, y, width } percentages or null.
 */
export function resolvePosition(presetOrCustom) {
  if (!presetOrCustom) return POSITION_PRESETS['pip-top-right'];

  if (typeof presetOrCustom === 'string') {
    return POSITION_PRESETS[presetOrCustom] || POSITION_PRESETS['pip-top-right'];
  }

  if (typeof presetOrCustom === 'object') {
    const x = Number(presetOrCustom.x);
    const y = Number(presetOrCustom.y);
    const w = Number(presetOrCustom.width);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w)) {
      return { x, y, width: w };
    }
  }

  return POSITION_PRESETS['pip-top-right'];
}
