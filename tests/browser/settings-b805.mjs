/** B805 browser gate. Run with the local dev server on port 4277 and AUTH_DEV_BYPASS=true. */
/* global process, console, setTimeout, URL, document, history, location, getComputedStyle, NodeFilter, Range */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const base = process.env.DECKYARD_URL || 'http://127.0.0.1:4277';
const output = process.env.B805_SCREENSHOTS || '.scratch';
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

// Settings writes are answered here, so the gate never changes the dev
// database; `deny` turns the next matching write into a refusal.
const mutations = [];
const deny = { organization: false, profileImage: false };
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  const write = ['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method());
  if (write && url.pathname === '/api/profile/image') {
    mutations.push({ path: url.pathname, method: request.method() });
    request.respond({
      status: deny.profileImage ? 500 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        deny.profileImage
          ? { ok: false, error: 'upload_failed', message: 'Upload test failed' }
          : { imageUrl: '' },
      ),
    });
    return;
  }
  if (write && url.pathname.startsWith('/api/settings/')) {
    mutations.push({
      path: url.pathname,
      method: request.method(),
      body: JSON.parse(request.postData() || '{}'),
    });
    const denied =
      deny.organization && url.pathname === '/api/settings/organization';
    request.respond({
      status: denied ? 403 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        denied
          ? { ok: false, error: 'forbidden', message: 'Curation denied test' }
          : { settings: {} },
      ),
    });
    return;
  }
  request.continue();
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = () => page.evaluate(() => location.hash);
const activeTab = () =>
  page.evaluate(
    () => document.querySelector('.settings-tab-view.is-active')?.id || '',
  );
const current = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll('.settings-sidebar [aria-current="page"]'),
    ].map((link) => link.dataset.tab),
  );
async function waitTab(key) {
  await page.waitForSelector(`#settings-tab-${key}.is-active`);
}
async function open(path, locale = 'en') {
  // A fresh document every time: a goto that only changes the hash is a
  // same-document navigation, which the unsaved-changes guard may hold.
  await page.goto('about:blank');
  await page.goto(
    `${base}${path.replace('/settings', `/settings?locale=${locale}`)}`,
    {
      waitUntil: 'domcontentloaded',
    },
  );
  await page.waitForSelector('.settings-tab-view.is-active');
}
async function clickNav(key) {
  await page.evaluate((k) => {
    document.querySelector(`.settings-sidebar a[data-tab="${k}"]`).click();
  }, key);
}

// ---------------------------------------------------------------- addresses

await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await open('/settings');
assert.equal(await hash(), '#account', '/settings falls back to Account');
await open('/settings#no-such-section');
assert.equal(await hash(), '#account', 'an unknown hash is replaced');
assert.equal(await activeTab(), 'settings-tab-account');

