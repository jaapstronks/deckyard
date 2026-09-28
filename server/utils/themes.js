import { DEFAULT_THEME_REF } from '../../shared/constants/themes.js';
import {
  getThemeRecord,
  listThemes,
  listSeedThemes,
} from '../storage/themes.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { listAllFontFamiliesWithVariants } from '../storage/font-families.js';
import { buildThemeConfig } from './theme-builder.js';
import { slideBackgroundsCssText } from '../../shared/theme-slide-backgrounds.js';
import { normalizeTheme } from '../../shared/theme-normalize.js';
import { createLogger } from './logger.js';
import { UUID_RE } from './uuid.js';
import { AppError } from './errors.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../config/sandbox.js';
import {
  getDefaultThemeId,
  installationDefaultThemeId,
  resolveSeedThemeSlug,
} from '../storage/settings.js';

const log = createLogger('themes');

const customThemeCache = new Map(); // uuid -> { theme, organizationId }

export { DEFAULT_THEME_REF };

export function resolveThemeId(raw) {
  if (raw === DEFAULT_THEME_REF || raw == null || raw === '')
    return DEFAULT_THEME_REF;
  return typeof raw === 'string' &&
    UUID_RE.test(raw) &&
    raw === raw.toLowerCase()
    ? raw
    : null;
}

/** The installation default seed, loaded (`installationDefaultThemeId`). */
async function installationDefault(repoRoot, ctx) {
  const scope = ctx?.organizationId ? ctx : null;
  const id = await installationDefaultThemeId();
  return loadCustomThemeRecord(id, scope, repoRoot);
}

/**
 * The loaded theme a deck is being created or imported against, or `null`.
 *
 * Tolerant by design and shared by every write route: a slide's composition
 * (`newSlide`) reads the theme for background presets and slide-background
 * variants, but a deck naming a theme this instance does not carry must still
 * be importable — it simply arrives without a theme-seeded background. Six
 * routes carried this try/catch by hand, and the ones that did not silently
 * fell back to "no theme" for a theme that exists.
 *
 * @param {string} repoRoot
 * @param {string} [rawThemeId] - the deck's theme UUID or `default`
 * @param {Object} [ctx] - storage context, for a DB-backed custom theme
 * @returns {Promise<Object|null>} the loaded theme, or null when it cannot be
 *   loaded
 */
export async function loadDeckTheme(repoRoot, rawThemeId, ctx = null) {
  try {
    return await loadThemeAssets(repoRoot, rawThemeId, ctx);
  } catch {
    return null;
  }
}

/**
 * The theme a caller named, or `null` when this instance has no such theme.
 *
 * A write that sets a deck's theme must refuse an unknown UUID before it can
 * be stored (B446).
 *
 * @param {string} repoRoot
 * @param {string} rawThemeId - a lower-case theme UUID or `default`
 * @param {Object} [ctx] - storage scope; a custom theme must belong to its
 *   organization
 * @returns {Promise<Object|null>} the loaded theme, or null
 */
export async function findTheme(repoRoot, rawThemeId, ctx = null) {
  if (typeof rawThemeId !== 'string' || !rawThemeId) return null;
  if (rawThemeId === DEFAULT_THEME_REF)
    return loadThemeAssets(repoRoot, rawThemeId, ctx);
  if (!UUID_RE.test(rawThemeId) || rawThemeId !== rawThemeId.toLowerCase())
    return null;
  return loadCustomThemeRecord(rawThemeId, ctx, repoRoot);
}

/**
 * The theme a new deck is created with, and that theme loaded (B486).
 *
 * Every create path runs this one rule, whatever the theme's source (a
 * request, an MCP call, an imported file): an absent theme (`undefined` or
 * `null`) is the installation default, `default` in the stored deck (D232) or
 * the sandbox's own default; anything else must be a theme `findTheme` knows,
 * in its one spelling. The storage factory applies it to every create, so no
 * route can store a theme it did not check; a route that does costly work
 * before the create (an AI generation, a file conversion) calls it first as
 * well, so a refusal comes before the work instead of after it.
 *
 * @param {string} repoRoot
 * @param {unknown} requested - the theme the caller named, or absent
 * @param {Object} [ctx] - storage scope; a custom theme must belong to its
 *   organization
 * @returns {Promise<{themeId: string, theme: Object|null}>} the value to
 *   store and the loaded theme to compose slides against
 * @throws {AppError} 400 `invalid`, `details.field` = `theme`
 */
export async function settleNewDeckTheme(repoRoot, requested, ctx = null) {
  if (requested === undefined || requested === null) {
    if (sandboxEnabled()) {
      const handle = sandboxDefaultThemeId();
      const seedId = await resolveSeedThemeSlug(handle);
      if (!seedId) throw new Error(`Sandbox theme seed not found: ${handle}`);
      return {
        themeId: seedId,
        theme: await loadThemeAssets(repoRoot, seedId, ctx),
      };
    }
    return {
      themeId: DEFAULT_THEME_REF,
      theme: await loadDeckTheme(repoRoot, DEFAULT_THEME_REF, ctx),
    };
  }
  const theme = await findTheme(repoRoot, requested, ctx);
  if (!theme) {
    throw new AppError(
      `Theme not found: ${JSON.stringify(requested)}`,
      400,
      { field: 'theme' },
      'invalid',
    );
  }
  return { themeId: requested, theme };
}

