# Media & the image library

## Purpose & scope

Deckyard stores two different things about an image and keeps them apart. The
**bytes** live behind a _media provider_ — either the local filesystem under
`/uploads` or an S3-compatible bucket (AWS S3, MinIO, Wasabi, Backblaze B2,
Scaleway Object Storage, …) — reached through
one interface so the rest of the server never knows which is active. The
**catalogue entry** (url, title, description, alt texts, photographer, tags,
favourites) lives in the `image_library` table, per organization. Uploading is a
provider concern; finding an image again is a library concern.

This document covers the server side: the provider seam (`server/media/`), the
library store (`server/storage/image-library/`), the stock-media bridges
(Unsplash, Giphy, bundled gradients) and the routes on top. The _client_ side —
how the editor picks an image and which providers the chooser offers — is
[`image-picker-seam.md`](image-picker-seam.md); the gradient source is
[`bundled-gradients.md`](bundled-gradients.md); which image property lives where
on a slide is [`image-property-ownership.md`](image-property-ownership.md).

## Module map

Media providers (`server/media/`, 7 modules):

- `server/media/index.js` — the singleton factory: `initializeMediaProvider()`
  (once at startup), `getMediaProvider()`, `isMediaProviderInitialized()`,
  `getMediaStatus()` (provider name + presign support, no credentials).
- `server/media/interface.js` — the `MediaProvider` base class: `getStatus`,
  `createPresignedUpload`, `uploadBuffer`, `uploadDataUrl`, `confirmUpload`,
  `deleteFile`, `ownsUrl`. Every method throws unless a subclass implements it.
- `server/media/config.js` — reads `MEDIA_STORAGE_MODE` and the `S3_*` vars;
  `isS3Configured()`, `getS3Config()`, `derivePublicBaseUrl()`,
  `getEffectiveMediaProvider()`, `mediaConfigWarnings()` (the legacy `SCW_*`
  boot warnings).
- `server/media/local.js` — `LocalProvider`: writes into `uploadsDir(repoRoot)`,
  serves under `/uploads/…`, 10 MB default ceiling, optimises rasters with
  `sharp`. Also exports the shared helpers `parseDataUrl()` and
  `optimizeRasterImage()`.
- `server/media/s3.js` — `S3Provider`: presigned PUT uploads against any
  S3-compatible endpoint, allow-listed content types, 20 MB ceiling, 1 h
  presign expiry. Nothing vendor-specific: endpoint, region, bucket and public
  base URL all come from configuration.
- `server/media/imagekit.js` — the ImageKit DAM **read** client
  (`getImageKitConfigFromEnv`, `listImageKitFiles`, `listImageKitTags`,
  `getImageKitFileDetails`, `patchImageKitFileDetails`). ImageKit is not a
  storage provider here: nothing uploads to it.
- `server/media/bundled-gradients.js` — the licence-free gradient source that
  ships with the app (theme-derived SVG specs + manifest);
  see [`bundled-gradients.md`](bundled-gradients.md).

Library store:

- `server/storage/image-library/index.js` — the scoped facade:
  `listImageLibrary`, `getImageLibraryItem`, `createImageLibraryItem`,
  `updateImageLibraryItem`, `deleteImageLibraryItem`, `getImageFavorites`,
  `toggleImageFavorite`. Every function takes a storage scope, never a bare
  `repoRoot`.
- `server/storage/image-library-usage.js` — `getImageLibraryUsage(storageScope, url)`:
  which decks use this image and whether any of them are published.
- `server/storage/uploads.js` — the direct-to-disk path used by the stock-media
  importer: `writeUploadedFile()` (20 MB ceiling for GIFs) and
  `replaceUploadFromDataUrl()` (in-place replace, extension/mime must match,
  10 MB).

Third-party sources:

