/** The current export dialog; the published image keeps its existing name. */
import editor from './editor-full.js';
import { TALL_PANE_VIEWPORT } from '../lib/browser.js';

export default {
  ...editor,
  id: 'export-dropdown-full',
  output: 'export-dropdown-full.png',
  registryPath: 'public/images/screenshots/export-dropdown-full.png',
  viewport: TALL_PANE_VIEWPORT,
  clip: '.modal.export-modal',
  async action(page, ctx) {
    await editor.action(page, ctx);
    await page.click('.topbar > button[title="Export to file"]');
    await page.waitForSelector('.export-modal .export-format-row', {
      visible: true,
    });
  },
};
