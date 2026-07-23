# Project governance

Deckyard is a personal, opinionated project maintained by a single person.
This document exists so contributors and forkers know what to count on before
they invest time.

## Who decides

- **[@jaapstronks](https://github.com/jaapstronks)** is the maintainer and has
  final say on scope, design, and what gets merged.
- Decisions happen in the open (issues, pull requests, Discussions), but the
  project is **not** run by consensus. Disagreement is welcome; the maintainer
  breaks ties.

## Scope

Deckyard has an intentional shape: a **dependency-light, framework-free,
build-step-free** presentation engine for humans and AI agents. Contributions
that fit that shape are welcome. Contributions that pull it toward a heavier
stack (a framework, a bundler, large runtime dependencies) are likely to be
declined even when they are well made. That is a judgment of fit, not of the
work.

When in doubt about whether an idea fits, open an issue or a Discussion before
building it.

## What to expect as a contributor

- **Small, focused PRs get looked at fastest.** For anything large, agree on
  direction in an issue or Discussion first, so you don't build something that
  won't land.
- **Response times are best-effort.** There is no company and no SLA behind
  this; quiet periods happen.
- **`main` is protected.** Changes land via a pull request with green CI (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md)). History is never rewritten.
- **Inbound = outbound.** By contributing, you agree your work is licensed
  under the project's [MIT license](LICENSE).

## What to expect as a forker

- **Forking is encouraged** - that is what the MIT license is for.
- **Track release tags, not `main`.** `main` is kept releasable, but the stable
  surface to build on is the tagged releases (`vX.Y.Z`). See
  [`docs/reference/fork-setup.md`](docs/reference/fork-setup.md).
- **No compatibility promise beyond the changelog.** Breaking changes are
  called out in [`CHANGELOG.md`](CHANGELOG.md); there is no guarantee of
  backwards compatibility between releases beyond what it notes.

## Security

Report vulnerabilities **privately** via the repository's Security tab, not as
a public issue. Full policy in [`SECURITY.md`](SECURITY.md).
