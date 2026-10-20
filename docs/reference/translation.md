# Translation in Deckyard

The editor's translation view is the place to translate a deck by hand or accept AI suggestions. Open it from the language menu or a slide's context menu. Adding a language creates an empty text version, switches to it and opens the view with that language as the target. Existing text in another version is never overwritten by opening the view.

## View model and writes

The view pairs a source and target language. It defaults to the deck's `i18n.dominant` language as source; when opened after adding a language, the new language is the target. Both columns are editable. The deck title and slide text rows come from `slideTextRows` in `shared/i18n-progress.js`, the same field walk used by `computeMissingTranslation`; nested `items` text is included. Presentational fields and notes are outside this walk. A slide present in only one version is shown as such, without offering a text write to a nonexistent counterpart.

The empty-fields filter keeps rows with nonempty source text and empty target text. The slide index follows the filter and shows each slide's completeness; selecting a slide goes through the editor's lock-aware selection seam. A locked slide remains readable but cannot be edited. The view waits for a live collaborative document before enabling writes, observes remote changes outside the focused field, and removes its subscription when closed.

Both editable columns use `writeVersionText` in `client/views/editor/version-text.js`. In collaborative editing this writes the language's Y.Text through the binder; in legacy editing it writes the matching version buffer and marks that language dirty. An AI suggestion is a preview returned per slide by `/api/presentations/:id/translate/fields`; it changes no deck text until accepted. Bulk acceptance applies only to empty targets. A filled target requires acceptance of that field's own suggestion. Before acceptance the view rechecks the source and target snapshot, so a stale suggestion cannot silently replace a newer edit. AI controls are absent when AI is disabled; manual editing remains available.

## Field status and provenance

`shared/translation-provenance.js` defines one field key, `JSON.stringify([slideId || null, path])`, where `['title']` addresses the deck title. The target version may hold `translationSources[fieldKey] = { lang, hash }`. The hash is FNV-1a 64-bit over the source text's exact UTF-16 code units. It detects a changed source; it is not a signature or a review flag. Schema version 23 permits this optional map without backfilling older decks. The collaborative document stores the records in `meta.translationSources` by target language and field key.

| Status         | Rule                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Empty          | Source has text; target does not.                                                               |
| Same as source | Both nonempty texts are identical.                                                              |
| Source changed | A record for the selected source language exists, but its hash differs from the current source. |
| Current        | The stored source hash matches.                                                                 |
| No history     | Both texts exist without a record for the selected source language.                             |

Status is derived on read. `writeVersionText` stamps the target field when a suggestion is accepted with `sourceLang`; ordinary edits do not pretend to be accepted translations. The shared `recordTranslatedVersion` seam stamps fields actually translated by the server's whole-deck paths, preserving provenance for previously filled targets when filling gaps. The internal translate routes and worker use the translation service. Existing records survive collaborative projection and ordinary saves.

## API and MCP

The editor's proposal endpoint returns suggested field values without writing them. Internal `POST /api/presentations/:id/translate` and `/translate/missing` use the translation service to write directly; their whole-deck token limit has a separate planned fix (B284). Public v1 `POST /presentations/{id}/translate` also writes a version directly, with `targetLang`, optional `sourceLang`, `overwrite` and `fillMissing` as documented in `docs/openapi.yaml`. These direct API operations remain available and record source provenance for translated fields. MCP has no translation tool; ordinary MCP deck and slide edits are content writes, not accepted translation proposals.
