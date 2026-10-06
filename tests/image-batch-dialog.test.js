import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.FileReader = dom.window.FileReader;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.URL.createObjectURL = () => 'blob:batch-test';
globalThis.URL.revokeObjectURL = () => {};

const { openImageBatch } =
  await import('../client/views/editor/image-library/batch.js');

const file = (name) =>
  new dom.window.File(['image bytes'], name, { type: 'image/png' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('batch dialog did not reach the expected state');
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function dialog() {
  return document.querySelector('.image-batch-modal');
}
function action(index) {
  return dialog().querySelectorAll('.image-batch-actions > button')[index];
}
function fillAlts() {
  for (const row of dialog().querySelectorAll('.image-batch-row')) {
    for (const input of row.querySelectorAll('.image-batch-fields input')) {
      input.value = `Alt for ${row.querySelector('strong').textContent}`;
    }
  }
}
function closeAndClean(batch) {
  batch.close();
  document.body.replaceChildren();
}

test('retry after a definite metadata failure reuses uploaded URLs and confirmed ids', async () => {
  const calls = [];
  const picks = [];
  let failSecond = true;
  const api = async (path, opts) => {
    calls.push({ path, body: opts?.body });
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      if (opts.body.url.endsWith('second.png') && failSecond) {
        failSecond = false;
        throw Object.assign(new Error('Storage temporarily unavailable'), {
          code: 'storage_error',
        });
      }
      return {
        id: opts.body.url.endsWith('first.png') ? 'id-first' : 'id-second',
      };
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('first.png'), file('second.png')],
    onPickMany: (images) => picks.push(images),
  });
  await until(
    () =>
      [...dialog().querySelectorAll('.image-batch-row .help')].filter(
        (el) => el.textContent === 'Uploaded',
      ).length === 2,
  );
  fillAlts();
  action(0).click();
  await until(() => !action(2).hidden);
  assert.equal(
    picks.length,
    0,
    'partial save never mutates the slide automatically',
  );
  action(2).click();
  await until(() => picks.length === 1);
  assert.deepEqual(
    picks[0].map((pick) => pick.id),
    ['id-first', 'id-second'],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.path === '/api/uploads')
      .map((call) => call.body.originalName),
    ['first.png', 'second.png'],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.path === '/api/image-library')
      .map((call) => call.body.url),
    ['/uploads/first.png', '/uploads/second.png', '/uploads/second.png'],
  );
  closeAndClean(batch);
});

test('continuing after a partial save waits for the remaining POST and applies once', async () => {
  const lastPost = deferred();
  const picks = [];
  let posts = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      if (posts === 1)
        throw Object.assign(new Error('Storage temporarily unavailable'), {
          code: 'storage_error',
        });
      if (posts === 2) return { id: 'second-id' };
      return lastPost.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('first.png'), file('second.png'), file('third.png')],
    onPickMany: (images) => picks.push(images),
  });
  try {
    await until(() => !action(0).disabled);
    fillAlts();
    action(0).click();
    await until(() => posts === 3);
    const continueButton = action(3);
    assert.equal(continueButton.disabled, true);
    continueButton.click();
    // Also guard the handler itself against activation during an active phase.
    continueButton.dispatchEvent(new dom.window.MouseEvent('click'));
    assert.equal(picks.length, 0);
    assert.ok(dialog());
    lastPost.resolve({ id: 'third-id' });
    await until(() => !continueButton.disabled);
    assert.equal(picks.length, 0);
    continueButton.click();
    continueButton.dispatchEvent(new dom.window.MouseEvent('click'));
    assert.equal(picks.length, 1);
    assert.deepEqual(
      picks[0].map((pick) => pick.id),
      ['second-id', 'third-id'],
    );
    assert.equal(dialog(), null);
  } finally {
    lastPost.resolve({ id: 'third-id' });
    closeAndClean(batch);
  }
});

test('uncertain metadata result cannot be retried blindly', async () => {
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      throw new Error('Network disconnected');
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('uncertain.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      dialog()?.querySelector('.image-batch-row .help')?.textContent ===
      'Uploaded',
  );
  fillAlts();
  action(0).click();
  await until(() =>
    dialog()?.textContent.includes('Saving may have succeeded'),
  );
  assert.equal(action(2).hidden, true);
  assert.equal(action(0).disabled, true);
  assert.equal(posts, 1);
  assert.equal(applied, 0);
  closeAndClean(batch);
});

