# Image-picker seam

How Deckyard's editor resolves *where images come from* — one injected entry
point (`openImagePicker`) over a small provider registry. This is the seam a
downstream fork swaps to route every image entry point (side-form fields **and**
the inline WYSIWYG popover) through its own DAM.

## The shape

`client/views/editor/media/picker-provider.js` exports
`createImagePickerSeam({ h, root, features, openImageLibrary, openImageKit })`,
which returns a single `openImagePicker(opts)` function (with a `.providers`
array attached for feature-detection at call sites).

```js
openImagePicker({
  title, docId, allowCaptionCredit, context,
  onPick: (picked) => { /* normalized PickedImage */ },
});
```

Enabled providers are resolved from `features`:

- **native library** (`local-library`) — enabled unless
  `features.disableImageLibrary` (which `IMAGEKIT_ONLY` already forces). Wraps
  `openImageLibraryPicker` (local/Scaleway upload + Unsplash/Giphy).
- **ImageKit** (`imagekit`) — enabled whenever its raw opener is injected.

With **one** provider enabled, `openImagePicker` opens it directly. With **more
than one**, it shows a lightweight source chooser first. A single-provider
config (e.g. `IMAGEKIT_ONLY`) therefore has the native library *fully absent*,
not merely hidden.

## The normalized pick (`PickedImage`)

Every provider adapter maps its native result to one contract, so call sites
never branch on provider:

```
{
  url: string,               // required
  alt?: string,              // single seed (provider had no per-language map)
  alts?: { [lang]: string }, // per-language alt map
  caption?: string,          // resolved caption/credit, if any
  tags?: string[],
  providerId?: string,       // opaque, e.g. ImageKit fileId
  meta?: Record<string, unknown>,
}
```

## Persisting a pick

`client/views/editor/media/apply-pick.js` flattens a `PickedImage` onto the
(unchanged) flat `slide.content` storage model. Call sites own the URL write —
single-image stores a string at `content[key]`, multi-image pushes into an
array, the inline popover mutates an item — and delegate the rest:

- `applyAltFromPick(...)` — seeds alt buffers. An `alts` map wins (active +
  other language); otherwise a single `alt` seed fills active + English + other.
- `applyPickMeta(...)` — writes the caption/credit (only when the field opted in
  and its caption is empty) and keeps the provider id in lock-step with the URL:
  a provider that supplies one sets it, any other pick clears it (so a native
  URL never carries a dangling ImageKit `imagekitFileId`).

## Adding a provider (fork or upstream)

1. Write an adapter that returns `{ id, label, open(opts) }` and maps your
   picker's result to `PickedImage`.
2. Register it in `createImagePickerSeam` (or inject its raw opener and add a
   branch there), gated on your own feature flag.
3. Nothing at the call sites changes — every current and future image entry
   point inherits it.

The persisted slide shape stays backward compatible; a migration to a nested
media object would be a separate, later decision.

## Not yet done

A first-class S3-compatible media-library provider upstream (browse + upload +
tags/alt against `server/media/interface.js`) is a deliberate follow-up, not
part of this seam. See the open briefing in `_meta/`.
