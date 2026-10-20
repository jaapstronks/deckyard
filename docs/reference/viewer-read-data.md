# Presentation data for readers

Internal `GET /api/presentations/:id` (including `?lang=`), public v1 `GET /api/v1/presentations/:id` and its single-slide GET, MCP `get_presentation`, `preview_slide` and `preview_presentation`, and share-link verify/render use the same reader projection.

MCP `validate_presentation` and `analyze_presentation` also consume this projection, so validation and AI suggestions cannot inspect slides outside the reader audience.

A reader without deck-write rights receives no slides with `visibility.hideFromViewers`. Each delivered slide omits `notes`, `_aiReasoning`, `_aiAlternatives` and `_aiWarnings`. This applies to the main `slides` list and every slide list in `i18n.versions`, including languages other than the active language. Draft slides remain visible and carry `_isDraft: true`; the separate `hideInPresentation`, `hideInPublished` and `hideInExport` flags do not hide a collaborator slide.

The server determines the audience from the actor's deck rights. Owners and edit collaborators retain author data, including when their API key has only `read` permission. The key still limits which operations they can perform. Trusted local MCP sessions retain their existing author access. Storage, author loaders and collaboration documents are not projected or modified.

Positional slide links are pinned to stable slide ids against each language's original list before filtering, using the deck organization's type registry. Removing a slide therefore cannot redirect a link to another slide. A link to a removed target cannot resolve within the delivered list. MCP indices, counts and preview ranges all address that same delivered list.

Share links always use the reader audience, for both view and comment permissions and after password verification where required. The share response keeps its existing base-language-only contract; a language query does not create a translation endpoint. Share rendering refuses an id outside the projected list. When the live feature is disabled, share output also omits live-only slide types, in every carried list.

Follow-along uses the same private-field removal and also excludes slides with `hideInPresentation`. A slide marked with either `hideFromViewers` or `hideInPresentation` is absent from the audience payload and cannot be server-rendered there. A missing or incomplete translation returns the existing translating response with no deck. Live state, SSE and interaction reads expose only a slide in the requested language's projected list. A hidden current slide has an empty `slideId`, index `-1`, no interaction, and a neutral waiting view; the audience counter uses the projected list. The presenter and notes companion keep their author view.

## Implementation boundary

This contract currently covers the JSON, MCP and follow-along surfaces named above. Reader exports (including queued jobs and notes-only downloads) and published/OG/thumbnail previews require separate projection work. Their existing behavior must not be interpreted as satisfying this contract. Published visibility and export visibility remain distinct channel policies; this change does not redefine them.

See [authentication and sessions](auth-and-sessions.md), [MCP server](mcp-server.md), and the [public API schema](../openapi.yaml).
