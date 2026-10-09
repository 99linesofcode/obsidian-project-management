# AGENTS — standing rules for this repository

The standing contract for anyone — human or agent — working in this repository.
It is self-contained: everything you need is here or in the repo.

## What this is

An Obsidian community plugin that keeps the vault's project management mirrored
onto external applications (GitHub, Todoist, …). The vault is the system of
record; the applications are mirrors the plugin keeps honest.

## Architecture

- `src/core/` — the multi-adapter core: capability ports, canonical DTOs, the
  pure N-way merge, the adapter descriptor/registrar, and the sync actions. It
  names no provider.
- `src/infrastructure/<vendor>/` — the driven adapters (GitHub, Todoist, the
  vault origin, the registry), one namespace per application.
- `src/app/` — the driving side: commands, modals, settings, scheduler.
- `src/main.ts` — the composition root.
- The boundary gate (`node scripts/lint-boundaries.mjs`) enforces provider
  neutrality and the block dependency rule mechanically.

See `ARCHITECTURE.md` for the full map and `docs/architecture/` for the ADRs.

## Gates — all must exit 0

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run lint:boundaries`
- `pnpm test`
- `pnpm run build`

## Obsidian release hygiene

- **`manifest.json` is the version of record.** It carries `version` and
  `minAppVersion`.
- **`minAppVersion` must be the version that introduced the newest Obsidian API
  the code uses.** Adopt a newer API → bump `minAppVersion` in the same change,
  or the community-plugin scan fails with `obsidianmd/no-unsupported-api`. Check
  the installed `obsidian` typings (`node_modules/obsidian/obsidian.d.ts`) for
  the `@since` tag on any API you use.
- **`versions.json`** maps each released plugin version to its `minAppVersion`
  (`{ "1.2.0": "1.13.0" }`). Obsidian reads it to know each release's floor. The
  release workflow maintains it (`scripts/update-versions.cjs`); do not edit it
  by hand.
- **The release is tag-driven.** The git tag must equal the `manifest.json`
  version exactly (`1.0.0`, never `v1.0.0`) — Obsidian installs assets from the
  release tagged with the exact manifest version.
- **Avoid deprecated Obsidian APIs.** Migrate when the scan recommends it (e.g.
  `PluginSettingTab.display`, deprecated in 1.13.0 in favour of
  `getSettingDefinitions`).

## Commits

- Conventional Commits, one concern per commit.
- Branch off `main`; never force-push or rewrite shared history.

## Tests

- Test behaviour, not implementation; Given/When/Then.
- Every change ships the tests for the behaviour it adds or changes.
