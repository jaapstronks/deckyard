import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
for (const key of [
  'window',
  'document',
  'location',
  'localStorage',
  'HTMLElement',
  'Node',
  'Element',
  'CustomEvent',
  'Event',
]) {
  globalThis[key] = dom.window[key];
}
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const { createThemesTab } =
  await import('../client/views/settings/tabs/themes-tab.js');
const ID = '11111111-1111-4111-8111-111111111111';
const original = {
  id: ID,
  source: 'organization',
  label: 'Original',
  colors: { primary: '#123456', background: '#ffffff' },
  fonts: { heading: 'Inter', body: 'Inter' },
  logoUrl: '/assets/main.svg',
  logoSmallUrl: '/assets/small.svg',
  config: {
    version: 1,
    cssVarOverrides: { '--t-color-primary': '#123456' },
  },
};

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runEdit(label, failRecordLoad = false) {
  document.body.innerHTML = '';
  const requests = [];
  let saved = null;
  globalThis.fetch = async (path, opts = {}) => {
    requests.push(`${opts.method || 'GET'} ${path}`);
    if (path === '/api/themes?all=1') {
      return Response.json({
        themes: [{ id: ID, source: 'organization', label: 'Original' }],
        defaultThemeId: ID,
        enabledThemes: [],
      });
    }
    if (path === '/api/settings/organization') {
      return Response.json({ settings: { defaultThemeId: ID } });
    }
    if (path === `/api/themes/${ID}` && !opts.method) {
      if (failRecordLoad) {
        return Response.json(
          { ok: false, error: 'unavailable', message: 'Theme unavailable' },
          { status: 503 },
        );
      }
      return Response.json(original);
    }
    if (path === `/api/themes/${ID}` && opts.method === 'PUT') {
      saved = JSON.parse(opts.body);
      return Response.json({ ...original, ...saved });
    }
    throw new Error(`Unexpected request: ${opts.method || 'GET'} ${path}`);
  };

  const tab = createThemesTab({ user: { role: 'admin' } });
  document.body.append(tab.el);
  await tab.load();
  tab.el.querySelector('.theme-card-actions button').click();
  await flush();

  if (!failRecordLoad) {
    const editor = tab.el.querySelector('.theme-editor');
    assert.ok(editor, 'full record loaded before opening the editor');
    if (label) {
      const input = editor.querySelector(
        'input[placeholder="My Custom Theme"]',
      );
      input.value = label;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.querySelector('.theme-editor-header .btn-primary').click();
    await flush();
  }
  return { requests, saved, tab };
}

for (const label of [null, 'Renamed']) {
  test(`editing a list theme preserves full config and small logo (${label || 'unchanged'})`, async () => {
    const { requests, saved } = await runEdit(label);
    assert.ok(requests.includes(`GET /api/themes/${ID}`));
    assert.equal(saved.label, label || original.label);
    assert.deepEqual(saved.config, original.config);
    assert.equal(saved.logoSmallUrl, original.logoSmallUrl);
  });
}

test('a failed record load keeps the list visible and does not open an empty editor', async () => {
  const { requests, tab } = await runEdit(null, true);
  assert.ok(requests.includes(`GET /api/themes/${ID}`));
  assert.equal(tab.el.querySelector('.theme-editor'), null);
  assert.equal(
    tab.el
      .querySelector('.themes-list-section')
      .classList.contains('is-hidden'),
    false,
  );
  assert.ok(document.querySelector('.toast-stack'));
});
