/** The portable and stored spelling of extension provenance (D240). */
export function validExtensions(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (name) =>
        typeof name === 'string' && name.trim() === name && name.length > 0,
    ) &&
    value.every((name, index) => index === 0 || value[index - 1] < name)
  );
}

/** Merge the received names with this installation's name. */
export function extensionNames(received = [], current = null) {
  if (!validExtensions(received))
    throw new Error('extensions must be a sorted unique list of names');
  return [...new Set(current ? [...received, current] : received)].sort();
}
