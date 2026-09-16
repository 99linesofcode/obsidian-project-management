# node-skeleton

The starting point for my Node.js/TypeScript packages. It builds on
[git-skeleton](https://github.com/99linesofcode/git-skeleton) for the shared
configuration (`.editorconfig`, `.prettierrc`, `.gitignore`, `.ignore`) and
adds the Node/TypeScript toolchain: TypeScript (ESM, NodeNext), vitest, and
eslint with prettier.

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
pnpm install      # install dependencies
pnpm build        # compile TypeScript to build/
pnpm dev          # watch and recompile on change
pnpm test         # run the test suite once
pnpm test:watch   # run the test suite in watch mode
pnpm lint         # eslint (flat config + prettier)
pnpm typecheck    # type-check without emitting
pnpm audit        # check dependencies for known vulnerabilities
```

## Contributing

Please review the [Contribution Guidelines](https://github.com/99linesofcode/.github/blob/main/.github/CONTRIBUTING.md).

## Code of conduct

In order to ensure that the community is welcoming to all, please review and abide by the [Code of Conduct](https://github.com/99linesofcode/.github?tab=coc-ov-file).

## Security vulnerabilities

Please review the [security policy](https://github.com/99linesofcode/.github?tab=security-ov-file) on how to report security vulnerabilities.

## License

This software is open source and licensed under the [MIT license](https://github.com/99linesofcode/.github?tab=MIT-1-ov-file).