- `server/integrations/unsplash.js` — `isUnsplashConfigured`, `searchUnsplash`,
  `getUnsplashPhoto`, `triggerDownload` (required by Unsplash's API terms),
  `downloadImage`.
- `server/integrations/giphy.js` — `isGiphyConfigured`, `searchGiphy`,
  `getTrendingGiphy`, `getGiphyGif`, `downloadGif`.
- `server/sandbox/media.js` — `listSandboxMedia()`: the curated sample images and
  fictional-brand logos injected into the library listing in sandbox mode only.

Routes:

- `server/routes/api/media.js` (153 lines) — provider status, presign/confirm,
  and the ImageKit browse/patch endpoints.
- `server/routes/api/uploads.js` (49 lines) — the server-side data-URL upload.
- `server/routes/api/image-library.js` (209 lines) — the library CRUD, usage,
  favourites, alt-text generation and in-place replace.
- `server/routes/api/stock-media.js` (289 lines) — status, bundled manifest, and
  the Unsplash/Giphy search + import endpoints.
- `server/routes/api/assets.js` (62 lines) — lists repo-shipped partner logos and
  backgrounds (`assets/images/…` plus a fork's `custom/assets/images/…`). These
  are static files, not library items.
- `server/routes/static/static-files.js` — serves `/uploads/…`; user-uploaded
  content is served inert (the `userUpload` flag exists so an uploaded SVG cannot
  execute).

## Data model

Table `image_library` (`server/db/migrations/001_initial_schema.js`, extended by
`server/db/migrations/033_image_library_enhancements.js`):

| Column                      | Type         | Notes                                                      |
| --------------------------- | ------------ | ---------------------------------------------------------- |
| `id`                        | uuid         | primary key                                                |
| `organization_id`           | uuid         | FK → `organizations(id)` **ON DELETE CASCADE**             |
| `url`                       | text         | NOT NULL — `/uploads/…`, a bucket/CDN URL, or a remote URL |
| `title`                     | varchar(255) |                                                            |
| `description`               | varchar(200) |                                                            |
| `photographer`              | varchar(120) | attribution (Unsplash fills this)                          |
| `tags`                      | text[]       | free-form; `logo`, `unsplash`, `giphy`, …                  |
| `alts`                      | jsonb        | per-language alt text, default `{"nl":"","en-GB":""}`      |
| `sources`                   | text[]       | provenance                                                 |
| `uploaded_by`               | varchar(320) | added by 033; indexed with `organization_id`               |
| `created_at` / `updated_at` | timestamptz  |                                                            |

Table `image_library_favorites` (033) — `(image_id, user_email,
organization_id)` composite primary key, both FKs **ON DELETE CASCADE**, indexed
on `(organization_id, user_email)`. Favourites are per user _within_ an
organization, so the same person in two organizations has two sets.

There is **no row for the bytes**: a media provider key is not persisted
anywhere except inside the `url` of the library item (or of a slide, a theme
logo, or an avatar) that points at it.

## Flows

- **Upload, local provider** — the editor POSTs a data URL to `/api/uploads`;
  `uploadDataUrl` decodes it, checks the mime against `MIME_TO_EXT`, optimises
  rasters via `sharp`, writes `<safe-base>-<uuid>.<ext>` into `uploadsDir()` and
  returns `{filename, url, mime, bytes}`. Adding it to the catalogue is a
  _separate_ `POST /api/image-library` — an upload is not automatically a library
  item.
- **Upload, bucket provider** — `POST /api/media/presign {filename, contentType,
size}` returns a presigned PUT plus the eventual `publicUrl` and a key
  `uploads/<YYYY/MM>/<safe-base>-<uuid>.<ext>`; the browser PUTs the bytes
  straight to the bucket; `POST /api/media/confirm {key}` verifies the object
  exists. Presign is refused when the active provider reports
  `supportsPresigned: false` (the local provider does).
- **Import from Unsplash/Giphy** — search hits the third-party API server-side
  (the key never reaches the browser); the import endpoint fetches the bytes,
  writes them through `writeUploadedFile()`, and creates a library item with the
  attribution attached. For Unsplash the download-tracking ping
  (`triggerDownload`) fires first, as their API terms require. **The bytes are
  copied**: nothing hot-links to Unsplash or Giphy.
- **Bundled gradients** — `GET /api/stock-media/bundled/manifest` returns static
  `/assets/gradients/…` items. There is no search, no pagination and no import
  step; picking one writes its URL onto the slide.
- **Alt text** — `POST /api/image-library/generate-alts` (ad-hoc URL) or
  `/api/image-library/:id/generate-alts` (an existing item) returns
  `{alts: {nl, en-GB}}` as a _preview_; it does not persist. Saving is a
  subsequent `PUT`.
- **Usage & replace** — `GET /api/image-library/:id/usage` joins the image URL
  against the organization's decks and publish index. `POST
/api/image-library/:id/replace-upload` swaps the bytes behind an existing
  `/uploads/…` URL in place (so every deck using it updates at once); it is
  refused for any item whose URL is not a local upload, and the replacement's
  mime must match the existing extension.
- **ImageKit browse** — `GET /api/media/imagekit/files|tags|…/details` proxy an
  external DAM read-only, plus `PATCH …/details` to write tags/custom metadata
  back. ImageKit items are never copied into `image_library`.

## Config & flags

| Name                                                                                | Where                            | Purpose / default                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_STORAGE_MODE`                                                                | `media/config.js`                | `auto` (default), `s3`, `local`. `auto` picks S3 when it is fully configured. `s3` throws at startup if it is not.                                                                                 |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_ENDPOINT`                        | `media/config.js`                | All four required to count as configured. `S3_ENDPOINT` has **no default** — name your provider (`https://s3.nl-ams.scw.cloud`, `https://minio.example.com`, …).                                   |
| `S3_REGION`, `S3_PUBLIC_URL`                                                        | `media/config.js`                | Region defaults to `nl-ams`. `S3_PUBLIC_URL` is the CDN/custom-domain base; unset means the public URL is derived from endpoint + bucket (virtual-hosted style, bucket must be publicly readable). |
| `SCW_*`, `MEDIA_STORAGE_MODE=scaleway`                                              | `media/config.js`                | **Legacy, removed in the first release after 2026-11-01.** Read only when the `S3_*` counterpart is unset; each one read prints a boot warning. See _Legacy env names_ below.                      |
| `UPLOADS_DIR` / `SANDBOX_UPLOADS_DIR`                                               | `server/config/storage-paths.js` | Override the local upload directory. It defaults to an `uploads` directory under `server/` (`uploads-sandbox` in sandbox mode), created at boot by `server/server.js` — so neither is in the repo. |
| `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_URL_ENDPOINT`              | `media/imagekit.js`              | Required for the DAM panel; missing ones surface as `issues`.                                                                                                                                      |
| `IMAGEKIT_UPLOAD_FOLDER`, `IMAGEKIT_TAG_PREFIX`, `IMAGEKIT_METADATA_FIELD_ALT_SEED` | `media/imagekit.js`              | Optional; missing ones surface as `warnings`. Tag prefix defaults to `deck:`.                                                                                                                      |
| `UNSPLASH_ACCESS_KEY`                                                               | `integrations/unsplash.js`       | Enables Unsplash search/import.                                                                                                                                                                    |
| `GIPHY_API_KEY`                                                                     | `integrations/giphy.js`          | Enables Giphy search/trending/import.                                                                                                                                                              |

### Legacy env names (until 2026-11-01)

The provider used to be named after one vendor (a `scaleway.js` module with a
`ScalewayProvider` class, `SCW_*`, `MEDIA_STORAGE_MODE=scaleway`). It is
generic S3 now (D25); the old
names are still recognized until the removal date, in the B68 shape — never as
a silent alias:

| Legacy (deprecated)           | Canonical               |
| ----------------------------- | ----------------------- |
| `MEDIA_STORAGE_MODE=scaleway` | `MEDIA_STORAGE_MODE=s3` |
| `SCW_ACCESS_KEY`              | `S3_ACCESS_KEY`         |
| `SCW_SECRET_KEY`              | `S3_SECRET_KEY`         |
| `SCW_BUCKET`                  | `S3_BUCKET`             |
| `SCW_REGION`                  | `S3_REGION`             |
| `SCW_ENDPOINT`                | `S3_ENDPOINT`           |
| `SCW_CDN_URL`                 | `S3_PUBLIC_URL`         |

A legacy name is read only when its canonical counterpart is unset, and every
one that is read produces a `⚠️  CONFIG:` line at boot naming the replacement
and the date (`mediaConfigWarnings()`, printed by `server/server.js` next to
`deprecatedFlagWarnings()`). One extra warning covers the endpoint: for an
**untouched** legacy install only — no endpoint under either name and no
`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` set — an unset endpoint is still
derived as `https://s3.<region>.scw.cloud` (the single place a vendor host
survives). The moment any `S3_*` core var is set, the install is on the new
names and has to name its endpoint: `S3_ENDPOINT` has no default. After the
removal date both the names and that derivation are deleted.

A **partly configured** S3 set (some of `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET`, `S3_ENDPOINT`, but not all) is a misconfiguration, not a choice:
`auto` mode falls back to local `/uploads` as before, but now says so with a
boot warning naming the missing vars.

Feature flags (`server/config/flags-snapshot.js`):

| Flag                          | Effect                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGEKIT_ONLY`               | Forces both `enableUploads` and `enableImageLibrary` off — ImageKit becomes the only image source.                                                                    |
| `UPLOADS_ENABLED=false`       | Blocks the upload paths (also forced by demo and sandbox mode).                                                                                                       |
| `IMAGE_LIBRARY_ENABLED=false` | `/api/image-library/*` answers 404.                                                                                                                                   |
| `DEMO_MODE` / sandbox mode    | Library is read-only (GET only): no upload, no create, no edit, no delete, no alt-text generation. Sandbox additionally prepends `listSandboxMedia()` to the listing. |
| `aiAltText`                   | Derived: alt-text generation needs AI enabled _and_ OpenAI as the configured default vendor.                                                                          |

Per-provider stock toggles are **settings**, not env vars: `stockMedia.<bundled|
unsplash|giphy>.enabled` in app settings (`server/storage/settings.js`). A
provider must be both _configured_ (key present) and _enabled_ (toggled on) to
answer anything but `status`.

Size ceilings, all hardcoded: local upload 10 MB, presigned upload 20 MB,
stock-media import 20 MB (GIFs are large), in-place replace 10 MB.

## Authz & tenancy

- **Everything here is behind the session login gate.** All five route modules
  are dispatched _after_ the `unauthorized(res)` check in
  `server/routes/api/index.js` — none of them is reachable anonymously on an
  auth-enabled instance. The `if (!authedUser)` checks and "public" comments
  inside the handlers are a second layer that only bites when auth is disabled
  (`AUTH_ENABLED=false`) or in sandbox mode, where the gate hands out a guest.
- **Library reads/writes** go through the storage scope, so every query is
  narrowed to one `organization_id`; two organizations on one instance never see
  each other's images. General rules: [`tenant-isolation.md`](tenant-isolation.md).
- **Verbs**: read is open to any authenticated member of the organization;
  create, update, replace, favourite and alt-text generation need a real user;
  **delete requires admin** (`authedUser.isAdmin`) — the only admin-gated verb in
  the subsystem. Favourites are only attached to a listing when the caller has an
  email.
- **Uploads** (`/api/uploads`, `/api/media/presign`, `/api/media/confirm`) are
  refused in demo/sandbox mode, and `handleUploads` is skipped entirely by the
  router when `flags.enableUploads` is off.
- **Bytes are not tenant-scoped.** A `/uploads/<uuid>.<ext>` URL or a bucket
  object URL is a capability: anyone holding it can fetch it, which is what makes
  published decks and share links work. Isolation is on the _catalogue_, not on
  the file. Uploaded content is served inert to keep an uploaded SVG from
  executing.

## Implementation status

The provider seam, both providers, the per-organization library with favourites
and usage lookup, the three stock sources and the ImageKit browse panel are
implemented and shipped.

Known gaps and rough edges, honestly:

- **No garbage collection.** `deleteFile()` exists on the interface, but deleting
  a library item does not delete the bytes, and nothing sweeps uploads that no
  deck references. Storage grows monotonically.
- **Deleting an image does not repair the decks that use it.** `usage` tells you
  who would break; nothing enforces it.
- **The catalogue and the bytes can drift.** A library item is just a URL; if the
  file behind it is removed out of band, the row stays and renders broken.
- **Presign is bucket-only.** With the local provider the browser cannot upload
  directly, so large files travel base64-encoded through `/api/uploads`, and the
  ceiling is 10 MB.
- **ImageKit is a parallel world.** It has its own picker, its own metadata and
  its own alt-text seed field, and its items never enter `image_library` — so
  usage lookup, favourites and per-organization scoping do not apply to them.
  The normative target is one library concept; today there are two, and
  `IMAGEKIT_ONLY` exists precisely because they do not merge.
- **Favourites key on `user_email`**, not `users.id` — the identity track (T10)
  moves ownership to user ids elsewhere; this table has not been converted.