const navShape = await page.evaluate(() => {
  const nav = document.querySelector('.settings-sidebar');
  return {
    tag: nav.tagName,
    label: nav.getAttribute('aria-label'),
    roles: [...nav.querySelectorAll('[role]')].map((el) =>
      el.getAttribute('role'),
    ),
    links: [...nav.querySelectorAll('a[data-tab]')].map((a) =>
      a.getAttribute('href'),
    ),
    toggleShown:
      getComputedStyle(nav.querySelector('.settings-sidebar-toggle'))
        .display !== 'none',
    panelRoles: document.querySelectorAll(
      '[role="tabpanel"],[role="tab"],[role="tablist"]',
    ).length,
  };
});
assert.equal(navShape.tag, 'NAV');
assert.ok(navShape.label);
assert.deepEqual(navShape.roles, []);
assert.equal(
  navShape.links.length,
  14,
  'all registered sections for a full admin',
);
assert.ok(navShape.links.every((href) => /^#[a-z-]+$/.test(href)));
assert.equal(navShape.toggleShown, false, 'no narrow opener on desktop');
assert.equal(navShape.panelRoles, 0);
assert.deepEqual(await current(), ['account']);

// Click → history entry, focus on the section heading.
await clickNav('email');
await waitTab('email');
assert.equal(await hash(), '#email');
assert.deepEqual(await current(), ['email']);
assert.equal(
  await page.evaluate(
    () =>
      document.activeElement?.closest('#settings-tab-email') &&
      document.activeElement.tagName,
  ),
  'H2',
  'focus lands on the section heading',
);
await clickNav('integrations');
await waitTab('integrations');
await page.goBack();
await waitTab('email');
assert.deepEqual(
  await current(),
  ['email'],
  'Back restores the previous section',
);
await page.goForward();
await waitTab('integrations');
await page.reload({ waitUntil: 'domcontentloaded' });
await waitTab('integrations');
assert.deepEqual(await current(), ['integrations'], 'reload keeps the section');

// Overview is a labelled link, not the browser's Back.
const overview = await page.evaluate(() => {
  const link = document.querySelector('.settings-overview-link');
  return {
    tag: link.tagName,
    href: link.getAttribute('href'),
    text: link.innerText.trim(),
  };
});
assert.deepEqual(overview, { tag: 'A', href: '/app', text: 'Overview' });

// ---------------------------------------------------------------- keyboard

await open('/settings#account');
await page.focus('.settings-overview-link');
const reached = [];
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab');
  const tab = await page.evaluate(
    () => document.activeElement?.dataset?.tab || null,
  );
  if (tab) reached.push(tab);
  if (tab === 'health') break;
}
assert.equal(
  reached.length,
  14,
  `Tab walks every section link: ${reached.join(',')}`,
);
// Enter on a focused link switches section.
await page.focus('.settings-sidebar a[data-tab="themes"]');
await page.keyboard.press('Enter');
await waitTab('themes');
assert.equal(await hash(), '#themes');

// ---------------------------------------------------------------- curation

// Arrive by a link, so Back has a section to return to.
await open('/settings#account');
await clickNav('slide-types');
await waitTab('slide-types');
await page.waitForSelector('.slide-type-curation-card input[type="checkbox"]');
mutations.length = 0;
await page.click('.slide-type-curation-card input[type="checkbox"]');
await wait(600);
assert.equal(mutations.length, 0, 'a toggle no longer autosaves');
assert.equal(
  await page.$eval(
    '.curation-actions .settings-unsaved-status',
    (el) => el.textContent,
  ),
  'Unsaved changes',
);
const toggled = await page.$eval(
  '.slide-type-curation-card input[type="checkbox"]',
  (el) => el.checked,
);

// Leaving asks; Keep editing stays with the edit.
await clickNav('account');
await page.waitForSelector('.modal-actions');
await page.screenshot({ path: `${output}/b805-unsaved-confirm-1280.png` });
await page.evaluate(() =>
  [...document.querySelectorAll('.modal-actions button')]
    .find((b) => b.textContent === 'Keep editing')
    .click(),
);
await wait(200);
assert.equal(await activeTab(), 'settings-tab-slide-types');
assert.equal(await hash(), '#slide-types');
assert.equal(
  await page.$eval(
    '.slide-type-curation-card input[type="checkbox"]',
    (el) => el.checked,
  ),
  toggled,
  'a cancelled navigation keeps the edit',
);

// Back with an edit: same question, the address returns.
await page.evaluate(() => history.back());
await page.waitForSelector('.modal-actions');
await page.evaluate(() =>
  [...document.querySelectorAll('.modal-actions button')]
    .find((b) => b.textContent === 'Keep editing')
    .click(),
);
await wait(200);
assert.equal(
  await hash(),
  '#slide-types',
  'cancelled Back puts the address back',
);
assert.equal(await activeTab(), 'settings-tab-slide-types');

// A refused save stays inline and can be retried.
deny.organization = true;
await page.click('.curation-actions .settings-policy-actions .btn-primary');
await page.waitForFunction(() =>
  document
    .querySelector('.curation-actions .inline-error:not([hidden])')
    ?.textContent.includes('Curation denied test'),
);
await wait(4500);
assert.ok(
  await page.$eval('.curation-actions .inline-error', (el) => !el.hidden),
  'the refusal is still there after a toast would have gone',
);
assert.equal(
  await page.$eval(
    '.curation-actions .settings-unsaved-status',
    (el) => el.textContent,
  ),
  'Unsaved changes',
);
await page.screenshot({ path: `${output}/b805-curation-refused-1280.png` });
deny.organization = false;
mutations.length = 0;
await page.click('.curation-actions .settings-policy-actions .btn-primary');
await page.waitForFunction(
  () =>
    document.querySelector('.curation-actions .settings-unsaved-status')
      ?.textContent === '',
);
assert.deepEqual(
  mutations.map((m) => [m.path, Object.keys(m.body)]),
  [['/api/settings/organization', ['disabledSlideTypes']]],
);
assert.ok(
  await page.$eval('.curation-actions .inline-error', (el) => el.hidden),
  'a successful retry clears the refusal',
);

// Discard really discards and the switch goes through.
await page.click('.slide-type-curation-card input[type="checkbox"]');
await clickNav('account');
await page.waitForSelector('.modal-actions');
await page.evaluate(() =>
  [...document.querySelectorAll('.modal-actions button')]
    .find((b) => b.textContent === 'Discard changes')
    .click(),
);
await waitTab('account');

// Webhooks: labelled fields and the same guard.
await open('/settings#integrations');
await page.waitForFunction(
  () => !document.querySelector('#settings-tab-integrations input').disabled,
);
const unlabelled = await page.evaluate(
  () =>
    [
      ...document.querySelectorAll(
        '#settings-tab-integrations input, #settings-tab-email input, #settings-tab-account .settings-compact-control',
      ),
    ].filter(
      (input) => !input.labels?.length && !input.getAttribute('aria-label'),
    ).length,
);
assert.equal(unlabelled, 0, 'every webhook, sender and name field has a label');
await page.type(
  '#settings-tab-integrations input',
  'https://example.test/hook',
);
assert.equal(
  await page.$eval(
    '#settings-tab-integrations .settings-unsaved-status',
    (el) => el.textContent,
  ),
  'Unsaved changes',
);
await clickNav('email');
await page.waitForSelector('.modal-actions');
await page.keyboard.press('Escape');
await wait(200);
assert.equal(
  await activeTab(),
  'settings-tab-integrations',
  'Escape on the question keeps editing',
);
assert.match(
  await page.$eval('#settings-tab-integrations input', (el) => el.value),
  /example\.test/,
);

// Profile photo: a failed upload stays beside the photo controls.
await open('/settings#account');
deny.profileImage = true;
const input = await page.$('#settings-tab-account input[type="file"]');
const png = `${output}/b805-upload.png`;
await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 4, height: 4 } });
await input.uploadFile(png);
await page.waitForFunction(() =>
  document
    .querySelector('.profile-image-section .inline-error:not([hidden])')
    ?.textContent.includes('Upload test failed'),
);
await wait(4500);
assert.ok(
  await page.$eval('.profile-image-section .inline-error', (el) => !el.hidden),
  'the upload refusal does not pass like a toast',
);
deny.profileImage = false;

