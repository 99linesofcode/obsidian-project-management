# Project Management

An Obsidian plugin that syncs vault project management with GitHub Projects —
the vault is the system of record. Project notes anchor GitHub repos and
project boards; every issue carrying a `type:` label (task, bug, chore, slice,
…) becomes a task note in the vault; edits, status changes, and deletions
propagate in both directions.

**Status:** v1 in active development. The sync engine, GitHub adapter, and
scheduler are in place; project discovery and the full sync loop are being
built ticket by ticket (see the issue tracker).

## How to use (development)

1. Build: `pnpm install && pnpm run build` (produces `main.js`).
2. Copy `main.js` + `manifest.json` into a scratch vault's
   `.obsidian/plugins/project-management/`.
3. Enable the plugin under Community plugins; set a GitHub fine-grained PAT
   (Issues: read/write, Projects: read/write) in the plugin settings.
4. Never develop in your main vault — always use a scratch dev vault.

## Commands

```bash
pnpm install         # install dependencies
pnpm run build       # bundle the plugin to main.js (minified)
pnpm run dev         # watch and rebuild on change (with sourcemaps)
pnpm test            # run the test suite once
pnpm run test:watch  # run the test suite in watch mode
pnpm run lint        # eslint (flat config + prettier)
pnpm run typecheck   # type-check without emitting
pnpm run audit       # check dependencies for known vulnerabilities
```

## Architecture

Hexagonal, per the owner's software architecture contract: `src/App/`
(driving side: scheduler, commands, settings), `src/Domain/` (pure core:
actions, models, ports — never imports `obsidian`), `src/Infrastructure/`
(driven adapters: Obsidian vault, GitHub REST + GraphQL).

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
