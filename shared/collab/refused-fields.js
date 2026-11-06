/**
 * The collab store's refused fields, as one stateless message (DY-856).
 *
 * A collab store holds back a value the field validation refuses: the doc
 * keeps it, the deck JSON keeps the stored value. Every peer sees the value in
 * its editor, so every peer is told which field did not save, also a peer
 * that connects later. The message names where and why, never the value.
 *
 * The server sends the whole current set whenever it changes and once to each
 * new connection, so a client replaces what it showed; an empty set clears it.
 */

/** The stateless message type; anything else on the channel is not ours. */
export const REFUSED_FIELDS_MESSAGE = 'deckyard:refused-fields';

/**
 * @typedef {Object} RefusedField
 * @property {string} slideId
 * @property {string} field
 * @property {Array<number|string>} path - Empty for the field itself.
 * @property {string[]} errors
 * @property {string} [lang] - The language version the refusal was found in.
 */

/**
 * One entry per place: a value shared by the language versions is refused in
 * each of them, and a peer has one field to correct. The first language wins,
 * which is the active one (the store validates it first).
 * @param {Array<RefusedField & {value?: unknown, kind?: string}>} refused
 * @returns {RefusedField[]}
 */
export function refusedFieldsForPeers(refused) {
  const seen = new Set();
  const fields = [];
  for (const { slideId, field, path = [], errors = [], lang } of refused) {
    const key = JSON.stringify([slideId, field, path]);
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({
      slideId,
      field,
      path,
      errors,
      ...(lang ? { lang } : {}),
    });
  }
  return fields;
}

/**
 * @param {RefusedField[]} fields
 * @returns {string}
 */
export function encodeRefusedFields(fields) {
  return JSON.stringify({ type: REFUSED_FIELDS_MESSAGE, fields });
}

/**
 * The refused fields in a stateless payload, or `null` when the payload is not
 * this message. A malformed entry is dropped, never shown half.
 * @param {unknown} payload
 * @returns {RefusedField[]|null}
 */
export function decodeRefusedFields(payload) {
  let message;
  try {
    message = JSON.parse(String(payload));
  } catch {
    return null;
  }
  if (message?.type !== REFUSED_FIELDS_MESSAGE) return null;
  if (!Array.isArray(message.fields)) return [];
  return message.fields.filter(
    (f) =>
      typeof f?.slideId === 'string' &&
      typeof f.field === 'string' &&
      Array.isArray(f.path) &&
      Array.isArray(f.errors) &&
      f.errors.every((e) => typeof e === 'string'),
  );
}