export async function loadThemeAssets(repoRoot, rawThemeId, ctx = null) {
  const rawId =
    rawThemeId == null || rawThemeId === ''
      ? DEFAULT_THEME_REF
      : String(rawThemeId);
  if (rawId === DEFAULT_THEME_REF && ctx?.organizationId) {
    const configured = await getDefaultThemeId(ctx);
    if (UUID_RE.test(configured)) {
      const theme = await loadCustomThemeRecord(configured, ctx, repoRoot);
      if (theme) return theme;
    }
  }
  if (UUID_RE.test(rawId)) {
    const theme = await loadCustomThemeRecord(rawId, ctx, repoRoot);
    if (theme) return theme;
    throw new AppError(
      `Theme not found: ${rawId}`,
      404,
      { field: 'theme' },
      'not_found',
    );
  }
  if (rawId !== DEFAULT_THEME_REF) {
    throw new AppError(
      `Invalid theme ID: ${rawId}`,
      400,
      { field: 'theme' },
      'invalid',
    );
  }
  const theme = await installationDefault(repoRoot, ctx);
  if (theme) return theme;
  throw new AppError(
    'Default theme seed not found',
    503,
    { field: 'theme' },
    'unavailable',
  );
}

/**
 * The visible theme record as a render config, or null when there is none.
 *
 * @param {string} themeId - UUID of the custom theme
 * @param {Object|null} ctx - Context object (for org ID)
 * @param {string|null} repoRoot - Repository root
 * @returns {Promise<Object|null>} Normalized theme config, or null
 */
async function loadCustomThemeRecord(themeId, ctx, repoRoot) {
  // Two kinds of caller, told apart by whether they pass a ctx at all. Render
  // and export paths pass none: the theme UUID came out of the deck being
  // rendered and is the authorization (cross-organization category 1). A
  // session passes its storage scope, and then the theme has to belong to that
  // scope's organization; a session scope that names no organization (an
  // unverified user under multi-organization, see `createStorageScope`) gets
  // no database theme rather than the cross-organization read.
  const sessionScoped = ctx != null;
  if (sessionScoped && !ctx.organizationId) return null;

  // The cache is shared by every caller, so a hit has to pass the same
  // organization filter the database read below applies: a session must not be
  // handed another organization's theme because some deck render warmed the
  // cache with it (B278: `POST /api/render-slide` takes the UUID from the
  // client, not from a deck).
  const cached = customThemeCache.get(themeId);
  if (
    cached &&
    (!sessionScoped || cached.organizationId === ctx.organizationId)
  ) {
    return cached.theme;
  }

  try {
    const scope = sessionScoped
      ? ctx
      : crossOrganizationScope(
          repoRoot ?? null,
          'theme UUID resolved from the deck being rendered; render/export paths carry no session',
        );
    const dbTheme = await getThemeRecord(scope, themeId);
    if (dbTheme) {
      // Fetch managed fonts if the theme references any familyId
      let managedFonts;
      const fonts = dbTheme.fonts || {};
      if (
        (fonts.headingFamilyId || fonts.bodyFamilyId) &&
        dbTheme.organizationId
      ) {
        try {
          managedFonts = await listAllFontFamiliesWithVariants({
            organizationId: dbTheme.organizationId,
          });
        } catch {
          // Fall back to no managed fonts
        }
      }

      // Build full theme config from database record
      const themeConfig = buildThemeConfig(dbTheme, { managedFonts });
      const normalized = normalizeTheme(themeConfig);
      customThemeCache.set(themeId, {
        theme: normalized,
        organizationId: dbTheme.organizationId ?? null,
      });
      return normalized;
    }
  } catch (err) {
    log.warn(`Error loading custom theme ${themeId}:`, err.message);
  }

  return null;
}

/**
 * The theme config that rides along on an anonymous deck payload.
 *
 * A deck on a **database** theme rendered unbranded for every anonymous
 * viewer: the client resolves a UUID theme through
 * `GET /api/themes/:id/config`, which sits behind the login gate, so
 * the share viewer, the follow-along audience and the notes companion all
 * caught a 401 and silently fell back to a blank theme.
 *
 * The fix follows the deck (`POST /api/share/:token/verify`,
 * `GET /api/live-sessions/:id/deck`): the theme travels with the payload the
 * capability already authorizes, rather than through a second, id-addressed
 * route opened up to the world. Opening the config route would re-introduce
 * exactly the pattern those endpoints were built to remove — a UUID being
 * hard to guess is not an authorization story.
 *
 * Every visible UUID resolves to a record config. `default` carries its
 * resolved config because anonymous clients cannot read the workspace setting.
 *
 * What goes over the wire is `buildThemeConfig`'s projection — the same
 * derived render config the authenticated route serves, not the stored row —
 * so no ownership, organization or authorship stamp leaves with it.
 *
 * @param {string|null} repoRoot
 * @param {string} rawThemeId - `presentation.theme` as stored
 * @param {Object|null} [scope] - The deck's organization scope for `default`
 * @returns {Promise<Object|null>} Theme config, or null for an invalid reference
 */
