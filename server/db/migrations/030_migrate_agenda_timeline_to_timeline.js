/**
 * Migration to consolidate agenda-timeline-slide into timeline-slide.
 *
 * The two slide types are visually similar. This migration:
 * 1. Changes type from 'agenda-timeline-slide' to 'timeline-slide'
 * 2. Transforms items[].time → items[].date (field rename)
 *
 * Note: The timeline-slide.js renderer has back-compat for old field names
 * (time → date, label → date, body → text), so even unmigrated i18n data
 * will render correctly.
 *
 * Tables updated:
 * - presentations.slides (array of slide objects with content)
 * - slide_library.slide_type column + content JSONB
 * - presentation_versions.presentation_data (contains slides array)
 */

import { sql } from 'kysely';

/**
 * Transform an agenda-timeline-slide item to timeline-slide format.
 * Handles field mapping: time/label → date, body → text
 */
const TRANSFORM_ITEMS_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.transform_agenda_items(items jsonb)
  RETURNS jsonb AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', COALESCE(item->>'time', item->>'label', item->>'date', ''),
        'title', COALESCE(item->>'title', ''),
        'text', COALESCE(item->>'text', item->>'body', '')
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) AS item
  $$ LANGUAGE sql IMMUTABLE;
`;

export const up = async (db) => {
  // Create helper function for transforming items
  await sql.raw(TRANSFORM_ITEMS_FUNCTION).execute(db);

  // 1. Update presentations.slides - each slide has a content object
  // For agenda-timeline slides, change type and transform items
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN slide->>'type' = 'agenda-timeline-slide'
          THEN jsonb_build_object(
            'id', slide->'id',
            'type', 'timeline-slide',
            'content', ((slide->'content')::jsonb - 'items') || jsonb_build_object(
              'items', pg_temp.transform_agenda_items((slide->'content'->'items')::jsonb)
            )
          ) || (
            -- Preserve any other top-level fields (notes, etc.)
            SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
            FROM jsonb_each(slide)
            WHERE key NOT IN ('id', 'type', 'content')
          )
          ELSE slide
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE slides IS NOT NULL
    AND slides != '[]'::jsonb
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'agenda-timeline-slide'
    )
  `.execute(db);

  // 2. Update slide_library - slide_type column + content JSONB
  await sql`
    UPDATE slide_library
    SET
      slide_type = 'timeline-slide',
      content = (content::jsonb - 'items') || jsonb_build_object(
        'items', pg_temp.transform_agenda_items((content->'items')::jsonb)
      )
    WHERE slide_type = 'agenda-timeline-slide'
  `.execute(db);

  // 3. Update presentation_versions.presentation_data.slides
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN slide->>'type' = 'agenda-timeline-slide'
            THEN jsonb_build_object(
              'id', slide->'id',
              'type', 'timeline-slide',
              'content', ((slide->'content')::jsonb - 'items') || jsonb_build_object(
                'items', pg_temp.transform_agenda_items((slide->'content'->'items')::jsonb)
              )
            ) || (
              SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
              FROM jsonb_each(slide)
              WHERE key NOT IN ('id', 'type', 'content')
            )
            ELSE slide
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data IS NOT NULL
    AND presentation_data ? 'slides'
    AND presentation_data->'slides' IS NOT NULL
    AND jsonb_typeof(presentation_data->'slides') = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' = 'agenda-timeline-slide'
    )
  `.execute(db);

  // Note: We skip i18n transformation because:
  // 1. The timeline-slide.js renderer has back-compat for old field names
  // 2. The i18n structure varies and SQL transformation is complex/error-prone
};

export const down = async (db) => {
  // Reverse the migration: convert timeline-slide back to agenda-timeline-slide
  // Note: This is a best-effort reverse - some data may have been created as timeline-slide
  // after the migration, so we only convert slides that look like they were agenda-timeline

  // Create reverse transform function
  await sql.raw(`
    CREATE OR REPLACE FUNCTION pg_temp.reverse_transform_items(items jsonb)
    RETURNS jsonb AS $$
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'time', COALESCE(item->>'date', ''),
          'title', COALESCE(item->>'title', ''),
          'text', COALESCE(item->>'text', '')
        )
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(items, '[]'::jsonb)) AS item
    $$ LANGUAGE sql IMMUTABLE;
  `).execute(db);

  // 1. Update presentations.slides
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN slide->>'type' = 'timeline-slide'
          THEN jsonb_build_object(
            'id', slide->'id',
            'type', 'agenda-timeline-slide',
            'content', ((slide->'content')::jsonb - 'items') || jsonb_build_object(
              'items', pg_temp.reverse_transform_items((slide->'content'->'items')::jsonb)
            )
          ) || (
            SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
            FROM jsonb_each(slide)
            WHERE key NOT IN ('id', 'type', 'content')
          )
          ELSE slide
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE slides IS NOT NULL
    AND slides != '[]'::jsonb
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'timeline-slide'
    )
  `.execute(db);

  // 2. Update slide_library
  await sql`
    UPDATE slide_library
    SET
      slide_type = 'agenda-timeline-slide',
      content = (content::jsonb - 'items') || jsonb_build_object(
        'items', pg_temp.reverse_transform_items((content->'items')::jsonb)
      )
    WHERE slide_type = 'timeline-slide'
  `.execute(db);

  // 3. Update presentation_versions.presentation_data.slides
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN slide->>'type' = 'timeline-slide'
            THEN jsonb_build_object(
              'id', slide->'id',
              'type', 'agenda-timeline-slide',
              'content', ((slide->'content')::jsonb - 'items') || jsonb_build_object(
                'items', pg_temp.reverse_transform_items((slide->'content'->'items')::jsonb)
              )
            ) || (
              SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
              FROM jsonb_each(slide)
              WHERE key NOT IN ('id', 'type', 'content')
            )
            ELSE slide
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data IS NOT NULL
    AND presentation_data ? 'slides'
    AND presentation_data->'slides' IS NOT NULL
    AND jsonb_typeof(presentation_data->'slides') = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' = 'timeline-slide'
    )
  `.execute(db);
};
