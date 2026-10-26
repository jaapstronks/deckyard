/** Home with fictional example decks; run against a clean capture database. */
import { seedCreationView } from './_creation-view-shots.js';
import { clearMarketingDecks } from './_marketing-deck.js';

export default {
  id: 'dashboard-home-new',
  output: 'dashboard-home-new.png',
  registryPath: 'public/images/screenshots/dashboard-home-new.png',
  async state(api) {
    await clearMarketingDecks(api);
    return seedCreationView(api);
  },
  navigate: '/',
  waitFor: '.sidebar-new-btn',
  async action(page) {
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Quarterly product review') &&
        document.body.innerText.includes('Product launch overview'),
    );
    await page.waitForFunction(
      () => {
        const images = [
          ...document.querySelectorAll('.presentation-card .thumb-img'),
        ];
        return (
          images.length === 2 &&
          images.every((img) => img.complete && img.naturalWidth > 0)
        );
      },
      { timeout: 30_000 },
    );
  },
};
