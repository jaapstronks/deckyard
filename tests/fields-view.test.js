/**
 * The Fields view (D335, B703): the content form in the canvas column.
 *
 * - It shows and hides on the Canvas | Fields choice, and the presenter-notes
 *   strip moves in as its last field and back when it hides.
 * - The title field heads the form beside the preview, also after the form
 *   rerendered itself.
 * - It follows the editor's selection through `sync()`, and does not rebuild
 *   under the user's caret on the slide they are typing in; that rebuild is
 *   owed and runs once the focus leaves the form (DY-781).
 * - A locked slide reads but takes no input (the state-driven lock seam).
 * - A click on the preview goes back to the canvas at the clicked field.
 * - An edit in the form re-renders the inspector beside it once typing
 *   pauses, but not under a caret in the inspector (B875).
 *
 * Run with: node --test tests/fields-view.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { createFieldsView, createInspectorFollower, FIELDS_CONTEXTS } =
  await import('../client/views/editor/fields-view.js');
const { FORM_SURFACES } =
  await import('../client/views/editor/editor-form/surfaces.js');

/**
 * A view over two slides with a stand-in form renderer: it renders a title
 * field and a body field the way the editor form does (wrappers carrying
 * `data-collab-field-key` inside `.editor-form`) and counts its renders.
 */
function setup({ lockedIds = [], context } = {}) {
  const pres = {
    id: 'p1',
    slides: [
      { id: 's1', type: 'content-slide', content: { title: 'One' } },
      { id: 's2', type: 'content-slide', content: { title: 'Two' } },
    ],
  };
  let selectedId = 's1';
  const state = { renders: 0, hooks: null, canvasCalls: [] };
  const notesEl = document.createElement('div');
  notesEl.className = 'notes-strip';
  const home = document.createElement('div');
  home.append(notesEl);
  document.body.append(home);

  const view = createFieldsView({
    context,
    pres,
    getSelectedSlideId: () => selectedId,
    getSlideLockKind: (id) => (lockedIds.includes(id) ? 'author' : null),
    notesEl,
    onEditOnCanvas: (key) => state.canvasCalls.push(key),
    createFormRenderer: (mount, hooks) => {
      state.hooks = hooks;
      state.rerender = function rerender() {
        state.renders += 1;
        const slide = pres.slides.find((s) => s.id === selectedId);
        const form = document.createElement('div');
        form.className = 'editor-form';
        for (const key of ['title', 'body']) {
          const wrap = document.createElement('div');
          wrap.setAttribute('data-collab-field-key', key);
          const input = document.createElement('input');
          input.value = key === 'title' ? slide.content.title : '';
          wrap.append(input);
          form.append(wrap);
        }
        mount.replaceChildren(form);
        hooks.onRendered();
      };
      return state.rerender;
    },
  });
  home.append(view.el);
  return {
    view,
    state,
    home,
    notesEl,
    select: (id) => {
      selectedId = id;
    },
  };
}

test('shows and hides, carrying the notes strip in and back', () => {
  const { view, home, notesEl, state } = setup();
  assert.equal(view.el.hidden, true, 'hidden until chosen');
  assert.equal(state.renders, 0, 'no form is built while hidden');

  view.show();
  assert.equal(view.el.hidden, false);
  assert.equal(view.isShown(), true);
  assert.ok(
    view.el.querySelector('.fields-view-notes').contains(notesEl),
    'notes are the last field',
  );
  assert.equal(state.renders, 1);

  view.hide(home);
  assert.equal(view.el.hidden, true);
  assert.equal(notesEl.parentElement, home, 'notes go back under the canvas');
  view.sync();
  assert.equal(state.renders, 1, 'a hidden view does not follow along');
});

test('the title field heads the form, also after the form rerenders itself', () => {
  const { view, state } = setup();
  view.show();
  const slot = view.el.querySelector('.fields-view-title-slot');
  assert.ok(slot.querySelector('[data-collab-field-key="title"]'));
  assert.equal(
    view.el.querySelectorAll(
      '.fields-view-form [data-collab-field-key="title"]',
    ).length,
    0,
    'the title is not rendered twice',
  );
  assert.ok(
    view.el.querySelector('.fields-view-form [data-collab-field-key="body"]'),
  );
  // A structural edit inside the form rerenders it from within.
  state.rerender();
  assert.equal(slot.children.length, 1);
  assert.equal(
    view.el.querySelectorAll('[data-collab-field-key="title"]').length,
    1,
  );
});

test('sync follows a new selection, but leaves the slide being typed in alone', () => {
  const { view, state, select } = setup();
  view.show();
  assert.equal(state.renders, 1);

  // Focus in the form, same slide (a save or a list refresh): no rebuild.
  view.el.querySelector('.fields-view-form input').focus();
  view.sync();
  assert.equal(state.renders, 1, 'no rebuild under the caret');

  // Another slide chosen in the list: always rebuild.
  select('s2');
  view.sync();
  assert.equal(state.renders, 2);
  assert.match(
    view.el.querySelector('.fields-view-counter').textContent,
    /2/,
    'the head counts the new slide',
  );

  // Same slide, focus elsewhere (undo, a remote update): rebuild.
  document.body.focus();
  view.el.querySelector('input')?.blur();
  view.sync();
  assert.equal(state.renders, 3);
});

