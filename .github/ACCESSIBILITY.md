# Accessibility

Deckyard makes two things: an application (the editor, the presenter, the settings) and the presentations people publish with it. Accessibility applies to both, and the second matters most: a deck is shown to an audience that never chose Deckyard.

## Our target

**WCAG 2.2 level AA**, for the application and for the published output.

This is a target, not a compliance claim. Deckyard is in beta, has not had an independent accessibility audit, and has no automated accessibility testing (such as axe) in CI yet. What follows is what is built in today, what is up to you as an author, and where the known gaps are.

## What is built in

**Images need a name before a deck goes public.** Publishing refuses a deck with a content image that has no alt text, in any of its languages. An image can instead be marked as decorative, which is a deliberate choice rather than an omission. An already published deck that gains an unnamed image shows a warning in the editor. Alt text can be drafted with AI for every language the deck has, for the author to check.

**Contrast is measured, not assumed.** The theme editor reports every text/background pair against WCAG 2.2 while you pick the colours, with the APCA reading as a second opinion ([`docs/reference/contrast.md`](../docs/reference/contrast.md)). Text over a background image gets its light or dark colour, and a scrim where needed, from a measurement of the image itself ([`docs/reference/slide-background-contrast.md`](../docs/reference/slide-background-contrast.md)).

**Every published deck is also a document.** Next to the slide view, each published deck has a reader view at `/p/<id>-<slug>/reader`: semantic, reflowable HTML that stays readable with JavaScript and author CSS turned off. Headings are headings, lists are lists, and chart and table data become real `<table>` elements ([`docs/reference/reflowable-html-export.md`](../docs/reference/reflowable-html-export.md)).

**Language is declared.** Published and exported decks carry the deck's language in `<html lang>`, and a multilingual deck is served per language.

**The interface follows a few fixed patterns.** Dialogs trap focus and are labelled for assistive technology; form errors are shown next to the field they concern instead of in a passing toast ([`docs/reference/feedback-surfaces.md`](../docs/reference/feedback-surfaces.md)); toasts and banners use live regions; animations respect `prefers-reduced-motion`; the presenter is driven by the keyboard.

## What is up to you as an author

Deckyard can check some things, but not judge them:

- **Alt text that says something.** The publish check knows an image has a name, not that the name is useful.
- **Your theme.** The contrast badge informs and never blocks; a brand may choose low contrast, and that choice is yours.
- **The deck's language.** Set it, so screen readers pronounce the content correctly.
- **Share the reader view** with people who cannot follow the slides, or who want to read along at their own pace.

## Known gaps

- No independent audit, and no automated accessibility checks in CI.
- The editor's direct-manipulation surfaces (inline editing on the canvas, drag and drop) have not been tested with screen readers or keyboard-only use.
- Interactive slides (polls, live feedback, follow-along) have not been tested systematically with assistive technology.

## Reporting a problem

Found a barrier, in the application or in a published deck? Open an [issue](https://github.com/jaapstronks/deckyard/issues/new/choose) with the bug template and put **"Accessibility:"** at the start of the title. Please mention what you were trying to do, which assistive technology and browser you used, and what happened instead. Accessibility problems are treated as bugs, not as feature requests.

Support is best effort by a single maintainer; see [`SUPPORT.md`](../SUPPORT.md) and [`GOVERNANCE.md`](../GOVERNANCE.md).
