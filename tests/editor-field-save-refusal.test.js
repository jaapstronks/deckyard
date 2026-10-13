/** Server field refusals remain inline through rerender and clear on correction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
const { createSaveRefusal } =
  await import('../client/views/editor/editor-form/save-refusal.js');
const slide = { id: 's1' };
const field = { key: 'contactUrl' };
const refused = {
  message: 'Invalid URL',
  details: { slideId: 's1', field: 'contactUrl', errors: ['Enter a full URL'] },
};
function wrapper() {
  const el = document.createElement('div');
  const control = document.createElement('input');
  el.append(control);
  return { el, control };
}
test('refusal reaches an existing modal field and a rebuilt inspector field, opens its section, and clears on edit', () => {
  const state = createSaveRefusal();
  const modal = wrapper();
  document.body.append(modal.el);
  state.decorate(modal.el, slide, field);
  state.set(refused);
  assert.equal(modal.control.getAttribute('aria-invalid'), 'true');
  assert.equal(
    modal.el.querySelector('[role=alert]').textContent,
    'Enter a full URL',
  );
  const inspector = wrapper();
  state.decorate(inspector.el, slide, field);
  const details = document.createElement('details');
  details.append(inspector.el);
  document.body.append(details);
  state.reveal();
  assert.equal(details.open, true);
  assert.equal(inspector.control.getAttribute('aria-invalid'), 'true');
  inspector.control.dispatchEvent(
    new dom.window.Event('input', { bubbles: true }),
  );
  assert.equal(modal.control.hasAttribute('aria-invalid'), false);
  assert.equal(inspector.control.hasAttribute('aria-invalid'), false);
  assert.equal(state.matches(slide, field), false);
});
test('same field key on another slide stays unmarked and a successful save clears the refusal', () => {
  const state = createSaveRefusal();
  const target = wrapper();
  const other = wrapper();
  document.body.append(target.el, other.el);
  state.decorate(target.el, slide, field);
  state.decorate(other.el, { id: 's2' }, field);
  state.set(refused);
  assert.equal(target.control.getAttribute('aria-invalid'), 'true');
  assert.equal(other.control.hasAttribute('aria-invalid'), false);
  state.set(null);
  assert.equal(target.control.hasAttribute('aria-invalid'), false);
});

test('an off-screen refusal marks only the field rendered for that language', () => {
  let active = 'nl';
  const state = createSaveRefusal({ getActiveLang: () => active });
  const dutchModal = wrapper();
  document.body.append(dutchModal.el);
  state.decorate(dutchModal.el, slide, field);
  active = 'en-GB';
  state.set({
    ...refused,
    details: { ...refused.details, lang: 'en-GB' },
  });
  assert.equal(dutchModal.control.hasAttribute('aria-invalid'), false);
  const englishInspector = wrapper();
  document.body.append(englishInspector.el);
  state.decorate(englishInspector.el, slide, field);
  assert.equal(englishInspector.control.getAttribute('aria-invalid'), 'true');
  assert.equal(dutchModal.control.hasAttribute('aria-invalid'), false);
  state.detach();
});