test('double-clicking Save during a pending POST starts one commit', async () => {
  const pending = deferred();
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      return pending.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('once.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      dialog()?.querySelector('.image-batch-row .help')?.textContent ===
      'Uploaded',
  );
  fillAlts();
  action(0).click();
  action(0).click();
  await until(() => posts === 1);
  pending.resolve({ id: 'once-id' });
  await until(() => applied === 1);
  assert.equal(posts, 1);
  closeAndClean(batch);
});

test('stopping during uploads does not start queued files or apply the slide', async () => {
  const uploads = [];
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads') {
      const pending = deferred();
      uploads.push({ name: opts.body.originalName, ...pending });
      return pending.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [
      file('one.png'),
      file('two.png'),
      file('three.png'),
      file('four.png'),
    ],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(() => uploads.length === 3);
  action(4).click();
  uploads.forEach(({ name, resolve }) => resolve({ url: `/uploads/${name}` }));
  await until(() =>
    dialog()?.textContent.includes('The slide was not changed'),
  );
  assert.equal(uploads.length, 3);
  assert.equal(applied, 0);
  closeAndClean(batch);
});

test('stopping during metadata save preserves stored record and skips remaining POSTs', async () => {
  const firstPost = deferred();
  let posts = 0;
  let applied = 0;
  const api = async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library') {
      posts += 1;
      return firstPost.promise;
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  const batch = openImageBatch({
    api,
    files: [file('one.png'), file('two.png')],
    onPickMany: () => {
      applied += 1;
    },
  });
  await until(
    () =>
      [...dialog().querySelectorAll('.image-batch-row .help')].filter(
        (el) => el.textContent === 'Uploaded',
      ).length === 2,
  );
  fillAlts();
  action(0).click();
  await until(() => posts === 1);
  action(4).click();
  firstPost.resolve({ id: 'stored-before-stop' });
  await until(() => dialog()?.textContent.includes('1 images were saved'));
  assert.equal(posts, 1);
  assert.equal(applied, 0);
  closeAndClean(batch);
});

