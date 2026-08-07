## Developer docs (contributors)

This section is for developers working on the codebase.

### Start here

- **Dev setup**: `docs/developer/dev-setup.md`
- **Architecture overview**: `docs/developer/architecture.md`
- **Contributing guide**: `docs/developer/contributing.md`
- **Linting**: `docs/developer/linting.md` - the CI gate, the suppressions burndown, and the dead-code discovery pass
- **Export smoke test**: `docs/developer/export-smoke-test.md` - the one test that starts real Chrome, and how CI gets a browser
- **The `migrations` CI job**: `docs/developer/migration-smoke-test.md` - every migration up/down/up against a real PostgreSQL, the test double held against the resulting schema, and how CI gets a database
- **The `test-postgres` CI job**: `docs/developer/pg-test-suite.md` - the storage layer's `onConflict` paths against a real PostgreSQL, and why it lives outside `npm test`
- **`npm test` IPC flake (B50)**: `docs/developer/test-runner-ipc-flake.md` - the intermittent "Unable to deserialize cloned data" failure, its Node-core root cause, and the rule for keeping new tests quiet

- **Internationalization**: `docs/developer/i18n.md` - locales, `t()`, and the translation files
- **Live data sources**: `docs/developer/live-data-sources-testing.md` - testing checklist

The complete documentation index lives in `docs/README.md`.

### API Development

- **Public API**: `docs/developer/api.md` - Architecture, authentication, adding endpoints

### Customization

- **Custom themes**: `docs/developer/themes.md` - Add your organization's branding
- **Custom slide types**: `docs/developer/slide-types.md` - Create custom slide layouts + AI integration
- **Fork setup**: `docs/reference/fork-setup.md` - Complete guide to setting up your own fork

### Extension Points

Custom files go in gitignored directories that persist through updates:

| Directory | Purpose |
|-----------|---------|
| `custom/slide-types/` | Custom slide type definitions with AI wizard support |
| `custom/themes/` | Custom theme configurations |
| `custom/assets/` | Custom fonts, images, logos |

See `docs/developer/slide-types.md` for detailed instructions on creating custom slides that integrate with the AI wizard.


