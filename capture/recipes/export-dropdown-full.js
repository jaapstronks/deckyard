/** The current export dialog; the published image keeps its existing name. */
import editor from './editor-full.js';
import { TALL_PANE_VIEWPORT } from '../lib/browser.js';

export default {
  ...editor,
  id: 'export-dropdown-full',
  output: 'export-dropdown-full.png',
  registryPath: 'public/images/screenshots/export-dropdown-full.png',
  // The content is capped at 70vh; 1200px leaves only 840px for 887px.
  viewport: { ...TALL_PANE_VIEWPORT, height: 1440 },
  clip: '.modal.export-modal',
  async action(page, ctx) {
    await editor.action(page, ctx);
    await page.click('.topbar > button[title="Export to file"]');
    await page.waitForSelector('.export-modal .export-format-row', {
      visible: true,
    });
  },
};
