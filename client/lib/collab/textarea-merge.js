/**
 * Caret-preserving remote updates for a plain <textarea> (live collab).
 *
 * When a remote collaborator's edit changes the value behind a textarea the
 * local user is focused in, simply skipping the refresh makes the field go
 * stale (and the user's next keystroke would write the stale whole value
 * back, deleting the remote edit — field-level LWW). Because a textarea is
 * plain text, we can do better than both options: swap in the new value and
 * remap the caret/selection across the changed region, so two people can
 * genuinely co-type in the same textarea.
 *
 * The remap uses the same common prefix/suffix diff the Y.Text patching
 * uses: positions before the changed region keep their offset, positions
 * after it shift by the length delta, and a position inside the replaced
 * region clamps to the end of the replacement.
 */

/**
 * Map a selection offset in `cur` onto the equivalent offset in `next`.
 *
 * @param {string} cur - The textarea's current value
 * @param {string} next - The incoming (merged) value
 * @param {number} pos - Selection offset within `cur`
 * @returns {number} Equivalent offset within `next`
 */
export function remapOffset(cur, next, pos) {
  const c = String(cur ?? '');
  const n = String(next ?? '');
  const minLen = Math.min(c.length, n.length);
  let start = 0;
  while (start < minLen && c[start] === n[start]) start += 1;
  let endCur = c.length;
  let endNext = n.length;
  while (endCur > start && endNext > start && c[endCur - 1] === n[endNext - 1]) {
    endCur -= 1;
    endNext -= 1;
  }
  const p = Math.max(0, Math.min(Number(pos) || 0, c.length));
  if (p <= start) return p;
  if (p >= endCur) return p + (endNext - endCur);
  // Inside the replaced region: land at the end of the replacement.
  return endNext;
}

/**
 * Apply a remote value to a textarea, preserving caret/selection and scroll.
 * No-op when the value is already current. Safe to call whether or not the
 * textarea has focus (selection APIs work either way).
 *
 * @param {HTMLTextAreaElement} ta
 * @param {string} next - The incoming value
 * @returns {boolean} true when the value changed
 */
export function applyRemoteTextareaValue(ta, next) {
  if (!ta) return false;
  const value = String(next ?? '');
  const cur = ta.value;
  if (cur === value) return false;
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const { scrollTop } = ta;
  ta.value = value;
  try {
    ta.setSelectionRange(remapOffset(cur, value, selStart), remapOffset(cur, value, selEnd));
  } catch {
    // Selection APIs can throw on detached/hidden elements; the value is set.
  }
  ta.scrollTop = scrollTop;
  return true;
}