// ---------------------------------------------------------------- narrow UI gate

/**
 * Layout facts of the sidebar and the visible action groups. A word broken
 * across lines shows as one word with more than one client rect.
 */
async function layout() {
  return page.evaluate(() => {
    const zoom = Number(document.documentElement.style.zoom || 1);
    const brokenWords = (el) => {
      const broken = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const re = /\S+/g;
        let m;
        while ((m = re.exec(node.data))) {
          const range = new Range();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const lines = new Set(
            [...range.getClientRects()].map((r) => Math.round(r.top)),
          );
          if (lines.size > 1) broken.push(m[0]);
        }
      }
      return broken;
    };
    const visible = (el) => el.getClientRects().length > 0;
    const targets = [
      ...document.querySelectorAll(
        '.settings-overview-link, .settings-sidebar-toggle, .settings-sidebar a, .settings-tab-view.is-active .settings-policy-actions .btn',
      ),
    ].filter(visible);
    return {
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      hiddenTabbable: [
        ...document.querySelectorAll('.settings-sidebar a'),
      ].filter(
        (a) =>
          !visible(a) &&
          a.tabIndex >= 0 &&
          getComputedStyle(a).visibility !== 'hidden' &&
          a.offsetParent !== null,
      ).length,
      controls: targets.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.innerText.trim(),
          widthCss: r.width / zoom,
          heightCss: r.height / zoom,
          clipped: el.scrollWidth > el.clientWidth + 1,
          broken: brokenWords(el),
        };
      }),
    };
  });
}

