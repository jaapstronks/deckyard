/**
 * Import progress ladder
 *
 * One progress model for every import that streams over SSE (file conversion,
 * Notion, the paste-text wizard). The phases are the same everywhere, so the
 * numbers, the phase words and the copy live here rather than being re-picked
 * per route — a second ladder is how the bar started walking backwards
 * (B595).
 *
 * The ladder is monotone by construction: each phase starts where the previous
 * one ended, and the two phases that are a single model call creep toward the
 * next floor instead of standing still. Contract and rationale:
 * `docs/reference/import-progress.md`.
 */

import { DEFAULT_DECK_LANG, normalizeLang } from '../../shared/i18n-utils.js';
import { sseWrite } from './sse.js';

/** Phase boundaries, in percent. */
export const PROGRESS = Object.freeze({
  /** Accepted, reading and parsing the source. */
  parse: 5,
  /** First section group written; the outline creep may approach but not reach this. */
  refineFloor: 55,
  /** All section groups written. */
  refineCeiling: 85,
  /** Assembling the deck. */
  building: 90,
  /** Writing it to the library. */
  save: 95,
});

/**
 * Expected wall-clock of the outline call, used as the creep's time constant.
 * Measured at ~34s for a document import (gpt-5.2, 2026-10-05); the creep is
 * asymptotic, so a slower call keeps moving and a faster one is simply
 * overtaken by the first real event.
 */
export const OUTLINE_CREEP_MS = 35000;

/**
 * Expected wall-clock of the refine phase, used as its creep's time constant.
 * `onGroupDone` is real progress, but `refineAllSlideGroups` runs up to six
 * groups in parallel: a deck with one batch reports nothing until the batch
 * lands. The creep covers that window; a real tick overtakes it.
 */
export const REFINE_CREEP_MS = 25000;

/**
 * The progress copy, per language. The deck language is not known until the
 * outline is in, so the lines before it follow the request (or the default
 * deck language); everything after follows the language the generation
 * settled on. A language without its own copy reads English.
 */
const COPY = Object.freeze({
  nl: {
    analyzing: 'Inhoud analyseren en structuur bepalen…',
    outlineReady: (slides, sections) =>
      `Outline klaar: ${slides} slides in ${sections} secties…`,
    groupDone: (done, total) => `Sectie ${done} van ${total} geschreven…`,
    generated: (n) => `${n} slide${n === 1 ? '' : 's'} gegenereerd…`,
    saving: 'Opslaan in bibliotheek…',
  },
  en: {
    analyzing: 'Analyzing content and structure…',
    outlineReady: (slides, sections) =>
      `Outline ready: ${slides} slides in ${sections} sections…`,
    groupDone: (done, total) => `Wrote section ${done} of ${total}…`,
    generated: (n) => `Generated ${n} slide${n === 1 ? '' : 's'}…`,
    saving: 'Saving to library…',
  },
});

/**
 * What the client's rotator shows while a source is read and the outline
 * call runs, per source. The PDF parser reads text only, so its list
 * promises no image detection (B306).
 */
export const SOURCE_MESSAGES = Object.freeze({
  pptx: {
    nl: [
      'PowerPoint-bestand laden…',
      'Slides analyseren…',
      'Tekst extraheren…',
      'Afbeeldingen zoeken…',
    ],
    en: [
      'Loading PowerPoint file…',
      'Analyzing slides…',
      'Extracting text content…',
      'Looking for images…',
    ],
  },
  pdf: {
    nl: ['PDF-bestand laden…', "Pagina's analyseren…", 'Tekst extraheren…'],
    en: ['Loading PDF file…', 'Analyzing pages…', 'Extracting text content…'],
  },
  document: {
    nl: [
      'Document laden…',
      'Tekst extraheren…',
      'Structuur analyseren…',
      'Secties identificeren…',
    ],
    en: [
      'Loading document…',
      'Extracting text…',
      'Analyzing structure…',
      'Identifying sections…',
    ],
  },
  file: {
    nl: ['Bestand laden…', 'Inhoud extraheren…'],
    en: ['Loading file…', 'Extracting content…'],
  },
  notion: {
    nl: [
      'Notion-pagina ophalen…',
      'Inhoud analyseren…',
      'Afbeeldingen verwerken…',
    ],
    en: ['Fetching Notion page…', 'Analyzing content…', 'Processing images…'],
  },
});

