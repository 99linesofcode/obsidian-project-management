# Project Management

An Obsidian plugin that syncs a vault's project management with a GitHub
repository + Projects board and Todoist. The vault is the system of record:
project notes anchor the remote projects, every typed task note becomes an
issue and a task-manager twin, and edits, status changes and deletions
propagate in both directions. The plugin reconciles the mirrors through a
three-way diff, so the vault wins unless a remote provably changed more
recently.

**Status:** v1 in active development. The sync engine, the code-host and
task-manager adapters, the registry and the scheduler are in place; the
module-first restructure, the boundary enforcement and outward materialization
are done (see the issue tracker).

## How to use (development)

1. Build: `pnpm install && pnpm run build` (produces `main.js`).
2. Copy `main.js` + `manifest.json` into a scratch vault's
   `.obsidian/plugins/project-management/`.
3. Enable the plugin under Community plugins; set a GitHub fine-grained PAT
   (Issues: read/write, Projects: read/write) and a Todoist API token in the
   plugin settings.
4. Never develop in your main vault — always use a scratch dev vault.

## Commands

```bash
pnpm install             # install dependencies
pnpm run build           # bundle the plugin to main.js (minified)
pnpm run dev             # watch and rebuild on change (with sourcemaps)
pnpm test                # run the test suite once
pnpm run test:watch      # run the test suite in watch mode
pnpm run lint            # eslint (flat config + prettier)
pnpm run lint:boundaries # provider-vocabulary boundary grep
pnpm run typecheck       # type-check without emitting
pnpm run format:check    # prettier check
pnpm run audit           # check dependencies for known vulnerabilities
```

## Architecture

Module-first: `src/` is one lowercase folder per bounded concept — `app` (the
driving side), `github` and `todoist` (the providers), `vault` (the origin
adapter), `projects`, `registry`, `sync`, `tasks`, `todos`, and `shared` (the
kernel: the four ports, the canonical DTOs and the pure reconciliation). The
architecture axis is the file-name role suffix (`Action`, `Adapter`, `Port`,
`Mapper`, `Data`), not layer folders; `src/main.ts` is the composition root.

The gates are `pnpm test` (behavioral tests per module, including the sync
chain's invariance test) and `pnpm run lint` (the `eslint-plugin-boundaries`
module matrix), plus the `pnpm run lint:boundaries` vocabulary grep that keeps
provider names inside provider modules.

The full architecture is in [ARCHITECTURE.md](ARCHITECTURE.md); the flows are
in [docs/developer-manual.md](docs/developer-manual.md).

## Development

Built on [node-skeleton](https://github.com/99linesofcode/node-skeleton):
shared config flows via remote + rebase, pnpm runs inside the `devshell-node`
Nix devshell (`.envrc` → `use flake ./devshell`), esbuild bundles the plugin.
Updates flow via `git fetch skeleton && git rebase skeleton/main`.

## Contributing

Please review the [Contribution Guidelines](https://github.com/99linesofcode/.github/blob/main/CONTRIBUTING.md).

## Code of conduct

In order to ensure that the community is welcoming to all, please review and abide by the [Code of Conduct](https://github.com/99linesofcode/.github?tab=coc-ov-file).

## Security vulnerabilities

Please review the [security policy](https://github.com/99linesofcode/.github?tab=security-ov-file) on how to report security vulnerabilities.

## License

This software is open source and licensed under the [MIT license](https://github.com/99linesofcode/.github?tab=MIT-1-ov-file).
