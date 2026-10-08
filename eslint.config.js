import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';

// WHY boundaries are enforced by ESLint rather than a bespoke script: the
// module tree is an architectural contract, and the linter is already the
// place a broken import is caught. The hand-rolled gate expressed one rule
// (the shared kernel's direction); the plugin expresses the whole matrix,
// including provider isolation, which the old gate could only approximate.

// The module tree. Each element is one folder under src/. Element patterns
// match folders only (v7 dropped file-mode matching), so the composition
// root at src/main.ts is classified by the file descriptor in the settings
// block below, not by an element pattern.
const ELEMENT_PATTERNS = [
  { type: 'core', pattern: 'src/core/**' },
  { type: 'infrastructure', pattern: 'src/infrastructure/**' },
  { type: 'shared', pattern: 'src/shared/**' },
  { type: 'github', pattern: 'src/github/**' },
  { type: 'todoist', pattern: 'src/todoist/**' },
  { type: 'vault', pattern: 'src/vault/**' },
  { type: 'registry', pattern: 'src/registry/**' },
  { type: 'tasks', pattern: 'src/tasks/**' },
  { type: 'todos', pattern: 'src/todos/**' },
  { type: 'projects', pattern: 'src/projects/**' },
  { type: 'sync', pattern: 'src/sync/**' },
  { type: 'app', pattern: 'src/app/**' },
];

const ALL_ELEMENT_TYPES = [
  ...new Set(ELEMENT_PATTERNS.map((element) => element.type)),
];

// The dependency matrix, derived from the real import graph. Each entry lists
// the element types its module may import; every other edge is a violation.
//
// WHY these edges and no others:
// - core is the inner block: the capability ports, canonical DTOs and the pure
//   merge import nothing, so no outer block can leak in (the dependency rule).
// - infrastructure is the middle block of driven adapters; it may import core
//   only, never the driving side or a sibling block.
// - shared imports nothing. It is the kernel: the ports and their DTOs live
//   here precisely so no provider's shape leaks into neutral ground.
// - github/todoist never import each other. A mirror's module may not depend
//   on a sibling mirror; the sync halves meet only through shared and sync.
// - app is the composition root and wires every module.
// - The domain and orchestration modules keep their real, legitimate edges:
//   vault/tasks/todos/projects write notes, sync orchestrates them, and the
//   registry reads project paths. Everything else is forbidden, which makes
//   the matrix acyclic by construction (no circular module dependencies).
/** @type {Record<string, string[]>} */
const MATRIX = {
  app: [
    'app',
    'core',
    'shared',
    'github',
    'todoist',
    'vault',
    'registry',
    'tasks',
    'todos',
    'projects',
    'sync',
  ],
  core: [],
  infrastructure: ['core'],
  shared: [],
  github: ['shared', 'tasks', 'todos', 'vault', 'projects', 'sync'],
  todoist: [
    'shared',
    'tasks',
    'todos',
    'vault',
    'projects',
    'registry',
    'sync',
  ],
  projects: ['shared', 'vault'],
  tasks: ['shared', 'projects', 'vault'],
  todos: ['shared', 'vault'],
  sync: ['shared', 'projects', 'tasks', 'todos'],
  registry: ['shared', 'projects'],
  vault: ['shared'],
};

const matrixPolicies = Object.entries(MATRIX).map(([type, allowed]) => ({
  from: { element: { type } },
  // An empty allow list (the shared kernel) leaves the global disallow in
  // force: shared may import nothing.
  ...(allowed.length === 0
    ? { disallow: { to: { element: { types: { anyOf: ALL_ELEMENT_TYPES } } } } }
    : { allow: { to: { element: { types: { anyOf: allowed } } } } }),
  message:
    allowed.length === 0
      ? `the ${type} block imports no module; move the neutral shape into ${type}`
      : `the ${type} module may not import that element`,
}));

// Transitional reuse: the new core's vault adapters reuse the legacy vault and
// task modules' note codecs while the old chain is retired. Each edge is scoped
// to one adapter file and the helpers it imports, so the infrastructure block
// still imports core only in general.
const transitionalPolicies = [
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultProjectSourceAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'vault',
          fileInternalPath: ['connectionsOf.ts'],
        },
      },
    },
  },
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultProjectCaptureAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'vault',
          fileInternalPath: ['renderConnectionsBlock.ts'],
        },
      },
    },
  },
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultProjectCaptureAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'shared',
          fileInternalPath: ['projectHomePath.ts'],
        },
      },
    },
  },
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultTaskCaptureAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'vault',
          fileInternalPath: ['CapturedTaskNoteMapper.ts', 'freePath.ts'],
        },
      },
    },
  },
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultTaskCaptureAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'tasks',
          fileInternalPath: ['CreateTaskNoteAction.ts'],
        },
      },
    },
  },
  {
    from: {
      element: {
        type: 'infrastructure',
        fileInternalPath: ['vault/VaultTaskCaptureAdapter.ts'],
      },
    },
    allow: {
      to: {
        element: {
          type: 'shared',
          fileInternalPath: ['typeFromLabels.ts'],
        },
      },
    },
  },
];