export async function customThemeConfig(repoRoot, rawThemeId, scope = null) {
  const id = String(rawThemeId || '')
    .trim()
    .toLowerCase();
  if (id === DEFAULT_THEME_REF && scope?.organizationId) {
    return loadThemeAssets(repoRoot, id, scope);
  }
  if (!UUID_RE.test(id)) return null;
  return loadCustomThemeRecord(id, scope, repoRoot);
}

/**
 * Clear the custom theme cache (call after theme updates).
 * @param {string} [themeId] - Specific theme ID to clear, or all if not provided
 */
export function clearCustomThemeCache(themeId) {
  if (themeId) {
    customThemeCache.delete(themeId);
  } else {
    customThemeCache.clear();
  }
}

/** Hex colors we're willing to inline as a placeholder background. */
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Resolve a theme's base slide background color, for the deck-grid thumbnail
 * placeholder (shown until the rasterized PNG loads). Returns the theme's
 * `--t-color-background` cssVar when it's a plain hex, else null (the card then
 * falls back to a neutral surface). Cheap: `loadThemeAssets` is memoized.
 *
 * @param {string} repoRoot
 * @param {string} rawThemeId
 * @param {Object|null} [ctx]
 * @returns {Promise<string|null>}
 */
export async function resolveThemeThumbBg(repoRoot, rawThemeId, ctx = null) {
  try {
    const theme = await loadThemeAssets(repoRoot, rawThemeId, ctx);
    const bg = theme?.cssVars?.['--t-color-background'];
    return typeof bg === 'string' && HEX_COLOR_RE.test(bg.trim())
      ? bg.trim()
      : null;
  } catch {
    return null;
  }
}

export async function listThemeIds(repoRoot, ctx = null) {
  const records = ctx?.organizationId
    ? await listThemes(ctx)
    : await listSeedThemes();
  return records.map((theme) => theme.id);
}

/**
 * List globally visible seed record IDs, excluding organization records.
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function listCoreThemeIds(repoRoot) {
  return (await listSeedThemes()).map((theme) => theme.id);
}

/**
 * Theme vars that must be declared on the **slide root**, not on the stage.
 *
 * A custom property's `var()` references are substituted where that property is
 * *computed*, not where it is read. `--t-slide-gradient-bg` — generated by
 * `normalizeTheme()` for any theme with `gradient.enabled` and no literal of its
 * own — references `var(--g1x)` … `var(--g3y)`, and those only exist on the slide
 * root: the slide CSS gives each gradient slide type a set of defaults and
 * `gradientVarsForSlide()` jitters them per slide id in the style attribute.
 * Declared on the stage, the substitution is guaranteed-invalid, inherits down as
 * invalid, and `background: var(--t-slide-gradient-bg, transparent)` falls back to
 * nothing — the layer never painted in any server-rendered document.
 *
 * The browser app never had the bug: `applyThemeVarsToElement()` applies theme
 * vars to the slide element itself (`client/lib/slide-runtime/slide-render.js`),
 * so there the two halves already meet. Scoping the declaration here is what
 * brings the export/embed/print documents in line with it.
 */
const SLIDE_ROOT_VARS = new Set(['--t-slide-gradient-bg']);

export function themeVarsCssText(theme, { selector = '.ps-theme' } = {}) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const stageLines = [];
  const slideLines = [];
  for (const [k, v] of Object.entries(vars)) {
    // Only emit theme vars that are meant for slide rendering.
    // Never emit UI vars (e.g. --t-ui-*) because the app UI must be theme-independent.
    if (typeof k !== 'string' || !k.startsWith('--t-')) continue;
    if (k.startsWith('--t-ui-')) continue;
    if (v == null) continue;
    (SLIDE_ROOT_VARS.has(k) ? slideLines : stageLines).push(
      `  ${k}: ${String(v)};`,
    );
  }
  const sel = String(selector || '.ps-theme').trim() || '.ps-theme';
  const blocks = [`${sel} {\n${stageLines.join('\n')}\n}`];
  // Scoped under the stage selector, so two themed stages on one page keep
  // their own gradient — the same reason the vars block is scoped at all.
  if (slideLines.length)
    blocks.push(`${sel} .slide {\n${slideLines.join('\n')}\n}`);
  // Theme-defined slide background variants need their generated
  // `.slide.slide-bg-<id>` rules in exports too (the client injects the same
  // rules at runtime — see injectThemeSlideBgStyles in client/lib/theme.js).
  const bgRules = slideBackgroundsCssText(theme?.slideBackgrounds);
  if (bgRules) blocks.push(bgRules);
  return blocks.join('\n');
}
