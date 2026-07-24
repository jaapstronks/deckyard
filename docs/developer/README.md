## Developer docs (contributors)

This section is for developers working on the codebase.

### Start here

- **Dev setup**: `docs/developer/dev-setup.md`
- **Architecture overview**: `docs/developer/architecture.md`
- **Contributing guide**: `docs/developer/contributing.md`
- **Linting**: `docs/developer/linting.md` - the CI gate, the suppressions burndown, and the dead-code discovery pass

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