function assertLayout(state, where) {
  assert.equal(state.overflow, false, `${where}: no horizontal overflow`);
  assert.equal(state.hiddenTabbable, 0, `${where}: no hidden tabbable links`);
  for (const c of state.controls) {
    assert.ok(c.label, `${where}: control has a label`);
    assert.equal(c.clipped, false, `${where}: ${c.label} is clipped`);
    assert.deepEqual(c.broken, [], `${where}: ${c.label} breaks mid-word`);
    assert.ok(
      c.heightCss >= 44 && c.widthCss >= 44,
      `${where}: ${c.label} touch target ${c.widthCss}x${c.heightCss}`,
    );
  }
}

// 320×800 at 100%, and 640 wide at 200% (the same 320 CSS px of room).
for (const locale of ['en', 'nl']) {
  for (const [width, zoom] of [
    [320, 1],
    [640, 2],
    [1280, 2],
  ]) {
    const where = `${locale} ${width}px zoom ${zoom * 100}%`;
    await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
    for (const tab of ['account', 'integrations', 'email', 'slide-types']) {
      await open(`/settings#${tab}`, locale);
      if (tab === 'slide-types')
        await page.waitForSelector('.curation-actions .btn-primary');
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      const narrow = await page.$eval(
        '.settings-sidebar-toggle',
        (el) => getComputedStyle(el).display !== 'none',
      );
      assertLayout(await layout(), `${where} ${tab} closed`);
      if (narrow) {
        const sectionsShown = await page.$eval(
          '.settings-sidebar-sections',
          (el) => el.getClientRects().length > 0,
        );
        assert.equal(
          sectionsShown,
          false,
          `${where}: groups folded by default`,
        );
        await page.click('.settings-sidebar-toggle');
        const open = await layout();
        assertLayout(open, `${where} ${tab} open`);
        assert.equal(
          open.controls.filter((c) => c.label && c.heightCss >= 44).length >=
            15,
          true,
          `${where}: opener plus every link visible: ${JSON.stringify(open.controls.map((c) => [c.label, Math.round(c.heightCss)]))}`,
        );
        const vertical = await page.evaluate(() => {
          const links = [...document.querySelectorAll('.settings-sidebar a')];
          return links.every(
            (a, i) =>
              i === 0 ||
              a.getBoundingClientRect().top >
                links[i - 1].getBoundingClientRect().top,
          );
        });
        assert.ok(vertical, `${where}: groups stack vertically`);
        if (tab === 'account')
          await page.screenshot({
            path: `${output}/b805-nav-open-${locale}-${width}-z${zoom * 100}.png`,
            fullPage: true,
          });
        await page.keyboard.press('Escape');
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.classList.contains(
              'settings-sidebar-toggle',
            ),
          ),
          true,
          `${where}: Escape returns focus to the opener`,
        );
        // Picking a section folds the list and moves on.
        await page.click('.settings-sidebar-toggle');
        await clickNav('preferences');
        await waitTab('preferences');
        assert.equal(
          await page.$eval('.settings-sidebar-toggle', (el) =>
            el.getAttribute('aria-expanded'),
          ),
          'false',
        );
      }
      if (tab === 'slide-types' || tab === 'integrations')
        await page.screenshot({
          path: `${output}/b805-${tab}-${locale}-${width}-z${zoom * 100}.png`,
        });
    }
  }
}

console.log(
  'B805 browser gate: links/history/reload, keyboard, refusals, unsaved guard, EN/NL at 320 px, 200% zoom and 1280 passed.',
);
await browser.close();
