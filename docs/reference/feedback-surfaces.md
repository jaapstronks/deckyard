# Feedback surfaces

Which message goes where, for how long, saying what, and where focus lands.

The client has five kinds of thing to tell a user, and each has one carrier.
The question at every call site is not "toast or no toast" but **which kind
of event is this** — the carrier follows from the answer. The rules below are
normative; the implementation status at the end says how far the code is.

## The five kinds

| Kind                                                                                                   | Carrier                                                                | Where                             | How long                                                                  | Says                                                                                                                                  | Focus / ARIA                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Confirmation** — it worked, nothing to do                                                            | `toast.success` / `toast.info`                                         | global stack                      | short, expires. **Not shown at all when the result is already on screen** | one sentence                                                                                                                          | never moves focus; `role="status"`, polite region                                                                            |
| **Refusal of what the user is doing now** — a form or dialog that will not save, local or from the API | inline: `createInlineError()` under the field and/or beside the button | at the control that has to change | until the next attempt (`clear()` at the start of every attempt)          | the sentence, naming the field. Server sentence when it came from the API; translated copy on `details.reason` when the client has it | focus to the control, else to the message; `role="alert"` on the message, `aria-invalid` + `aria-describedby` on the control |
| **Failure of an action with no form** — delete, duplicate, copy, load                                  | `toast.error`                                                          | global stack                      | longer than a confirmation, pauses on hover/focus, closes on Escape       | the server's sentence, never a generic replacement                                                                                    | `role="alert"`, assertive region; focus stays where it was                                                                   |
| **Background failure** — autosave, poll, sync, upload, collab bootstrap                                | a persistent chip or banner carrying the state (save-chip, banner)     | at the state it describes         | until the state recovers                                                  | what did not happen and what the user can do                                                                                          | polite; repeatable, not one passing announcement                                                                             |
| **Status change from outside** — a collaborator took the slide, the service is back                    | its own carrier (presence, chip), or an `info` toast                   | at the state                      | as long as the state lasts                                                | no error colour                                                                                                                       | polite                                                                                                                       |

Two rules that cut across the table:

- **A message that carries an action does not expire.** `toast(…, { action })`
  stays until the action is used or the toast is dismissed, and ignores any
  `durationMs` it was given (WCAG 2.2.1). Undo, Review, "See what changed" are
  useless if they are gone before a keyboard user reaches them.
- **The server's sentence is the truth.** Client copy comes _on top_ of it — a
  translation looked up on `err.code` or `details.reason` — never _instead_ of
  it. `toast.error(err)` (the caught error itself) is the canonical failure
  form; `toast.error(t('…failed'))` in a `catch` throws the reason away.

And one that decides when a toast is allowed to expire at all: **expiring is
fine only when missing the message does no harm.** "Saved" can be missed. "Your
last three edits were not saved" cannot, so it is a chip that stays.

## The envelope, mirrored

Deckyard is used by agents as much as by people, and both see the same events.
The client doctrine therefore reads the API error envelope
([`api-error-format.md`](api-error-format.md)) rather than inventing a second
vocabulary next to it. From `api()`:

| Field                             | Client use                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `err.code`                        | Branch on it. It decides the _kind_ (a `forbidden` on a form is a refusal; a `not_found` on a card is an action failure). |
| `err.message`                     | The sentence to show. Safe to display as-is.                                                                              |
| `err.details.field`               | Which input was refused. The inline helper marks that control.                                                            |
| `err.details.index`, `.itemIndex` | Where in a list-valued input. The form opens and marks that row.                                                          |
| `err.details.reason`              | A snake_case sub-code for translated copy. Fall back to `message` when the client has no copy for it.                     |

The slide-type editor (`client/views/settings/slide-type-editor/`) is the
worked example: `validateCustomFieldDefinitions` runs on both sides, the API
answers `details: { field: 'fields', index, itemIndex, reason }`, and the
editor points at the row either way.

## The inline refusal

`createInlineError()` in [`client/lib/dom/inline-error.js`](../../client/lib/dom/inline-error.js)
is the one element for the second kind. It replaces the 26 hand-rolled
spellings the client had grown (`.field-error`, `.help.is-error`,
`.share-*-error`, `.auth-status.is-error`, …), and the guard in
`tests/feedback-surfaces-guard.test.js` refuses a 27th.

```js
import { createInlineError } from '../../lib/dom/inline-error.js';

// Beside the button, for the form as a whole:
const saveError = createInlineError({ callout: true });
container.append(header, saveError.el, body);

saveBtn.addEventListener('click', async () => {
  saveError.clear(); // every attempt starts clean
  if (!name.value.trim()) {
    saveError.show(t('…nameRequired', 'Name is required.'), { control: name });
    return;
  }
  try {
    await onSave(data);
  } catch (err) {
    saveError.show(err.message, { control: controlFor[err.details?.field] });
  }
});

// Under a field, as a hint while typing (the required-field flag):
const hint = createInlineError({ live: 'polite' });
wrap.append(hint.el);
hint.show(t('editor.fields.required', 'This field is required.'), {
  control,
  focus: false,
});
```

