/**
 * The storage `reason` vocabulary — the one place a reason code is minted.
 *
 * A storage mutation signals failure with `{ ok: false, reason }`
 * (`docs/reference/storage-layer.md` § *Failure signalling*). `reason` is a
 * short snake_case token, and **every token a route can ever see is listed
 * here**, with the HTTP status it answers and whose fault it names.
 *
 * Before this register the statuses lived in an `ERROR_STATUS_MAP` that covered
 * 23 of the 91 codes the layer actually mints; the other 68 fell through to a
 * `400` default, so `create_failed` — our insert returning nothing — reached
 * the client as *"your request was malformed"* and never showed up on a
 * dashboard watching 5xx. The default is gone: an unknown reason is our
 * vocabulary failing, not the caller's request, and it is treated as such
 * (`getErrorStatus` in `server/utils/http.js`).
 *
 * ## The two fields
 *
 * - **`status`** — the HTTP status this reason answers with. One reason, one
 *   status, everywhere; a route never picks its own.
 * - **`kind`** — `'caller'` when the request is at fault (4xx), `'ours'` when
 *   the server is (5xx). It is not derivable from the status in the other
 *   direction only by accident: it states the intent, and the gate in
 *   `tests/storage-reason-vocabulary.test.js` holds the two consistent.
 *
 * ## Adding one
 *
 * Reach for the layer-wide vocabulary first — `not_found`, `invalid`,
 * `forbidden`, `unavailable` — and mint a domain code only when a route or UI
 * acts on the distinction. A *second spelling* for a meaning that already has
 * one is not a new code; it is drift, and the gate refuses it as an unknown
 * reason the moment it appears in `server/storage/**`.
 *
 * @module server/storage/reasons
 */

/**
 * @typedef {'caller' | 'ours'} ReasonKind
 * @typedef {{ status: number, kind: ReasonKind }} ReasonEntry
 */

