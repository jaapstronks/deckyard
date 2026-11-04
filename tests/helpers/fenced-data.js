/**
 * The text a prompt fenced with `untrustedData()`, for a fake model that reads
 * its request the way the real one does.
 *
 * @param {string} prompt
 * @returns {string} The first fenced block, without its tags.
 */
export function fencedData(prompt) {
  const match = /<untrusted-data>\n([\s\S]*?)\n<\/untrusted-data>/.exec(prompt);
  if (!match) throw new Error('The prompt has no untrusted-data fence.');
  return match[1];
}