test('a rebuild skipped under the caret runs once the focus leaves the form (DY-781)', async () => {
  const { view, state } = setup();
  view.show();
  const inputs = view.el.querySelectorAll(
    '.fields-view-form input, .fields-view-title-slot input',
  );
  inputs[0].focus();
  // A remote update (a collaborator moved an item) while typing: no rebuild.
  view.sync();
  assert.equal(state.renders, 1);

  // Tab to the next field of the same form: still typing here.
  inputs[1].focus();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.renders, 1, 'moving between fields keeps the form');

  // Leave the form: the owed rebuild runs, once.
  inputs[1].blur();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.renders, 2, 'the form catches up after the blur');
  view.el.dispatchEvent(new dom.window.FocusEvent('focusout'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.renders, 2, 'nothing owed, nothing rebuilt');
});

test('a locked slide gates the form and the note clears on an editable one', () => {
  const { view, select } = setup({ lockedIds: ['s2'] });
  view.show();
  const note = view.el.querySelector('.fields-view-locked-note');
  assert.equal(view.el.classList.contains('is-locked'), false);
  assert.equal(note.hidden, true);

  select('s2');
  view.sync();
  assert.equal(view.el.classList.contains('is-locked'), true);
  assert.equal(note.hidden, false);
  assert.ok(note.textContent.length > 0, 'the note says why');

  select('s1');
  view.sync();
  assert.equal(view.el.classList.contains('is-locked'), false);
  assert.equal(note.hidden, true);
});

test('a click on the preview goes back to the canvas, at the clicked field', () => {
  const { view, state } = setup();
  view.show();
  const preview = view.el.querySelector('.fields-view-preview');
  const thumb = preview.querySelector('.fields-view-thumb');
  const heading = document.createElement('h2');
  heading.setAttribute('data-inline-field', 'title');
  thumb.replaceChildren(heading);
  heading.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  preview.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  view.el
    .querySelector('.fields-view-to-canvas')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(state.canvasCalls, ['title', null, null]);
});

test('the slide head folds and remembers it', () => {
  localStorage.clear();
  const first = setup();
  first.view.show();
  const fold = first.view.el.querySelector('.fields-view-fold');
  assert.equal(fold.getAttribute('aria-expanded'), 'true');
  fold.click();
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(
    first.view.el.querySelector('.fields-view-preview').hidden,
    true,
  );

  const second = setup();
  assert.equal(
    second.view.el.querySelector('.fields-view-preview').hidden,
    true,
    'a new editor opens with the head folded',
  );
  localStorage.clear();
});

/**
 * One form, two contexts (B703 PR 4): the context names the form surface, and
 * only the deck has a canvas to go back to and a deck to count in.
 */
test('the context names the surface: content only beside an inspector, everything alone', () => {
  assert.equal(FIELDS_CONTEXTS.deck.surface, 'fields');
  assert.equal(FIELDS_CONTEXTS.library.surface, 'library');
  for (const { surface } of Object.values(FIELDS_CONTEXTS)) {
    assert.ok(Object.hasOwn(FORM_SURFACES, surface), `${surface} is declared`);
  }
  assert.equal(FORM_SURFACES.fields.fields, 'content');
  assert.equal(FORM_SURFACES.library.fields, 'all');
  assert.equal(Object.hasOwn(FORM_SURFACES, 'bulk'), false, 'bulk is gone');

  const deck = setup();
  deck.view.show();
  assert.equal(deck.state.hooks.surface, 'fields');
  deck.view.detach();
  deck.home.remove();
});

test('the library context has no canvas to go back to and no deck to count in', () => {
  const { view, state, home } = setup({ context: 'library' });
  view.show();
  assert.equal(state.hooks.surface, 'library');
  assert.ok(view.el.classList.contains('is-library'));
  assert.equal(view.el.querySelector('.fields-view-to-canvas'), null);
  const preview = view.el.querySelector('.fields-view-preview');
  assert.equal(preview.tagName, 'DIV', 'the preview is a picture, no button');
  assert.equal(view.el.querySelector('.fields-view-counter').hidden, true);
  assert.ok(
    view.el.querySelector(
      '.fields-view-title-slot [data-collab-field-key="title"]',
    ),
    'the title still heads the form',
  );
  view.detach();
  home.remove();
});

test('an unknown context throws instead of rendering a form nobody declared', () => {
  assert.throws(
    () => createFieldsView({ context: 'bulk', pres: { slides: [] } }),
    /Unknown Fields context/,
  );
});

test('an edit in the form re-renders the inspector, not under its caret (B875)', async () => {
  const inspectorEl = document.createElement('div');
  const inspectorInput = document.createElement('input');
  inspectorEl.append(inspectorInput);
  const outside = document.createElement('input');
  document.body.append(inspectorEl, outside);
  let renders = 0;
  const follower = createInspectorFollower({
    inspectorEl,
    rerender: () => {
      renders += 1;
    },
    delayMs: 5,
  });
  const pause = () => new Promise((r) => setTimeout(r, 20));

  // Three keystrokes in the Fields form: one render after the pause.
  outside.focus();
  follower.schedule();
  follower.schedule();
  follower.schedule();
  assert.equal(renders, 0, 'nothing while typing');
  await pause();
  assert.equal(renders, 1, 'the inspector follows once typing pauses');

  // The caret is in the inspector: it is not rebuilt under it.
  inspectorInput.focus();
  follower.schedule();
  await pause();
  assert.equal(renders, 1);

  // A pending render dies with the editor.
  outside.focus();
  follower.schedule();
  follower.detach();
  await pause();
  assert.equal(renders, 1);
  inspectorEl.remove();
  outside.remove();
});