/** @type {Readonly<Record<string, ReasonEntry>>} */
export const REASONS = Object.freeze(
  /** @type {const} */ ({
    // ─── ours: the server failed, and it must read as 5xx ──────────────────
    //
    // Telling a client its request is malformed when our insert failed sends it
    // off to fix something that is not broken, and hides the outage from every
    // error dashboard that watches 5xx.
    unavailable: { status: 503, kind: 'ours' }, // the withDbGuard fallback
    database_error: { status: 500, kind: 'ours' },
    create_failed: { status: 500, kind: 'ours' },
    update_failed: { status: 500, kind: 'ours' },
    write_failed: { status: 500, kind: 'ours' },

    // ─── 429 ────────────────────────────────────────────────────────────────
    rate_limited: { status: 429, kind: 'caller' },

    // ─── 410 Gone: the thing existed and deliberately does not any more ─────
    revoked: { status: 410, kind: 'caller' },
    expired: { status: 410, kind: 'caller' },
    share_link_expired: { status: 410, kind: 'caller' },
    share_link_revoked: { status: 410, kind: 'caller' },
    token_expired: { status: 410, kind: 'caller' },
    max_uses_exceeded: { status: 410, kind: 'caller' },

    // ─── 409 Conflict ───────────────────────────────────────────────────────
    //
    // Two shapes, one status: the resource is already in the requested state
    // (a second vote, an invite that already went out), or it refuses the
    // transition (a closed poll, a lock someone else holds, the last owner).
    already_exists: { status: 409, kind: 'caller' },
    already_activated: { status: 409, kind: 'caller' },
    already_invited: { status: 409, kind: 'caller' },
    already_member: { status: 409, kind: 'caller' },
    already_voted: { status: 409, kind: 'caller' },
    slug_exists: { status: 409, kind: 'caller' },
    slug_taken: { status: 409, kind: 'caller' },
    variant_exists: { status: 409, kind: 'caller' },
    closed: { status: 409, kind: 'caller' },
    disabled: { status: 409, kind: 'caller' },
    held: { status: 409, kind: 'caller' },
    inactive: { status: 409, kind: 'caller' },
    locked: { status: 409, kind: 'caller' },
    last_owner: { status: 409, kind: 'caller' },
    limit_exceeded: { status: 409, kind: 'caller' },
    order_mismatch: { status: 409, kind: 'caller' },

    // ─── 404 Not Found ──────────────────────────────────────────────────────
    not_found: { status: 404, kind: 'caller' },
    share_link_not_found: { status: 404, kind: 'caller' },
    slide_not_found: { status: 404, kind: 'caller' },
    parent_not_found: { status: 404, kind: 'caller' },
    no_live_session: { status: 404, kind: 'caller' },

    // Combined not-found/already-in-state reasons. Storage answers these from a
    // single conditional UPDATE and deliberately does not distinguish "gone"
    // from "already in that state" (splitting would need a second, racy query).
    // The statuses differ on purpose and are pinned here as the explicit
    // exception: revoking is a DELETE-shaped call where a missing key is a 404;
    // resolve/dismiss/reopen are transition-shaped calls where the combined
    // reason is the caller's request failing, hence 400.
    not_found_or_already_revoked: { status: 404, kind: 'caller' },
    not_found_or_already_resolved: { status: 400, kind: 'caller' },
    not_found_or_already_handled: { status: 400, kind: 'caller' },
    not_found_or_not_resolved: { status: 400, kind: 'caller' },

    // ─── 403 Forbidden: the row exists, this actor may not touch it ─────────
    forbidden: { status: 403, kind: 'caller' },
    not_invited: { status: 403, kind: 'caller' },
    not_member: { status: 403, kind: 'caller' },
    not_owner: { status: 403, kind: 'caller' },
    not_provisioned: { status: 403, kind: 'caller' }, // SSO, auto-provision off
    // Not a state conflict that could resolve: the default organization is
    // undeletable by rule, for everyone. The delete route already answered 403.
    cannot_delete_default: { status: 403, kind: 'caller' },
    own_question: { status: 403, kind: 'caller' },

    // ─── 401 Unauthorized: the credential is missing or does not hold ───────
    password_required: { status: 401, kind: 'caller' },
    invalid_password: { status: 401, kind: 'caller' },
    invalid_token: { status: 401, kind: 'caller' },
    invalid_or_expired: { status: 401, kind: 'caller' },
    invalid_or_revoked: { status: 401, kind: 'caller' },

    // ─── 400 Bad Request: the input is malformed or incomplete ──────────────
    invalid: { status: 400, kind: 'caller' },
    invalid_category: { status: 400, kind: 'caller' },
    invalid_colors: { status: 400, kind: 'caller' },
    invalid_contact: { status: 400, kind: 'caller' },
    invalid_email: { status: 400, kind: 'caller' },
    invalid_fields: { status: 400, kind: 'caller' },
    invalid_fonts: { status: 400, kind: 'caller' },
    invalid_format: { status: 400, kind: 'caller' },
    invalid_id: { status: 400, kind: 'caller' },
    invalid_label: { status: 400, kind: 'caller' },
    invalid_level: { status: 400, kind: 'caller' },
    invalid_name: { status: 400, kind: 'caller' },
    invalid_new_owner: { status: 400, kind: 'caller' },
    invalid_order: { status: 400, kind: 'caller' },
    invalid_params: { status: 400, kind: 'caller' },
    invalid_permission: { status: 400, kind: 'caller' },
    invalid_permissions: { status: 400, kind: 'caller' },
    invalid_presentation: { status: 400, kind: 'caller' },
    invalid_registration_mode: { status: 400, kind: 'caller' },
    invalid_role: { status: 400, kind: 'caller' },
    invalid_slide_index: { status: 400, kind: 'caller' },
    invalid_slug: { status: 400, kind: 'caller' },
    invalid_source: { status: 400, kind: 'caller' },
    invalid_style: { status: 400, kind: 'caller' },
    invalid_weight: { status: 400, kind: 'caller' },
    api_key_id_required: { status: 400, kind: 'caller' },
    key_id_required: { status: 400, kind: 'caller' },
    name_required: { status: 400, kind: 'caller' },
    slide_type_required: { status: 400, kind: 'caller' },
    missing_author: { status: 400, kind: 'caller' },
    missing_presentation_id: { status: 400, kind: 'caller' },
    missing_question_id: { status: 400, kind: 'caller' },
    missing_session_id: { status: 400, kind: 'caller' },
    missing_slide_id: { status: 400, kind: 'caller' },
    missing_text: { status: 400, kind: 'caller' },
    missing_voter: { status: 400, kind: 'caller' },
    bad_action: { status: 400, kind: 'caller' },
    consent_required: { status: 400, kind: 'caller' },
    no_updates: { status: 400, kind: 'caller' },
    too_long: { status: 400, kind: 'caller' },
    too_short: { status: 400, kind: 'caller' },
    // Minted by the shared usage validator (shared/slide-types/usage.js) and
    // handed straight back by createCustomSlideType / updateCustomSlideType.
    invalid_usage: { status: 400, kind: 'caller' },
    usage_too_long: { status: 400, kind: 'caller' },
    user_not_found: { status: 400, kind: 'caller' },
  }),
);

/**
 * Is `code` a reason in the vocabulary?
 *
 * `hasOwn`, not truthiness: a bare property read would answer `Object`'s
 * inherited members (`constructor`, `toString`) with a function.
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function isReason(code) {
  return typeof code === 'string' && Object.hasOwn(REASONS, code);
}

/**
 * The register entry for `code`, or `undefined` when it is not a reason.
 *
 * @param {unknown} code
 * @returns {ReasonEntry | undefined}
 */
export function reasonEntry(code) {
  return isReason(code) ? REASONS[/** @type {string} */ (code)] : undefined;
}

/**
 * Every reason code, sorted. For gates and docs generation.
 *
 * @returns {string[]}
 */
export function reasonCodes() {
  return Object.keys(REASONS).sort();
}
