/**
 * The companion's failed notes save is a state, not a passing message (B206).
 *
 * It is the fourth kind in docs/reference/feedback-surfaces.md: it sits at the
 * state it describes and stays until that state is gone. Two things make the
 * placement load-bearing here, and both are pinned below:
 *
 *  - **Outside the edit form.** Leaving edit mode is what triggers the last
 *    flush, and it hides the form. A message inside the form would be hidden
 *    by the very action that produced it — the failure of the save the user
 *    asked for by pressing Done would never be seen (the shape this test was
 *    written for, found in review of #1549).
 *  - **Gone when the buffer it describes is gone.** A failure is about the
 *    text typed on one slide. When the presenter advances, or the visitor
 *    cancels or re-enters edit mode, the textarea is reset to what the server
 *    has, so a message left standing would read as a failure of the notes now
 *    on screen.
 *
 * Run with: node --test tests/notes-save-failure.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/notes/session-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;

const { buildNotesLayout } = await import('../client/views/notes/layout.js');
const { createNotesEditor } =
  await import('../client/views/notes/notes-editor.js');

/** Whether `el` is on screen: itself and every ancestor unhidden. */
function visible(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.hidden) return false;
  }
  return true;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A companion whose notes endpoint always says no.
 * @param {{ fail?: boolean }} [state] - Flipped by a test to let a save pass.
 */
function mountCompanion(state = { fail: true }) {
  document.body.innerHTML = '';
  const ui = buildNotesLayout();
  document.body.append(ui.shell);
  const api = async () => {
    if (state.fail) {
      const err = new Error('The notes service is unavailable.');
      err.statusCode = 503;
      throw err;
    }
    return { ok: true };
  };
  const editor = createNotesEditor({ api, sessionId: 'session-1', ui });
  editor.setSlide({ id: 'slide-1', notes: 'the first slide' });
  const message = ui.notesWrap.querySelector('.inline-error');
  assert.ok(message, 'the notes panel carries an inline message element');
  return { ui, editor, state, message };
}

/** Type something and ask for a save that will fail. */
async function failASave({ ui }, text = 'typed but not saved') {
  ui.notesEditBtn.click();
  ui.notesTextarea.value = text;
  ui.notesSaveBtn.click();
  await settle();
}

test('the failure message sits in the notes panel, not in the edit form', () => {
  const { ui, message } = mountCompanion();
  assert.equal(
    message.parentElement,
    ui.notesWrap,
    'the message is a child of the notes panel',
  );
  assert.ok(
    !ui.notesEditor.contains(message),
    'the message is not inside the edit form, which is hidden the moment ' +
      'editing ends — see the header of this file',
  );
  assert.equal(message.getAttribute('role'), 'status', 'polite, not an alert');
});

test('pressing Done shows the failure of the flush it triggers', async () => {
  const c = mountCompanion();
  await failASave(c);
  assert.ok(visible(c.message), 'the failure shows while editing');

  c.ui.notesEditBtn.click(); // Done: flushes once more, then leaves edit mode
  await settle();

  assert.equal(c.ui.notesEditor.hidden, true, 'the edit form is put away');
  assert.ok(
    visible(c.message),
    'and the failure is still on screen — the state it describes outlives ' +
      'the form',
  );
});

test('the failure goes when the buffer it describes is replaced', async () => {
  const c = mountCompanion();

  await failASave(c);
  c.ui.notesCancelBtn.click();
  assert.ok(!visible(c.message), 'Cancel discards the text and the message');

  await failASave(c);
  c.ui.notesEditBtn.click(); // Done
  await settle();
  c.editor.setSlide({ id: 'slide-2', notes: 'the second slide' });
  await settle();
  assert.ok(
    !visible(c.message),
    'a failure of slide 1 does not stand beside the notes of slide 2',
  );

  await failASave(c);
  c.ui.notesEditBtn.click(); // Done
  await settle();
  c.ui.notesEditBtn.click(); // Edit again: the textarea is reset to `stored`
  await settle();
  assert.ok(!visible(c.message), 're-entering edit mode starts clean');
});

test('a slide change flushes the dirty buffer and reports its failure', async () => {
  const c = mountCompanion();
  c.ui.notesEditBtn.click();
  c.ui.notesTextarea.value = 'unsaved when the presenter moved on';
  c.editor.setSlide({ id: 'slide-2', notes: 'the second slide' });
  await settle();
  assert.ok(
    visible(c.message),
    'the flush of the slide being left says so when it fails — the clear on ' +
      'a slide change must not swallow it',
  );
});

test('a save that works takes the failure away', async () => {
  const c = mountCompanion();
  await failASave(c);
  assert.ok(visible(c.message), 'the failure shows');

  c.state.fail = false;
  c.ui.notesTextarea.value = 'this one lands';
  c.ui.notesSaveBtn.click();
  await settle();

  assert.ok(!visible(c.message), 'the state recovered, so the message goes');
});
