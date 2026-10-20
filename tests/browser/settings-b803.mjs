/** B803 browser gate. Run with the local dev server on port 4277 and AUTH_DEV_BYPASS=true. */
/* global process, console, setTimeout, URL, document */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const base = process.env.DECKYARD_URL || 'http://127.0.0.1:4277';
const output = process.env.B803_SCREENSHOTS || '.scratch';
const chrome =
  process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (err) => console.error('Browser error:', err.message));
const mutations = [];
let denyOrganizationSave = false;
async function waitForMutation() {
  const started = Date.now();
  while (mutations.length === 0 && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(mutations.length > 0, 'expected a settings mutation');
}
await page.setRequestInterception(true);
page.on('request', (request) => {
  if (
    ['PUT', 'PATCH'].includes(request.method()) &&
    request.url().includes('/api/settings/')
  ) {
    mutations.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      body: JSON.parse(request.postData() || '{}'),
    });
    const denied =
      denyOrganizationSave &&
      request.url().includes('/api/settings/organization');
    request.respond({
      status: denied ? 403 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        denied
          ? { ok: false, error: 'forbidden', message: 'Denied test' }
          : { settings: {} },
      ),
    });
  } else request.continue();
});

async function open(tab, locale = 'en') {
  await page.goto(`${base}/settings?locale=${locale}#${tab}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(`#settings-tab-${tab}.is-active`);
  if (tab === 'email')
    await page.waitForSelector('#settings-tab-email .email-templates-panel');
  if (tab === 'api-keys')
    await page.waitForSelector('#settings-tab-api-keys .api-keys-card');
  if (tab === 'organization')
    await page.waitForSelector(
      '#settings-tab-organization .themes-workspace-card',
    );
}

for (const tab of [
  'account',
  'preferences',
  'export',
  'api-keys',
  'organization',
  'fonts',
  'themes',
  'slide-types',
  'admin',
  'users',
  'email',
  'integrations',
  'analytics',
  'health',
]) {
  await open(tab);
}

for (const locale of ['en', 'nl']) {
  for (const width of [1280, 320]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    for (const tab of [
      'organization',
      'email',
      'integrations',
      'themes',
      'preferences',
      'api-keys',
    ]) {
      await open(tab, locale);
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      const state = await page.evaluate((key) => {
        const selectors = {
          organization: '#settings-tab-organization .editor-card button',
          email:
            '#settings-tab-email .settings-policy-actions button, #settings-tab-email .email-templates-panel button',
          integrations:
            '#settings-tab-integrations .settings-policy-actions button',
          themes: '#settings-tab-themes .themes-list-header .btn',
          preferences: '#settings-tab-preferences .settings-compact-control',
          'api-keys': '#settings-tab-api-keys .api-keys-card button',
        };
        return {
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          controls: [...document.querySelectorAll(selectors[key])]
            .filter((control) => control.getClientRects().length)
            .map((control) => ({
              label: control.innerText.trim(),
              clipped:
                control.scrollWidth > control.clientWidth + 1 &&
                control.tagName === 'BUTTON',
              heightCss: control.getBoundingClientRect().height / 2,
              widthCss: control.getBoundingClientRect().width / 2,
              button: control.tagName === 'BUTTON',
            })),
        };
      }, tab);
      assert.equal(
        state.overflow,
        false,
        `${locale} ${width}px ${tab} must not overflow the page`,
      );
      for (const control of state.controls.filter((item) => item.button)) {
        assert.ok(
          control.label,
          `${locale} ${width}px ${tab} button needs a label`,
        );
        assert.equal(
          control.clipped,
          false,
          `${locale} ${width}px ${tab} clipped ${control.label}`,
        );
        assert.ok(
          control.heightCss >= 44 && control.widthCss >= 44,
          `${locale} ${width}px ${tab} touch target ${control.label}`,
        );
      }
      if (tab === 'organization' || (width === 320 && locale === 'nl')) {
        await page.screenshot({
          path: `${output}/b803-${tab}-${locale}-${width}-zoom200.png`,
          fullPage: true,
        });
      }
    }
  }
}

await page.setViewport({ width: 1280, height: 900 });
await open('organization');
await page.waitForSelector(
  '#settings-tab-organization .themes-workspace-card select',
);
await page.click('#settings-tab-organization .themes-workspace-card button');
await waitForMutation();
assert.deepEqual(
  mutations.map((item) => item.path),
  ['/api/settings/organization'],
);
assert.deepEqual(Object.keys(mutations[0].body).sort(), [
  'defaultThemeId',
  'enabledThemes',
]);
mutations.length = 0;

await page.click(
  '#settings-tab-organization section.stack.editor-card:last-child .settings-policy-actions button',
);
await waitForMutation();
assert.deepEqual(
  mutations.map((item) => item.path),
  ['/api/settings/organization'],
);
assert.deepEqual(Object.keys(mutations[0].body), ['rss']);
await page.waitForFunction(
  () =>
    !document.querySelector(
      '#settings-tab-organization section.stack.editor-card:last-child .settings-policy-actions button',
    ).disabled,
);
mutations.length = 0;

denyOrganizationSave = true;
await page.evaluate(() =>
  document
    .querySelector(
      '#settings-tab-organization section.stack.editor-card:last-child .settings-policy-actions button',
    )
    .click(),
);
await waitForMutation();
assert.deepEqual(
  mutations.map((item) => item.path),
  ['/api/settings/organization'],
);
await page.waitForFunction(() =>
  document
    .querySelector('#settings-tab-organization')
    ?.textContent.includes('Denied test'),
);
mutations.length = 0;
denyOrganizationSave = false;

await open('integrations');
// A hash-only goto stays in the same document since B805, so the section
// loads after it becomes active; Save is usable once that load settled.
await page.waitForFunction(
  () =>
    !document.querySelector(
      '#settings-tab-integrations .settings-policy-actions button',
    ).disabled,
);
await page.evaluate(() =>
  document
    .querySelector('#settings-tab-integrations .settings-policy-actions button')
    .click(),
);
await waitForMutation();
assert.deepEqual(
  mutations.map((item) => item.path),
  ['/api/settings/app'],
);
assert.deepEqual(Object.keys(mutations[0].body), ['webhooks']);
mutations.length = 0;

await open('email');
// A hash-only goto stays in the same document since B805, so the section
// loads after it becomes active; Save is usable once that load settled.
await page.waitForFunction(
  () =>
    !document.querySelector(
      '#settings-tab-email .settings-policy-actions button',
    ).disabled,
);
await page.evaluate(() =>
  document
    .querySelector('#settings-tab-email .settings-policy-actions button')
    .click(),
);
await waitForMutation();
assert.deepEqual(
  mutations.map((item) => item.path),
  ['/api/settings/app'],
);
assert.deepEqual(Object.keys(mutations[0].body), ['emailSender']);

console.log(
  'B803 browser gate: EN/NL at 320/1280 with 200% zoom, touch targets, and isolated saves passed.',
);
if (process.env.DECKYARD_MULTI_ORG_URL) {
  await page.goto(
    `${process.env.DECKYARD_MULTI_ORG_URL}/settings?locale=nl#organization`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForSelector(
    '#settings-tab-organization.is-active .organization-profile-card',
  );
  assert.ok(await page.$('#settings-tab-organization .themes-workspace-card'));
  assert.ok(await page.$('.settings-sidebar [data-tab="users"]'));
  console.log(
    'B803 multi-organization browser gate: profile, policy and members passed.',
  );
}
await browser.close();
