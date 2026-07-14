/**
 * Migration to rename 'subtitle' field to 'subheading' in slide content.
 *
 * Affected slide types: title-slide, ciiic-title-slide, logo-wall-slide, split-partner-title-slide
 *
 * Tables updated:
 * - presentations.slides (array of slide objects with content)
 * - slide_library.content (single slide content object)
 * - presentation_versions.presentation_data (contains slides array)
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // 1. Update presentations.slides - each slide has a content object
  // For each slide in the array, if content.subtitle exists and content.subheading doesn't,
  // move the value from subtitle to subheading
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->'content' ? 'subtitle' AND NOT (slide->'content' ? 'subheading')
          THEN jsonb_set(
            slide #- '{content,subtitle}',
            '{content,subheading}',
            slide->'content'->'subtitle'
          )
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->'content' ? 'subtitle' AND NOT (s->'content' ? 'subheading')
    )
  `.execute(db);

  // 2. Update slide_library.content - direct content object
  await sql`
    UPDATE slide_library
    SET content = (content - 'subtitle') || jsonb_build_object('subheading', content->'subtitle')
    WHERE content ? 'subtitle' AND NOT (content ? 'subheading')
  `.execute(db);

  // 3. Update presentation_versions.presentation_data.slides
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->'content' ? 'subtitle' AND NOT (slide->'content' ? 'subheading')
            THEN jsonb_set(
              slide #- '{content,subtitle}',
              '{content,subheading}',
              slide->'content'->'subtitle'
            )
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->'content' ? 'subtitle' AND NOT (s->'content' ? 'subheading')
    )
  `.execute(db);
};

export const down = async (db) => {
  // Reverse the migration: rename subheading back to subtitle for affected slide types
  // Note: This is a lossy operation if new slides were created with subheading

  // 1. Update presentations.slides
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' IN ('title-slide', 'ciiic-title-slide', 'logo-wall-slide', 'split-partner-title-slide')
            AND slide->'content' ? 'subheading'
            AND NOT (slide->'content' ? 'subtitle')
          THEN jsonb_set(
            slide #- '{content,subheading}',
            '{content,subtitle}',
            slide->'content'->'subheading'
          )
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' IN ('title-slide', 'ciiic-title-slide', 'logo-wall-slide', 'split-partner-title-slide')
        AND s->'content' ? 'subheading'
        AND NOT (s->'content' ? 'subtitle')
    )
  `.execute(db);

  // 2. Update slide_library.content
  await sql`
    UPDATE slide_library
    SET content = (content - 'subheading') || jsonb_build_object('subtitle', content->'subheading')
    WHERE type IN ('title-slide', 'ciiic-title-slide', 'logo-wall-slide', 'split-partner-title-slide')
      AND content ? 'subheading'
      AND NOT (content ? 'subtitle')
  `.execute(db);

  // 3. Update presentation_versions.presentation_data.slides
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' IN ('title-slide', 'ciiic-title-slide', 'logo-wall-slide', 'split-partner-title-slide')
              AND slide->'content' ? 'subheading'
              AND NOT (slide->'content' ? 'subtitle')
            THEN jsonb_set(
              slide #- '{content,subheading}',
              '{content,subtitle}',
              slide->'content'->'subheading'
            )
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' IN ('title-slide', 'ciiic-title-slide', 'logo-wall-slide', 'split-partner-title-slide')
        AND s->'content' ? 'subheading'
        AND NOT (s->'content' ? 'subtitle')
    )
  `.execute(db);
};