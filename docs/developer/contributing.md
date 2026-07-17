# Contributing

## Goals (What We Optimize For)

- **Maintainability**: Small modules with clear separation of concerns
- **No bundler**: Keep browser code readable and debuggable
- **Single source of truth**: Slide type schema, defaults, and rendering live in `shared/`
- **Safety**: Escape user content; keep shared renderers pure
- **Cleanup**: Any client runtime side-effects must return a cleanup function
- **Minimal dependencies**: Prefer native APIs over packages

---

## Where Changes Should Go

| Change Type | Location |
|-------------|----------|
| New slide types | `shared/slide-types/types/<type>.js` + registry entry |
| Custom slide types | `custom/slide-types/<type>.js` (gitignored) |
| Client behavior | `client/lib/*` or `client/views/**` |
| Server endpoints | `server/routes/api/**` |
| Data persistence | `server/storage/**` |
| Exports/rendering | `server/export/**` using shared slide rendering |
| Themes | `themes/*.json` or `custom/themes/*.json` |
| Translations | `client/i18n/<locale>/*.json` |

---

## Code Style

### General Principles

- **Small modules**: Each file should do one thing well
- **Explicit over implicit**: Avoid magic, prefer readable code
- **Flat over nested**: Avoid deep nesting and abstraction layers
- **Comments for why, not what**: Code should be self-documenting

### JavaScript

```javascript
// Use named exports for utilities
export function parseSlideId(str) { /* ... */ }

// Use default export for modules with a main purpose
export default {
  label: 'Content Slide',
  fields: [...],
  renderHtml: (content) => { /* ... */ }
};

// Prefer early returns
function getUser(id) {
  if (!id) return null;
  const user = findUser(id);
  if (!user) return null;
  return user;
}

// Use const by default, let when needed, never var
const items = [];
let count = 0;
```

### HTML Safety

User-provided text MUST be escaped:

```javascript
import { esc } from '../shared/slide-types/helpers.js';
import { markdownToSafeHtml } from '../shared/markdown.js';

// For plain text
`<h1>${esc(content?.title)}</h1>`

// For markdown content
`<div class="body">${markdownToSafeHtml(content?.body)}</div>`
```

**Never** use raw HTML insertion for user content:

```javascript
// WRONG - XSS vulnerability
el.innerHTML = content.body;

// RIGHT - sanitized
el.innerHTML = markdownToSafeHtml(content.body);
```

### CSS

- Use CSS variables for theming: `var(--t-color-accent)`
- Use BEM-like naming: `.slide-content`, `.slide-content-inner`
- Put slide styles in `client/styles/slides/`
- Keep styles co-located with their components when possible

---

## Slide Type Guidelines

### Pure Renderers

The `renderHtml()` function must be pure:

```javascript
// GOOD - pure function
renderHtml: (content, slide, ctx) => `
  <div class="slide slide-content">
    <h1>${esc(content?.title)}</h1>
  </div>
`

// BAD - has side effects
renderHtml: (content, slide, ctx) => {
  document.title = content.title;  // Side effect!
  return `<div>...</div>`;
}
```

### RTL Support

All text elements should include `dir="auto"`:

```javascript
`<h1 dir="auto">${esc(content?.title)}</h1>`
`<p dir="auto">${esc(content?.body)}</p>`
```

### Slide Structure

Slides must have a `.slide` root with `.slide-inner` child:

```javascript
renderHtml: (content) => `
  <div class="slide slide-my-type ${bgClass(content?.background)}">
    <div class="slide-inner">
      <!-- Slide content here -->
    </div>
  </div>
`
```

---

## Client Runtime Guidelines

### Side Effects Must Be Cleaned Up

If your code creates timers, event listeners, or connections:

```javascript
// client/lib/my-feature.js
export function attachFeature(element) {
  const timer = setInterval(() => { /* ... */ }, 1000);
  const handler = (e) => { /* ... */ };

  element.addEventListener('click', handler);

  // Return cleanup function
  return () => {
    clearInterval(timer);
    element.removeEventListener('click', handler);
  };
}
```

### Mount from slide-render.js

Wire up runtime behavior in `client/lib/slide-render.js`:

```javascript
import { attachFeature } from './my-feature.js';

// In the render function
const cleanup = attachFeature(slideElement);
cleanupFunctions.push(cleanup);
```

---

## Server Guidelines

### Handler Pattern

Each route handler returns `true` if it handled the request:

```javascript
export async function handleMyFeature(ctx) {
  const { req, res, url } = ctx;

  // Check if this handler should handle the request
  if (url.pathname !== '/api/my-feature') {
    return false;  // Not handled, try next handler
  }

  // Handle the request
  const data = await getMyData();
  serveJson(res, data);
  return true;  // Handled
}
```

### Use HTTP Utilities

```javascript
import { serveJson, badRequest, unauthorized, notFound } from '../../utils/http.js';

// Success responses
serveJson(res, { data: 'value' });

// Error responses
badRequest(res, 'Invalid input');
unauthorized(res);
notFound(res);
```

### Validation

Validate external input at boundaries:

```javascript
import { z } from 'zod';

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  theme: z.string().optional(),
});

// In handler
try {
  const input = CreateSchema.parse(await parseJsonBody(req));
  // Process valid input
} catch (e) {
  badRequest(res, 'Invalid input');
}
```

---

## Adding Features

### New Slide Type

1. Create `shared/slide-types/types/my-slide.js`
2. Add to `shared/slide-types/registry.js`
3. Add CSS in `client/styles/slides/my-slide.css`
4. Import CSS in the appropriate bundle
5. Add translations for labels in `client/i18n/en/slide-types.json`
6. Run `npm run i18n:sync` to add placeholders to the other locales

### New API Endpoint

1. Create handler in `server/routes/api/my-feature.js`
2. Wire into handler chain in `server/routes/api/index.js`
3. Add storage functions in `server/storage/` if needed
4. Document the endpoint

### New Translation Keys

1. Add keys to appropriate module in `client/i18n/en/*.json`
2. Run `npm run i18n:sync` to add placeholders to other locales
3. Run `npm run i18n:validate` to check for issues

(The runtime loads the modular `<locale>/<component>.json` files directly;
there is no merged build step.)

---

## Avoiding Common Mistakes

### Don't

- Add dependencies without strong justification
- Use frameworks or heavy libraries
- Create custom UI components (plain DOM via `h()`; no component library)
- Skip HTML escaping for user content
- Leave cleanup functions unimplemented
- Hardcode text (use translations)
- Mix concerns across layers

### Do

- Keep modules small and focused
- Use native browser APIs
- Follow existing patterns
- Test manually before committing
- Update translations for new text
- Return cleanup functions for side effects
- Escape all user-provided content

---

## Commit Messages

Use clear, imperative commit messages:

```
feat: add new quote slide type
fix: prevent XSS in markdown rendering
refactor: simplify storage adapter interface
docs: update architecture documentation
chore: update dependencies
```

Prefix with:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code restructuring
- `docs:` - Documentation only
- `chore:` - Maintenance tasks
- `style:` - CSS/formatting changes

---

## Pull Request Checklist

Before submitting:

- [ ] Code follows existing patterns
- [ ] User content is properly escaped
- [ ] Side effects have cleanup functions
- [ ] Translations added for new text
- [ ] No new dependencies (or justified)
- [ ] Tested manually in browser
- [ ] No console errors or warnings
- [ ] Commit messages are clear