/** The copy key for a deck or request language: `en-GB` reads `en`. */
function copyLang(lang) {
  const base = normalizeLang(lang)?.split('-')[0];
  return base && Object.hasOwn(COPY, base) ? base : 'en';
}

/**
 * The one writer of an import's progress over SSE (B758).
 *
 * Every streaming generation (file, Notion, the paste-text wizard) reports
 * the same phases on the same ladder, so the `messages`/`status` sequence is
 * written here and no route picks a phase word, a number or a sentence. The
 * phases, in order: `outline` (written on creation, creeps toward the refine
 * floor), `refine` (the outline is in), `refine-progress` (a section group is
 * written), `finalize` (the deck is generated) and `save` (it is being
 * written). The client binder (`createProgressBinding`) reads exactly these.
 *
 * The returned `onOutline`, `onStatusMessage` and `onGroupDone` are the hooks
 * of `generateSlides()`; `finalize()` and `save()` close the sequence. The
 * route still writes its own `complete` and `error`.
 *
 * @param {import('node:http').ServerResponse} res - An open SSE stream.
 * @param {Object} [opts]
 * @param {string|null} [opts.lang] - The requested deck language; the copy
 *   before the outline follows it, or the default deck language.
 * @param {{ nl: string[], en: string[] }} [opts.initialMessages] - The
 *   rotator's list while the source is read (`SOURCE_MESSAGES.*`).
 * @returns {{
 *   onOutline: (outline: Object, info: { sections: number, lang: string }) => void,
 *   onStatusMessage: (message: string) => void,
 *   onGroupDone: (progress: { done: number, total: number }) => void,
 *   finalize: (slideCount: number) => void,
 *   save: () => void,
 * }}
 */
export function createSseProgress(res, { lang = null, initialMessages } = {}) {
  const requestLang = copyLang(normalizeLang(lang) || DEFAULT_DECK_LANG);
  let copy = COPY[requestLang];
  let phase = 'outline';

  const status = (data) => sseWrite(res, { event: 'status', data });

  // Handed to the client's rotator rather than paced here with sleeps: the
  // work starts immediately and the rotator fills the wait (B595).
  if (initialMessages) {
    sseWrite(res, {
      event: 'messages',
      data: {
        statusMessages: initialMessages[requestLang],
        intervalMs: 6000,
        loop: true,
      },
    });
  }
  // Reading the source plus the outline call is one long stretch without
  // events, so the bar creeps toward the refine floor instead of standing
  // still.
  status({
    message: copy.analyzing,
    phase,
    progress: PROGRESS.parse,
    creepTo: PROGRESS.refineFloor,
    creepMs: OUTLINE_CREEP_MS,
  });

  return {
    onOutline: (outline, { sections, lang: deckLang } = {}) => {
      copy = COPY[copyLang(deckLang)];
      phase = 'refine';
      // The rotator replays the outline's content-aware messages while the
      // sections are written.
      if (outline?.statusMessages?.length > 0) {
        sseWrite(res, {
          event: 'messages',
          data: { statusMessages: outline.statusMessages },
        });
      }
      // The outline is a real milestone, so the bar lands on the refine
      // floor; from there the phase creeps until a group reports.
      status({
        message: copy.outlineReady(outline?.slides?.length ?? 0, sections ?? 0),
        phase,
        progress: PROGRESS.refineFloor,
        creepTo: PROGRESS.refineCeiling,
        creepMs: REFINE_CREEP_MS,
      });
    },
    // Message only: the bar belongs to the creep and the real events, and
    // the client shows the line only while its rotator has nothing to say.
    onStatusMessage: (message) => status({ message, phase }),
    // Real progress: one event per finished section group.
    onGroupDone: ({ done, total }) =>
      status({
        message: copy.groupDone(done, total),
        phase: 'refine-progress',
        progress: Math.round(
          PROGRESS.refineFloor +
            (done / total) * (PROGRESS.refineCeiling - PROGRESS.refineFloor),
        ),
      }),
    finalize: (slideCount) =>
      status({
        message: copy.generated(slideCount),
        phase: 'finalize',
        progress: PROGRESS.building,
      }),
    save: () =>
      status({ message: copy.saving, phase: 'save', progress: PROGRESS.save }),
  };
}