// The public surface of each provider module: the only files another element
// may import. The composition root wires the adapter and the half's actions;
// everything else inside the provider is private to it. Expressed with the
// modern dependencies rule (the entry-point rule is deprecated in v7).
//
// The surface policies are scoped to the elements the matrix already lets
// import that provider, and they come last: last-write-wins lets the specific
// allow override the general disallow for exactly the public files, while a
// module the matrix forbids (say, shared) is still caught by the matrix and is
// never granted access by the surface allow.
const PROVIDER_SURFACE = {
  github: [
    'GitHubAdapter.ts',
    // The promote modal lists unpromoted issues from the provider's transport
    // shape; the type is part of what the app is allowed to see.
    'GithubTaskData.ts',
  ],
  todoist: ['TodoistAdapter.ts'],
};

// The elements the matrix lets import a provider; the surface narrows those
// edges only, so it can never grant a provider to a module the matrix forbids.
/**
 * @param {string} provider
 */
const importersOf = (provider) =>
  Object.entries(MATRIX)
    .filter(([, allowed]) => allowed.includes(provider))
    .map(([type]) => type);

const surfacePolicies = Object.entries(PROVIDER_SURFACE).flatMap(
  ([type, files]) => {
    const importers = importersOf(type);
    return [
      {
        from: { element: { types: { anyOf: importers } } },
        disallow: { to: { element: { type } } },
        message: `the ${type} module is imported through its public surface only`,
      },
      {
        from: { element: { types: { anyOf: importers } } },
        allow: { to: { element: { type, fileInternalPath: files } } },
      },
    ];
  },
);

// The composition root is a lone file at the src root. Element patterns match
// folders only, so src/main.ts cannot be an element; the file descriptor in
// the settings block below keeps it known to no-unknown-files, and these
// policies give it the same edges the app element has: every internal module,
// with the providers reachable through their public surfaces only. Order
// matters — last-write-wins, so the surface allow must come after the
// provider disallow.
const COMPOSITION_ROOT_CATEGORY = 'composition-root';

const compositionRootPolicies = [
  {
    from: { file: { categories: [COMPOSITION_ROOT_CATEGORY] } },
    allow: {
      to: {
        element: {
          types: {
            anyOf: [
              'app',
              'core',
              'infrastructure',
              'shared',
              'vault',
              'registry',
              'tasks',
              'todos',
              'projects',
              'sync',
            ],
          },
        },
      },
    },
  },
  ...Object.entries(PROVIDER_SURFACE).flatMap(([type, files]) => [
    {
      from: { file: { categories: [COMPOSITION_ROOT_CATEGORY] } },
      disallow: { to: { element: { type } } },
      message: `the ${type} module is imported through its public surface only`,
    },
    {
      from: { file: { categories: [COMPOSITION_ROOT_CATEGORY] } },
      allow: { to: { element: { type, fileInternalPath: files } } },
    },
  ]),
  // The plugin class lives in main.ts (Obsidian's manifest entry), so app
  // files type their back-reference to it. Type-only by importKind: a value
  // import from the composition root stays a violation.
  {
    from: { element: { type: 'app' } },
    allow: { to: { file: { categories: [COMPOSITION_ROOT_CATEGORY] } } },
    importKind: 'type',
  },
];

export default tseslint.config(
  { ignores: ['build/**', 'dist/**', 'main.js'] },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // The _-prefix is the codebase's convention for intentionally unused
      // parameters (e.g. fake-transport callbacks that ignore their args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The resolver is CommonJS by necessity: eslint-module-utils `require()`s
    // it, so it cannot be an ESM module in this `type: module` package.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Boundaries describe the source tree. Tests, scripts and config files
    // wire modules freely, so they are not classified and not checked.
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENT_PATTERNS,
      // The composition root is a lone file: element patterns match folders
      // only, so this descriptor is what keeps src/main.ts known to
      // no-unknown-files and addressable by the composition-root policies.
      'boundaries/files': [
        { pattern: 'src/main.ts', category: COMPOSITION_ROOT_CATEGORY },
      ],
      'boundaries/legacy-warnings': false,
      // Resolve the tree's NodeNext `.js` specifiers onto their `.ts` sources,
      // or the plugin cannot classify any local import (see the resolver).
      'import/resolver': { './scripts/eslint-ts-resolver.cjs': {} },
    },
    rules: {
      // The matrix. `default: disallow` means any edge not listed is a
      // violation, so a new import fails until it is deliberately allowed.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            ...matrixPolicies,
            ...transitionalPolicies,
            ...surfacePolicies,
            ...compositionRootPolicies,
          ],
        },
      ],
      // Every source file must belong to an element, and every local import
      // must resolve to one, so a new top-level module cannot slip in
      // unclassified.
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
    },
  },
);