What it does on `show(message, { control, focus })`:

- puts the sentence in the element and unhides it (`role="alert"`, or
  `role="status"` for the polite form);
- on the control, if one is named: `aria-invalid="true"` and
  `aria-describedby` pointing at the message, without disturbing the ids a
  help text already put there;
- moves focus to the control, else to the message itself (`tabindex="-1"`);
  pass an element to land elsewhere (the summary of a list row), or `false`
  to leave focus alone — a hint while typing must not move it;
- scrolls the target into view.

`clear()` hides it and releases the control. A group that is not a control
(a `<details>` row of a list) does not get `aria-invalid`; the message sits
inside the group and the caller lands focus on the group's own focusable.

Styling: `.inline-error` (plain, under a field) and `.inline-error.is-callout`
(the box beside a button). The control's border follows
`.form-input[aria-invalid="true"]` — the attribute is the state, there is no
wrapper class to keep in step.

## Live regions and focus

- The toast stack has two regions that exist from page load: `role="status"`
  polite for `info`/`success`, `role="alert"` assertive for `warning`/`error`.
  Politeness is a property of the kind, not of the call site.
- An inline refusal of an attempt is `role="alert"`. The required-field hint on
  blur is `role="status"`: it must not talk over the label of the field the
  user just moved to.
- A toast never takes focus (WCAG 4.1.3). It is focusable, so a keyboard user
  can Tab to it, and Escape/Enter/Space close it. Focus moves to the next toast
  on a keyboard dismissal so the tab position is not lost.
- An inline refusal _does_ move focus, to where the fix is. That is the whole
  point of naming the field.

## Stacking: toasts above modals

`--z-toast` (1200) sits above `--z-modal` (1100), so a toast is visible over an
open dialog. Decided rather than inherited, for these reasons:

- A modal is where many actions without a form of their own complete
  ("Invitation sent." after the share dialog's Send). Under the scrim the
  toast would be visible but unreadable — information loss.
- The stack covers one corner; a toast steals no focus and the modal's focus
  trap keeps Tab inside the dialog. That makes a toast over a modal
  unreachable by keyboard, which is acceptable **only because a toast never
  requires handling**: refusals are inline, and a toast that carries an action
  does not expire. Those two rules are what make the stacking safe.
- Escape on a focused toast stops propagation: closing a toast must not also
  close the dialog behind it.

## The dev/prod boundary

Misusing a primitive (a DOM node passed as a toast message, an empty inline
error, an unknown toast kind) is a programming error. `reportMisuse()` in
[`client/lib/util/dev-runtime.js`](../../client/lib/util/dev-runtime.js)
throws when the host is localhost or absent (development, jsdom) and logs in
production — the client's counterpart to the server's
`NODE_ENV !== 'production'` guard. Every UI primitive draws the line there,
not in a copy of its own.

## Implementation status (2026-09-02)

The primitive and the helper meet the rules above. The call sites do not yet:

| Burndown                                                               | Count    | Item |
| ---------------------------------------------------------------------- | -------- | ---- |
| Refusals of the form on screen reported in a `toast.error`             | 13       | B204 |
| `catch` blocks that discard the server sentence for generic `t()` copy | 24       | B205 |
| Background failures that expire in a toast                             | 10       | B206 |
| Hand-rolled inline error classes (message idioms)                      | 19 files | B204 |

The 16 local validations (a form that says no before anything is sent) are on
the helper as of B204 PR 1; what the first row still counts is the API refusal
caught in a save handler and toasted. What is left in the refuse-and-return
allowlist after that PR is a different shape: a modal that refuses to open, a
menu item, a card action, a file dropped on the canvas — an action with no
form on screen, whose carrier _is_ `toast.error`. Not `toast.warning`: no
kind maps to it, and the client has no call site for it.

The counts are the allowlists in `tests/feedback-surfaces-guard.test.js`; each
item lowers them and the test refuses a rise. Alongside: `toast.info` used as a
progress indicator with a 60–120 s lifetime (4 sites) is a status chip in
disguise, and ≥ 27 success toasts announce what is already visible on screen
("Theme deleted." as the row disappears) — both fold into the items above.

Existing carriers for the fourth kind: the save-chip in the editor top bar
(`aria-live="polite"`) and `client/views/shared/maintenance-banner.js`
(`role="alert"`). Settings has no persistent carrier yet; B206 decides whether
it gets one.