const { setFeatures } = await import('../client/lib/state/features.js');
function aiButton(prefix = 'Generate missing alt text') {
  return [...dialog().querySelectorAll('button')].find(
    (button) => !button.hidden && button.textContent.startsWith(prefix),
  );
}
function consent(accept) {
  const modals = [...document.querySelectorAll('.modal')];
  const modal = modals.at(-1);
  assert.match(modal.textContent, /OpenAI.*AI costs/);
  modal.querySelector(accept ? '.btn-primary' : '.btn-secondary').click();
}
function altInput(rowIndex, langIndex = 0) {
  const row = dialog().querySelectorAll('.image-batch-row')[rowIndex];
  return row.querySelectorAll('.image-batch-fields input')[langIndex];
}
function change(input, value) {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function uploadApi(generate) {
  return async (path, opts) => {
    if (path === '/api/media/status') return { presignedSupported: false };
    if (path === '/api/uploads')
      return { url: `/uploads/${opts.body.originalName}` };
    if (path === '/api/image-library/generate-alts') return generate(opts.body);
    throw new Error(`Unexpected API path ${path}`);
  };
}

test('30-image consent, concurrency two, missing languages only and explicit row retry', async () => {
  setFeatures({ enableAi: true, aiAltText: true });
  const calls = [];
  let active = 0;
  let maximum = 0;
  let fail = true;
  const batch = openImageBatch({
    api: uploadApi(async (body) => {
      calls.push(body);
      active += 1;
      maximum = Math.max(maximum, active);
      await tick();
      active -= 1;
      if (body.url.endsWith('/7.png') && fail) {
        fail = false;
        throw new Error('Controlled AI failure');
      }
      return {
        alts: Object.fromEntries(
          body.langs.map((lang) => [lang, `AI ${lang}`]),
        ),
      };
    }),
    files: Array.from({ length: 30 }, (_, i) => file(`${i + 1}.png`)),
  });
  try {
    await until(() => !aiButton().disabled);
    assert.equal(calls.length, 0);
    assert.match(aiButton().textContent, /30 images/);
    aiButton().click();
    assert.match(document.body.lastElementChild.textContent, /30 images/);
    consent(false);
    await until(() => !aiButton().disabled);
    assert.equal(calls.length, 0);
    for (const input of dialog()
      .querySelectorAll('.image-batch-row')[0]
      .querySelectorAll('.image-batch-fields input'))
      change(input, 'Already filled');
    change(altInput(1), 'One language filled');
    const skippedLang = (
      await import('../client/lib/format/i18n.js')
    ).getSupportedLangs()[0];
    assert.match(aiButton().textContent, /29 images/);
    aiButton().click();
    consent(true);
    await until(() => calls.length === 29 && !aiButton().disabled);
    assert.equal(maximum, 2);
    assert.equal(
      calls.some((body) => body.url.endsWith('/1.png')),
      false,
    );
    assert.equal(
      calls
        .find((body) => body.url.endsWith('/2.png'))
        .langs.includes(skippedLang),
      false,
    );
    assert.equal(altInput(1).value, 'One language filled');
    assert.ok(dialog().textContent.includes('Controlled AI failure'));
    const retry = aiButton('Retry AI for this image');
    assert.equal(retry.hidden, false);
    retry.click();
    assert.match(document.body.lastElementChild.textContent, /1 images/);
    consent(true);
    await until(
      () => calls.length === 30 && aiButton().disabled && !action(0).disabled,
    );
    assert.ok(calls.at(-1).url.endsWith('/7.png'));
    assert.equal(retry.hidden, true);
  } finally {
    closeAndClean(batch);
    setFeatures(null);
  }
});

test('manual edits including type-then-clear win; stop drains two requests before applying', async () => {
  setFeatures({ enableAi: true, aiAltText: true });
  const pending = [];
  const picks = [];
  const batch = openImageBatch({
    api: uploadApi((body) => {
      const request = deferred();
      pending.push({ ...request, body });
      return request.promise;
    }),
    files: [file('one.png'), file('two.png'), file('three.png')],
    onPickMany: (images) => picks.push(images),
  });
  try {
    await until(() => !aiButton().disabled);
    aiButton().click();
    consent(true);
    await until(() => pending.length === 2);
    change(altInput(0), 'Manual');
    change(altInput(1), 'Transient');
    change(altInput(1), '');
    aiButton('Stop AI generation').click();
    assert.equal(action(0).disabled, true);
    assert.equal(action(1).disabled, true);
    action(1).dispatchEvent(new dom.window.MouseEvent('click'));
    assert.equal(picks.length, 0);
    pending.forEach(({ resolve, body }) =>
      resolve({
        alts: Object.fromEntries(body.langs.map((lang) => [lang, 'Generated'])),
      }),
    );
    await until(() => !action(0).disabled);
    assert.equal(pending.length, 2);
    assert.equal(altInput(0).value, 'Manual');
    assert.equal(altInput(1).value, '');
    fillAlts();
    action(1).click();
    await until(() => picks.length === 1);
    assert.equal(picks[0].length, 3);
  } finally {
    closeAndClean(batch);
    setFeatures(null);
  }
});

test('closing a generating batch ignores late results and does not start queued requests', async () => {
  setFeatures({ enableAi: true, aiAltText: true });
  const pending = [];
  const batch = openImageBatch({
    api: uploadApi((body) => {
      const request = deferred();
      pending.push({ ...request, body });
      return request.promise;
    }),
    files: [file('one.png'), file('two.png'), file('three.png')],
  });
  try {
    await until(() => !aiButton().disabled);
    aiButton().click();
    consent(true);
    await until(() => pending.length === 2);
    const input = altInput(0);
    batch.close();
    pending.forEach(({ resolve, body }) =>
      resolve({
        alts: Object.fromEntries(body.langs.map((lang) => [lang, 'Late'])),
      }),
    );
    await tick();
    await tick();
    assert.equal(input.value, '');
    assert.equal(pending.length, 2);
    assert.equal(dialog(), null);
  } finally {
    closeAndClean(batch);
    setFeatures(null);
  }
});

test('AI disabled leaves only manual batch editing', async () => {
  setFeatures({ enableAi: false, aiAltText: true });
  const batch = openImageBatch({
    api: uploadApi(() => assert.fail('AI disabled')),
    files: [file('manual.png')],
  });
  try {
    await until(() => !action(0).disabled);
    assert.equal(aiButton(), undefined);
    assert.equal(aiButton('Retry AI'), undefined);
  } finally {
    closeAndClean(batch);
    setFeatures(null);
  }
});
