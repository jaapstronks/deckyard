/**
 * A deck through the real publish seam, without a runner: `prepareEditionInput`
 * seals what the public may see, the bundle's render entry turns that into the
 * canvas and the reader. A test about what a published page leaves out reads
 * these documents, because this is the only route that builds one.
 */
import { prepareEditionInput } from '../../server/export/edition-input.js';
import { renderEdition } from '../../server/render/renderer-bundle/bundle/entry.js';

const LOGO =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';

/** Its logo is inline and it names no fonts: the seal asks nothing of the checkout. */
const CLOSED_THEME = Object.freeze({
  id: 'edition-documents-theme',
  label: 'Closed',
  cssVars: { '--t-accent': '#13393a', '--t-logo-url': `url('${LOGO}')` },
  assets: { logo: LOGO },
});

/**
 * @param {object} pres - The deck as stored
 * @param {string} [repoRoot]
 * @returns {Promise<{canvas: string, reader: string}>}
 */
export async function renderPublishedDocuments(pres, repoRoot = process.cwd()) {
  const { inputBytes } = await prepareEditionInput(repoRoot, pres, {
    theme: CLOSED_THEME,
  });
  return renderEdition(repoRoot, JSON.parse(inputBytes.toString('utf8')));
}
