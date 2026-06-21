# Contributing to Crew

Thanks for your interest in building Crew! Contributions of all kinds are welcome — code, bug reports,
docs, tests, and ideas.

## Getting started

1. Fork and clone the repo.
2. Install: `pnpm install` (Node ≥ 22, pnpm 9, PostgreSQL 16).
3. Set up the database and run the app — see the **Quickstart** in [README.md](./README.md).
4. Create a branch: `git checkout -b feat/<short-name>`.

## Development workflow

- **Typecheck & test before pushing:** `pnpm typecheck && pnpm test`.
- **Add tests with changes.** Unit-test pure logic; integration-test endpoints. We aim to keep the
  suite green and meaningful.
- **Keep modules small and focused** (high cohesion, low coupling). Prefer many small files over a few
  large ones.
- **Validate at boundaries** with Zod; never trust external input.
- **Immutable updates** — return new objects rather than mutating.
- **No secrets in code.** Use environment variables; never commit `.env`, tokens, or credentials.

## Commit & PR

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Keep PRs focused; describe the change and how you tested it.
- Link related issues.

## Reporting bugs / proposing features

Open an issue with clear steps to reproduce (for bugs) or the problem you're solving and a sketch of the
approach (for features). Small, well-scoped proposals are easiest to land.

## Code of Conduct

By participating you agree to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md).

By contributing, you agree that your contributions are licensed under the project's
[Apache License 2.0](./LICENSE).
