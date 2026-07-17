# Live video layer

A presentation can embed a live video stream (presenter webcam, event feed) as
a **persistent overlay** that floats on top of the slides. The player lives in
its own DOM layer (`.video-layer`) appended to the stage wrapper, *outside* the
slide container, so the stream keeps playing across slide transitions; only its
position animates (CSS transition on `left`/`top`/`width`, 0.3s ease-out). This
is distinct from the `video-slide` type, which embeds video as slide content
and reloads on every transition. Everything is client-side: the server stores
the settings as opaque JSON and does no validation or embedding.

## Settings shape

Deck-wide config lives at `presentation.settings.liveVideo` (defaults from
`shared/slide-types/presentation.js`, normalized on settings-modal open):

```json
{
  "liveVideo": {
    "enabled": false,
    "streamUrl": "",
    "provider": "",
    "defaultPosition": "pip-top-right",
    "mobilePosition": "bottom"
  }
}
```

- `enabled` — master toggle; layer is hidden and torn down when false.
- `streamUrl` — the URL the presenter pastes (watch URL, embed URL, or raw
  `.m3u8`/`.mpd`). The embed URL is derived from it at render time.
- `provider` — auto-detected from `streamUrl` on input in the settings modal;
  the layer re-detects as fallback when empty.
- `defaultPosition` — a preset name (string). `resolvePosition()` also accepts
  a custom `{ x, y, width }` object (percentages), but the editor UI only
  offers presets.
- `mobilePosition` — `bottom` | `top` | `hidden` | `pip`.

Configured in the editor under **Deck settings → Live Video**
(`client/views/editor/modals/settings-modal.js`): enable-toggle, URL input with
live provider-detection hint, position select, mobile-position select.

## Per-slide override

`createVideoLayer.updatePosition()` reads `slide.content.videoOverride`:

```json
{ "videoOverride": { "visible": false } }
{ "videoOverride": { "position": "strip-bottom" } }
{ "videoOverride": { "position": { "x": 5, "y": 60, "width": 40 } } }
```

`visible: false` hides the layer on that slide; `position` (preset name or
custom object) overrides `defaultPosition`. **There is no editor UI and no
slide-schema entry for this** - the runtime honors it, but it can currently
only be set via the API/JSON.

## Position presets

Defined in `shared/video-stream-providers.js` (`POSITION_PRESETS`),
percentage-based `{ x, y, width }`; height follows from a fixed 16:9 aspect
ratio (CSS `padding-bottom: 56.25%`). Unknown/missing presets fall back to
`pip-top-right`.

| Preset | x | y | width |
|--------|----|----|-------|
| `pip-top-right` | 72 | 4 | 25 |
| `pip-top-left` | 3 | 4 | 25 |
| `pip-bottom-right` | 72 | 58 | 25 |
| `pip-bottom-left` | 3 | 58 | 25 |
| `strip-top` | 0 | 0 | 100 |
| `strip-bottom` | 0 | 75 | 100 |
| `center` | 25 | 15 | 50 |

## Providers and playback

Detection (`detectStreamProvider`) checks `.m3u8`/`.mpd` extensions first,
then hostname patterns. `buildEmbedUrl` turns the pasted URL into either an
iframe embed URL (with autoplay+mute params baked in) or a raw stream URL.

| Provider | Detected from | Player |
|----------|---------------|--------|
| `youtube` | youtube.com / youtu.be / youtube-nocookie.com | iframe (`youtube-nocookie.com/embed/<id>`) |
| `vimeo` | vimeo.com | iframe (`player.vimeo.com/video/<id>`) |
| `bunny` | mediadelivery.net / video.bunnycdn.com | iframe (`iframe.mediadelivery.net/embed/<lib>/<id>`) |
| `cloudflare` | cloudflarestream.com / videodelivery.net | iframe (`iframe.videodelivery.net/<id>`) |
| `mux` | mux.com / mux.dev | `<video>` + hls.js (rewritten to `stream.mux.com/<id>.m3u8`) |
| `hls` | any `.m3u8` URL | `<video>`; native HLS on Safari, else hls.js |
| `dash` | any `.mpd` URL | `<video>` with plain `src` (dash.js deferred; only works where natively supported) |

hls.js is **not an npm dependency**: `client/lib/ensure-hls.js` lazy-loads
`hls.js@1` from the jsdelivr CDN (promise-cached) only when a non-Safari
browser needs an HLS stream. Unrecognized URLs produce an empty embed URL and
an inline "Unable to embed this stream URL." error panel; fatal hls.js errors
show "Stream error. Check the URL."

**Autoplay/unmute:** all players start muted (browser autoplay policy). An
"Unmute" button overlays the player; for `<video>` it flips `muted`, for
iframes it reloads the iframe with the mute param stripped
(`muted=false` for Cloudflare/Bunny).

## Mobile behavior

Below 768px viewport width, CSS (`72-video-layer.css`) overrides the JS-applied
position via `data-mobile-position` on `.video-layer`:

| `mobilePosition` | Behaviour |
|------------------|-----------|
| `bottom` (default) | Fixed to bottom, full width (height from 16:9 ratio) |
| `top` | Fixed to top, full width |
| `hidden` | `display: none` on mobile |
| `pip` | Fixed bottom-right corner, 40% width clamped to 140–200px |

Position transitions are disabled on mobile.

## Surfaces

The layer is mounted by three views via `createVideoLayer({ containerEl,
getCurrentSlide })`, with `setConfig(pres.settings.liveVideo)` on load and
`updatePosition()` on every slide render:

- **Presenter view** (`client/views/presenter.js`) — on the presenter's stage.
- **Follow view** (`client/views/follow.js`) — the main audience surface;
  `setConfig` re-runs on each presentation (re)fetch.
- **Share viewer** (`client/views/share-viewer.js`) — only created when
  `liveVideo.enabled && streamUrl`.

The **present window** (`client/views/present-window.js`, the projection
window in two-window mode) does *not* mount the layer, and the editor canvas
shows no video.

## Files involved

| File | Role |
|------|------|
| `shared/video-stream-providers.js` | Provider detection, embed-URL builders, position presets, `resolvePosition` (shared, but currently client-only consumers) |
| `client/lib/video-layer.js` | `createVideoLayer` factory: DOM scaffold, player build/teardown, unmute, positioning |
| `client/lib/ensure-hls.js` | Lazy CDN loader for hls.js |
| `client/styles/base/04-editor-and-misc/72-video-layer.css` | Layer positioning, transitions, mobile docks, error/unmute styling |
| `shared/slide-types/presentation.js` | `settings.liveVideo` defaults on new presentations |
| `client/views/editor/modals/settings-modal.js` | Settings normalization + "Live Video" section UI |
| `client/views/presenter.js`, `client/views/follow.js`, `client/views/share-viewer.js` | Mount points |

## Not built (boundary notes)

From the original plan, the following did **not** ship: per-slide override UI
(runtime support only, see above), drag-to-custom-position, dash.js playback,
HTTPS-only URL validation, and stream-state detection (offline/ended UIs come
from the platform embeds).
