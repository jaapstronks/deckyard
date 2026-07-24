/**
 * Migration to standardize field terminology across slide types.
 *
 * Changes:
 * 1. card-stack-slide: Copy cardNLabel to cardNTitle (for N = 1-4)
 * 2. process-slide: Copy steps to items
 * 3. cycle-slide: Copy stages to items
 * 4. funnel-slide: Copy stages to items
 *
 * Tables updated:
 * - presentations.slides (array of slide objects with content)
 * - presentations.i18n (contains versions.*.slides arrays for translations)
 * - slide_library.content (single slide content object)
 * - presentation_versions.presentation_data (contains slides array)
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // =============================================
  // Part 1: Update presentations.slides
  // =============================================

  // 1a. card-stack-slide: cardNLabel -> cardNTitle
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'card-stack-slide'
          THEN (
            WITH migrated AS (
              SELECT
                CASE WHEN slide->'content' ? 'card1Label' AND NOT (slide->'content' ? 'card1Title')
                  THEN jsonb_set(slide, '{content,card1Title}', slide->'content'->'card1Label')
                  ELSE slide
                END as s1
            ),
            m2 AS (
              SELECT
                CASE WHEN s1->'content' ? 'card2Label' AND NOT (s1->'content' ? 'card2Title')
                  THEN jsonb_set(s1, '{content,card2Title}', s1->'content'->'card2Label')
                  ELSE s1
                END as s2
              FROM migrated
            ),
            m3 AS (
              SELECT
                CASE WHEN s2->'content' ? 'card3Label' AND NOT (s2->'content' ? 'card3Title')
                  THEN jsonb_set(s2, '{content,card3Title}', s2->'content'->'card3Label')
                  ELSE s2
                END as s3
              FROM m2
            ),
            m4 AS (
              SELECT
                CASE WHEN s3->'content' ? 'card4Label' AND NOT (s3->'content' ? 'card4Title')
                  THEN jsonb_set(s3, '{content,card4Title}', s3->'content'->'card4Label')
                  ELSE s3
                END as result
              FROM m3
            )
            SELECT result FROM m4
          )
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'card-stack-slide'
        AND (s->'content' ? 'card1Label' OR s->'content' ? 'card2Label' OR s->'content' ? 'card3Label' OR s->'content' ? 'card4Label')
    )
  `.execute(db);

  // 1b. process-slide: steps -> items
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'process-slide'
            AND slide->'content' ? 'steps'
            AND NOT (slide->'content' ? 'items')
          THEN jsonb_set(slide, '{content,items}', slide->'content'->'steps')
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'process-slide'
        AND s->'content' ? 'steps'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // 1c. cycle-slide: stages -> items
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'cycle-slide'
            AND slide->'content' ? 'stages'
            AND NOT (slide->'content' ? 'items')
          THEN jsonb_set(slide, '{content,items}', slide->'content'->'stages')
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'cycle-slide'
        AND s->'content' ? 'stages'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // 1d. funnel-slide: stages -> items
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'funnel-slide'
            AND slide->'content' ? 'stages'
            AND NOT (slide->'content' ? 'items')
          THEN jsonb_set(slide, '{content,items}', slide->'content'->'stages')
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'funnel-slide'
        AND s->'content' ? 'stages'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // =============================================
  // Part 2: Update slide_library.content
  // =============================================

  // 2a. card-stack-slide: cardNLabel -> cardNTitle
  await sql`
    UPDATE slide_library
    SET content = (
      WITH m1 AS (
        SELECT
          CASE WHEN content ? 'card1Label' AND NOT (content ? 'card1Title')
            THEN content || jsonb_build_object('card1Title', content->'card1Label')
            ELSE content
          END as c1
      ),
      m2 AS (
        SELECT
          CASE WHEN c1 ? 'card2Label' AND NOT (c1 ? 'card2Title')
            THEN c1 || jsonb_build_object('card2Title', c1->'card2Label')
            ELSE c1
          END as c2
        FROM m1
      ),
      m3 AS (
        SELECT
          CASE WHEN c2 ? 'card3Label' AND NOT (c2 ? 'card3Title')
            THEN c2 || jsonb_build_object('card3Title', c2->'card3Label')
            ELSE c2
          END as c3
        FROM m2
      ),
      m4 AS (
        SELECT
          CASE WHEN c3 ? 'card4Label' AND NOT (c3 ? 'card4Title')
            THEN c3 || jsonb_build_object('card4Title', c3->'card4Label')
            ELSE c3
          END as result
        FROM m3
      )
      SELECT result FROM m4
    )
    WHERE slide_type = 'card-stack-slide'
      AND (content ? 'card1Label' OR content ? 'card2Label' OR content ? 'card3Label' OR content ? 'card4Label')
  `.execute(db);

  // 2b. process-slide: steps -> items
  await sql`
    UPDATE slide_library
    SET content = content || jsonb_build_object('items', content->'steps')
    WHERE slide_type = 'process-slide'
      AND content ? 'steps'
      AND NOT (content ? 'items')
  `.execute(db);

  // 2c. cycle-slide: stages -> items
  await sql`
    UPDATE slide_library
    SET content = content || jsonb_build_object('items', content->'stages')
    WHERE slide_type = 'cycle-slide'
      AND content ? 'stages'
      AND NOT (content ? 'items')
  `.execute(db);

  // 2d. funnel-slide: stages -> items
  await sql`
    UPDATE slide_library
    SET content = content || jsonb_build_object('items', content->'stages')
    WHERE slide_type = 'funnel-slide'
      AND content ? 'stages'
      AND NOT (content ? 'items')
  `.execute(db);

  // =============================================
  // Part 3: Update presentation_versions.presentation_data.slides
  // =============================================

  // 3a. card-stack-slide: cardNLabel -> cardNTitle
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' = 'card-stack-slide'
            THEN (
              WITH migrated AS (
                SELECT
                  CASE WHEN slide->'content' ? 'card1Label' AND NOT (slide->'content' ? 'card1Title')
                    THEN jsonb_set(slide, '{content,card1Title}', slide->'content'->'card1Label')
                    ELSE slide
                  END as s1
              ),
              m2 AS (
                SELECT
                  CASE WHEN s1->'content' ? 'card2Label' AND NOT (s1->'content' ? 'card2Title')
                    THEN jsonb_set(s1, '{content,card2Title}', s1->'content'->'card2Label')
                    ELSE s1
                  END as s2
                FROM migrated
              ),
              m3 AS (
                SELECT
                  CASE WHEN s2->'content' ? 'card3Label' AND NOT (s2->'content' ? 'card3Title')
                    THEN jsonb_set(s2, '{content,card3Title}', s2->'content'->'card3Label')
                    ELSE s2
                  END as s3
                FROM m2
              ),
              m4 AS (
                SELECT
                  CASE WHEN s3->'content' ? 'card4Label' AND NOT (s3->'content' ? 'card4Title')
                    THEN jsonb_set(s3, '{content,card4Title}', s3->'content'->'card4Label')
                    ELSE s3
                  END as result
                FROM m3
              )
              SELECT result FROM m4
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
      WHERE s->>'type' = 'card-stack-slide'
        AND (s->'content' ? 'card1Label' OR s->'content' ? 'card2Label' OR s->'content' ? 'card3Label' OR s->'content' ? 'card4Label')
    )
  `.execute(db);

  // 3b. process-slide: steps -> items
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' = 'process-slide'
              AND slide->'content' ? 'steps'
              AND NOT (slide->'content' ? 'items')
            THEN jsonb_set(slide, '{content,items}', slide->'content'->'steps')
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' = 'process-slide'
        AND s->'content' ? 'steps'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // 3c. cycle-slide: stages -> items
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' = 'cycle-slide'
              AND slide->'content' ? 'stages'
              AND NOT (slide->'content' ? 'items')
            THEN jsonb_set(slide, '{content,items}', slide->'content'->'stages')
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' = 'cycle-slide'
        AND s->'content' ? 'stages'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // 3d. funnel-slide: stages -> items
  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' = 'funnel-slide'
              AND slide->'content' ? 'stages'
              AND NOT (slide->'content' ? 'items')
            THEN jsonb_set(slide, '{content,items}', slide->'content'->'stages')
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(presentation_data->'slides') AS s
      WHERE s->>'type' = 'funnel-slide'
        AND s->'content' ? 'stages'
        AND NOT (s->'content' ? 'items')
    )
  `.execute(db);

  // =============================================
  // Part 4: Update presentations.i18n (translation versions)
  // This is complex because i18n contains versions keyed by language code
  // Structure: i18n.versions.{lang}.slides[]
  // =============================================

  // Helper function to migrate slides in a language version
  // We use a PL/pgSQL function for cleaner handling

  // 4a. Create a helper function for migrating i18n slides
  await sql`
    CREATE OR REPLACE FUNCTION migrate_i18n_terminology(i18n_data jsonb)
    RETURNS jsonb AS $$
    DECLARE
      result jsonb := i18n_data;
      lang_key text;
      lang_data jsonb;
      slides jsonb;
      migrated_slides jsonb;
    BEGIN
      -- If no versions, return as is
      IF NOT (result ? 'versions') THEN
        RETURN result;
      END IF;

      -- Iterate over each language version
      FOR lang_key, lang_data IN SELECT * FROM jsonb_each(result->'versions')
      LOOP
        IF lang_data ? 'slides' THEN
          -- Migrate slides array
          SELECT jsonb_agg(
            CASE
              -- card-stack-slide: cardNLabel -> cardNTitle
              WHEN slide->>'type' = 'card-stack-slide' THEN
                (
                  SELECT
                    CASE WHEN s4 ? 'card4Label' AND NOT (s4 ? 'card4Title')
                      THEN s4 || jsonb_build_object('card4Title', s4->'card4Label')
                      ELSE s4
                    END
                  FROM (
                    SELECT
                      CASE WHEN s3 ? 'card3Label' AND NOT (s3 ? 'card3Title')
                        THEN s3 || jsonb_build_object('card3Title', s3->'card3Label')
                        ELSE s3
                      END as s4
                    FROM (
                      SELECT
                        CASE WHEN s2 ? 'card2Label' AND NOT (s2 ? 'card2Title')
                          THEN s2 || jsonb_build_object('card2Title', s2->'card2Label')
                          ELSE s2
                        END as s3
                      FROM (
                        SELECT
                          CASE WHEN slide ? 'card1Label' AND NOT (slide ? 'card1Title')
                            THEN slide || jsonb_build_object('card1Title', slide->'card1Label')
                            ELSE slide
                          END as s2
                      ) t1
                    ) t2
                  ) t3
                )
              -- process-slide: steps -> items
              WHEN slide->>'type' = 'process-slide'
                AND slide ? 'steps'
                AND NOT (slide ? 'items')
              THEN slide || jsonb_build_object('items', slide->'steps')
              -- cycle-slide: stages -> items
              WHEN slide->>'type' = 'cycle-slide'
                AND slide ? 'stages'
                AND NOT (slide ? 'items')
              THEN slide || jsonb_build_object('items', slide->'stages')
              -- funnel-slide: stages -> items
              WHEN slide->>'type' = 'funnel-slide'
                AND slide ? 'stages'
                AND NOT (slide ? 'items')
              THEN slide || jsonb_build_object('items', slide->'stages')
              ELSE slide
            END
          )
          INTO migrated_slides
          FROM jsonb_array_elements(lang_data->'slides') AS slide;

          -- Update the result with migrated slides
          result := jsonb_set(
            result,
            ARRAY['versions', lang_key, 'slides'],
            COALESCE(migrated_slides, '[]'::jsonb)
          );
        END IF;
      END LOOP;

      RETURN result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `.execute(db);

  // 4b. Apply the migration function to all presentations with i18n data
  await sql`
    UPDATE presentations
    SET i18n = migrate_i18n_terminology(i18n)
    WHERE i18n IS NOT NULL
      AND i18n ? 'versions'
  `.execute(db);

  // 4c. Drop the helper function
  await sql`
    DROP FUNCTION IF EXISTS migrate_i18n_terminology(jsonb);
  `.execute(db);
};

export const down = async (db) => {
  // Note: The down migration removes the new field names.
  // This is safe because the code has fallback support for old names.
  // After April 2026, the old fields should be removed entirely.

  // =============================================
  // Part 1: Update presentations.slides - remove new fields
  // =============================================

  // 1a. card-stack-slide: remove cardNTitle (keep cardNLabel)
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'card-stack-slide'
          THEN slide #- '{content,card1Title}' #- '{content,card2Title}' #- '{content,card3Title}' #- '{content,card4Title}'
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'card-stack-slide'
    )
  `.execute(db);

  // 1b. process-slide: remove items (keep steps)
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'process-slide'
          THEN slide #- '{content,items}'
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'process-slide'
    )
  `.execute(db);

  // 1c. cycle-slide: remove items (keep stages)
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'cycle-slide'
          THEN slide #- '{content,items}'
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'cycle-slide'
    )
  `.execute(db);

  // 1d. funnel-slide: remove items (keep stages)
  await sql`
    UPDATE presentations
    SET slides = (
      SELECT jsonb_agg(
        CASE
          WHEN slide->>'type' = 'funnel-slide'
          THEN slide #- '{content,items}'
          ELSE slide
        END
      )
      FROM jsonb_array_elements(slides) AS slide
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(slides) AS s
      WHERE s->>'type' = 'funnel-slide'
    )
  `.execute(db);

  // =============================================
  // Part 2: Update slide_library.content
  // =============================================

  await sql`
    UPDATE slide_library
    SET content = content - 'card1Title' - 'card2Title' - 'card3Title' - 'card4Title'
    WHERE slide_type = 'card-stack-slide'
  `.execute(db);

  await sql`
    UPDATE slide_library
    SET content = content - 'items'
    WHERE slide_type IN ('process-slide', 'cycle-slide', 'funnel-slide')
  `.execute(db);

  // =============================================
  // Part 3: Update presentation_versions
  // =============================================

  await sql`
    UPDATE presentation_versions
    SET presentation_data = jsonb_set(
      presentation_data,
      '{slides}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN slide->>'type' = 'card-stack-slide'
            THEN slide #- '{content,card1Title}' #- '{content,card2Title}' #- '{content,card3Title}' #- '{content,card4Title}'
            WHEN slide->>'type' IN ('process-slide', 'cycle-slide', 'funnel-slide')
            THEN slide #- '{content,items}'
            ELSE slide
          END
        )
        FROM jsonb_array_elements(presentation_data->'slides') AS slide
      )
    )
    WHERE presentation_data ? 'slides'
  `.execute(db);

  // =============================================
  // Part 4: Update presentations.i18n
  // =============================================

  await sql`
    CREATE OR REPLACE FUNCTION revert_i18n_terminology(i18n_data jsonb)
    RETURNS jsonb AS $$
    DECLARE
      result jsonb := i18n_data;
      lang_key text;
      lang_data jsonb;
      migrated_slides jsonb;
    BEGIN
      IF NOT (result ? 'versions') THEN
        RETURN result;
      END IF;

      FOR lang_key, lang_data IN SELECT * FROM jsonb_each(result->'versions')
      LOOP
        IF lang_data ? 'slides' THEN
          SELECT jsonb_agg(
            CASE
              WHEN slide->>'type' = 'card-stack-slide'
              THEN slide - 'card1Title' - 'card2Title' - 'card3Title' - 'card4Title'
              WHEN slide->>'type' IN ('process-slide', 'cycle-slide', 'funnel-slide')
              THEN slide - 'items'
              ELSE slide
            END
          )
          INTO migrated_slides
          FROM jsonb_array_elements(lang_data->'slides') AS slide;

          result := jsonb_set(
            result,
            ARRAY['versions', lang_key, 'slides'],
            COALESCE(migrated_slides, '[]'::jsonb)
          );
        END IF;
      END LOOP;

      RETURN result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `.execute(db);

  await sql`
    UPDATE presentations
    SET i18n = revert_i18n_terminology(i18n)
    WHERE i18n IS NOT NULL
      AND i18n ? 'versions'
  `.execute(db);

  await sql`
    DROP FUNCTION IF EXISTS revert_i18n_terminology(jsonb);
  `.execute(db);
};