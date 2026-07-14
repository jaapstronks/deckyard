/**
 * Content Slide Type Definitions
 *
 * This file consolidates all content slide types from their thematic modules.
 * The slide definitions are split into smaller files for maintainability:
 *
 * - basic-content-slides.js: Text and list-based slides
 * - visual-content-slides.js: Images, tables, charts
 * - card-slides.js: Card-based layouts (icon grids, stacks, blocks, KPIs)
 * - diagram-slides.js: Process diagrams, timelines, matrices
 *
 * These are resolved in Phase 2 of AI generation.
 */

import { BASIC_CONTENT_SLIDES } from './basic-content-slides.js';
import { VISUAL_CONTENT_SLIDES } from './visual-content-slides.js';
import { CARD_SLIDES } from './card-slides.js';
import { DIAGRAM_SLIDES } from './diagram-slides.js';

export const CONTENT_SLIDES = {
  ...BASIC_CONTENT_SLIDES,
  ...VISUAL_CONTENT_SLIDES,
  ...CARD_SLIDES,
  ...DIAGRAM_SLIDES,
};