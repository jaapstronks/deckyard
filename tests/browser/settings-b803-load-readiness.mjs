/** Run against the local dev server with AUTH_DEV_BYPASS=true. All settings writes are intercepted. */
/* global process, console, setTimeout, URL, document */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = process.env.DECKYARD_URL || 'http://127.0.0.1:4277';
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_BIN ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});

const themeId = '11111111-1111-4111-8111-111111111111';

async function until(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

const cases = [
  {
    tab: 'organization',
    get: '/api/settings/organization',
    selector: '.themes-workspace-card .settings-policy-actions button',
    loaded: { defaultThemeId: themeId, enabledThemes: [themeId] },
    expected: { defaultThemeId: themeId, enabledThemes: [themeId] },
  },
  {
    tab: 'organization',
    get: '/api/settings/organization',
    selector:
      '#settings-tab-organization section.stack.editor-card:last-child .settings-policy-actions button',
    loaded: {
      rss: {
        enabled: true,
        title: 'Existing feed',
        maxItems: 23,
        language: 'en',
      },
    },
    expected: { rss: { enabled: true, title: 'Existing feed', maxItems: 23 } },
  },
  {
    tab: 'email',
    get: '/api/settings/app',
    selector: '#settings-tab-email .settings-policy-actions button',
    loaded: {
      emailSender: { email: 'existing@example.com', name: 'Existing' },
    },
    expected: {
      emailSender: { email: 'existing@example.com', name: 'Existing' },
    },
  },
  {
    tab: 'integrations',
    get: '/api/settings/app',
    selector: '#settings-tab-integrations .settings-policy-actions button',
    loaded: { webhooks: { signingSecret: 'existing-secret' } },
    expected: { webhooks: { signingSecret: 'existing-secret' } },
  },
];

try {
  for (const testCase of cases) {
    const page = await browser.newPage();
    const held = [];
    const writes = [];
    await page.goto(`${base}/settings?locale=nl#account`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#settings-tab-account.is-active');
    await page.evaluate(async () => {
      const { invalidateSettingsCache } =
        await import('/client/lib/net/settings.js');
      invalidateSettingsCache();
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === testCase.get) {
        held.push(request);
      } else if (
        ['PUT', 'PATCH'].includes(request.method()) &&
        path.startsWith('/api/settings/')
      ) {
        writes.push(JSON.parse(request.postData() || '{}'));
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: '{"settings":{}}',
        });
      } else if (path === '/api/themes' && request.method() === 'GET') {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            themes: [{ id: themeId, label: 'Classic', isDefault: true }],
            enabledThemes: [themeId],
          }),
        });
      } else request.continue();
    });
    await page.click(`.settings-sidebar [data-tab="${testCase.tab}"]`);
    await page.waitForSelector(testCase.selector);
    await until(() => held.length > 0, `${testCase.tab} GET`);
    assert.equal(
      await page.$eval(testCase.selector, (button) => button.disabled),
      true,
      `${testCase.tab} save disabled while loading`,
    );
    await page.$eval(testCase.selector, (button) => button.click());
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(writes.length, 0, `${testCase.tab} wrote before GET resolved`);
    for (const request of held.splice(0)) {
      await request.respond({
        status: 500,
        contentType: 'application/json',
        body: '{"ok":false,"error":"test_failure","message":"Load failed"}',
      });
    }
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.textContent === 'Opnieuw proberen',
      {},
      testCase.selector,
    );
    await page.setViewport({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    const retryFits = await page.$eval(testCase.selector, (button) => {
      const card = button.closest('.editor-card') || button.parentElement;
      return (
        button.scrollWidth <= button.clientWidth + 1 &&
        button.getBoundingClientRect().right <=
          card.getBoundingClientRect().right + 1
      );
    });
    assert.equal(
      retryFits,
      true,
      `${testCase.tab} Dutch Retry label fits at 320px / 200%`,
    );
    if (testCase.tab === 'email') {
      await page.screenshot({
        path: '.scratch/b803-retry-nl-320-zoom200.png',
        fullPage: true,
      });
    }
    await page.$eval(testCase.selector, (button) => button.click());
    await until(() => held.length > 0, `${testCase.tab} retry GET`);
    assert.equal(writes.length, 0, `${testCase.tab} retry caused a write`);
    for (const request of held.splice(0)) {
      await request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: testCase.loaded }),
      });
    }
    await page.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        return button && !button.disabled && button.textContent === 'Opslaan';
      },
      {},
      testCase.selector,
    );
    await page.$eval(testCase.selector, (button) => button.click());
    await until(() => writes.length > 0, `${testCase.tab} save`);
    for (const [key, value] of Object.entries(testCase.expected)) {
      for (const [field, expected] of Object.entries(
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : { value },
      )) {
        const actual =
          field === 'value' ? writes[0][key] : writes[0][key]?.[field];
        assert.deepEqual(
          actual,
          expected,
          `${testCase.tab} retained ${key}.${field}`,
        );
      }
    }
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}/settings?locale=nl#organization`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(
    '#settings-tab-organization textarea[name="styleByLanguage.nl"]',
  );
  await page.$eval(
    '#settings-tab-organization textarea[name="styleByLanguage.nl"]',
    (input) => {
      input.value = 'Keep this draft';
    },
  );
  await page.evaluate(async () => {
    const { setSupportedLangs } = await import('/client/lib/format/i18n.js');
    setSupportedLangs(['nl', 'de']);
  });
  await page.click('.settings-sidebar [data-tab="account"]');
  await page.click('.settings-sidebar [data-tab="organization"]');
  assert.deepEqual(
    await page.$$eval(
      '#settings-tab-organization textarea[name^="styleByLanguage."]',
      (inputs) => inputs.map((input) => [input.name, input.value]),
    ),
    [
      ['styleByLanguage.nl', 'Keep this draft'],
      ['styleByLanguage.de', ''],
    ],
    'reopening Organization syncs the language list and retains draft text',
  );
  await page.close();
  console.log(
    'B803 load readiness: delayed GET, failed GET, retry, retained saves, and language sync passed.',
  );
} finally {
  await browser.close();
}
