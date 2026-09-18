# Project Management

An Obsidian plugin that syncs vault project management with GitHub Projects —
the vault is the system of record.

Built on [node-skeleton](https://github.com/99linesofcode/node-skeleton) for
the shared configuration (`.editorconfig`, `.prettierrc`, `.gitignore`,
`.ignore`) and the Node/TypeScript toolchain (TypeScript, vitest, eslint with
prettier), with bun as the package manager and esbuild for the plugin bundle.

## How to use

1. `git init`
2. `git remote add origin <REPOSITORY>`
3. `git remote add skeleton git@github.com:99linesofcode/node-skeleton.git`
4. `git fetch skeleton`
5. `git rebase skeleton/main`

Updates flow the same way: `git fetch skeleton && git rebase skeleton/main`.
Conflicts on rebase are the divergence points — resolve them by keeping your
repo's override where it differs from the shared default.

## Commands

```bash
bun install      # install dependencies
bun run build    # bundle the plugin to main.js (minified)
bun run dev      # watch and rebuild on change (with sourcemaps)
bun test         # run the test suite once
bun test:watch   # run the test suite in watch mode
bun run lint     # eslint (flat config + prettier)
bun run typecheck # type-check without emitting
bun run audit    # check dependencies for known vulnerabilities
```

## Development

- `bun run build` produces `main.js` at the repo root.
- To load the plugin in a scratch dev vault, copy `main.js` and
  `manifest.json` into `<vault>/.obsidian/plugins/project-management/`, then
  enable the plugin in Obsidian's community plugins settings.
- Never develop in your main vault — always use a scratch dev vault.

## Contributing

Please review the [Contribution Guidelines](https://github.com/99linesofcode/.github/blob/main/.github/CONTRIBUTING.md).

## Code of conduct

In order to ensure that the community is welcoming to all, please review and abide by the [Code of Conduct](https://github.com/99linesofcode/.github?tab=coc-ov-file).

## Security vulnerabilities

Please review the [security policy](https://github.com/99linesofcode/.github?tab=security-ov-file) on how to report security vulnerabilities.

## License

This software is open source and licensed under the [MIT license](https://github.com/99linesofcode/.github?tab=MIT-1-ov-file).
