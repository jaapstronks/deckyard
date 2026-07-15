# Fork Setup Guide

This guide explains how to set up your own fork of Deckyard with custom themes, slide types, and branding.

## For OSS Maintainers: Initial Repository Setup

After cloning the OSS repository for the first time, run these commands to ensure the custom directories are properly gitignored:

```bash
# Remove any tracked custom content (keeps files locally but stops tracking)
git rm -r --cached custom/themes custom/slide-types custom/assets 2>/dev/null || true

# Commit the clean state
git commit -m "Ensure custom directories are gitignored" --allow-empty

# Push to origin
git push origin main
```

This ensures the OSS repo only contains `.gitkeep` placeholder files in the custom directories.

---

## For Fork Users: Setting Up Your Fork

### Step 1: Fork the Repository

1. Go to https://github.com/jaapstronks/deckyard
2. Click "Fork" to create your own copy
3. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-ORG/YOUR-FORK.git
   cd YOUR-FORK
   ```

### Step 2: Enable Custom Content Tracking

Edit `.gitignore` and remove or comment out these lines:

Upstream ships `custom/` empty (only `.gitkeep` placeholders are tracked); the
contents are gitignored so a clean checkout carries no client content. To
version your own customizations, un-ignore them by removing these lines from
`.gitignore`:

```gitignore
custom/themes/*
!custom/themes/.gitkeep
custom/assets/*
!custom/assets/.gitkeep
custom/slide-types/*
!custom/slide-types/.gitkeep
```

### Step 3: Add Your Custom Content

1. **Add your theme** as a self-contained folder
   `custom/themes/your-org/theme.json` (recommended folder layout — see
   `docs/developer/themes.md` for the flat legacy layout and a migration
   recipe):
   ```
   custom/themes/your-org/
     theme.json
     assets/images/your-logo.svg
     assets/fonts/YourFont-Regular.woff2
   ```
   ```json
   {
     "id": "your-org",
     "label": "Your Organization",
     "assets": {
       "logo": "/custom/themes/your-org/assets/images/your-logo.svg",
       "logoAlt": "Your Organization"
     },
     "cssVars": {
       "--t-color-accent": "#your-brand-color"
     }
   }
   ```
   Deck-content assets shared across themes (uploaded images, partner logos)
   still live in `custom/assets/`.

2. **Add your assets** in `custom/assets/`:
   ```
   custom/assets/
   ├── images/
   │   └── your-logo.svg
   └── fonts/
       └── YourFont.woff2
   ```

3. **Optionally add custom slide types** in `custom/slide-types/`

### Step 4: Set Your Default Theme

Create or edit `.env`:
```bash
DEFAULT_THEME=your-org
```

### Step 5: Commit Your Customizations

```bash
git add custom/themes/ custom/slide-types/ custom/assets/ .gitignore
git commit -m "Add organization branding and themes"
git push origin main
```

### Step 6: Set Up Upstream Tracking

To receive updates from the main Deckyard project:

```bash
# Add upstream remote
git remote add upstream https://github.com/jaapstronks/deckyard.git

# Fetch upstream changes, including release tags
git fetch upstream --tags
```

Because your customizations live in `custom/` directories that the upstream doesn't modify, merges should be conflict-free.

---

## Updating Your Fork

**Track releases, not the tip of `main`.** Releases are tagged (`v1.0.0`,
`v1.1.0`, …) and each release's changes are summarized in `CHANGELOG.md` —
that summary tells you whether an update affects your fork before you merge
anything. The tip of `main` may additionally contain work that just hasn't
been released yet, and long-running feature tracks live on integration
branches (e.g. `collab`) that you should never merge directly.

```bash
# Fetch the latest from upstream, including tags
git fetch upstream --tags

# See what releases are available
git tag -l 'v*'

# Read the release notes first (CHANGELOG.md at that tag), then merge it
git merge v1.1.0

# If there are conflicts (rare), resolve them
# Then push to your fork
git push origin main
```

Merging `upstream/main` directly still works if you want the bleeding edge,
but you're then integrating unreleased work at whatever state it happens to
be in — releases are the supported sync points.

## Deployment

Your fork deploys exactly like the OSS version:

```bash
docker compose up -d --build
```

Make sure your `.env` file on the server has:
- `DEFAULT_THEME=your-org` (your theme ID)
- Any API keys (OpenAI, ImageKit, etc.)
