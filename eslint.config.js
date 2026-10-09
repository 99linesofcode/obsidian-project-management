import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';

// WHY boundaries are enforced by ESLint rather than a bespoke script: the
// module tree is an architectural contract, and the linter is already the
// place a broken import is caught. The hand-rolled gate expressed one rule
// (the core imports nothing); the plugin expresses the whole matrix,
// including provider isolation, which the old gate could only approximate.

// The module tree. Each element is one folder under src/. Element patterns
// match folders only (v7 dropped file-mode matching), so the composition
// root at src/main.ts is classified by the file descriptor in the settings
// block below, not by an element pattern.
//
// Order matters: the plugin matches the first pattern that fits, so the two
// provider patterns must precede the broad `infrastructure/**` pattern — or
// the providers collapse into one element and stop being isolated from each
// other (see tests/scripts/boundary-isolation.test.ts).
const ELEMENT_PATTERNS = [
  { type: 'core', pattern: 'src/core/**' },
  { type: 'github', pattern: 'src/infrastructure/github/**' },
  { type: 'todoist', pattern: 'src/infrastructure/todoist/**' },
  { type: 'infrastructure', pattern: 'src/infrastructure/**' },
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
//   merge import nothing, so no outer block can leak in (the dependency rule);
//   the ports and their DTOs live there precisely so no provider's shape leaks
//   into neutral ground.
// - infrastructure is the middle block of driven adapters; it may import core
//   only, never the driving side or a sibling block.
// - github/todoist never import each other. A mirror's module may not depend
//   on a sibling mirror; the sync halves meet only through core and sync.
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
    'vault',
    'registry',
    'tasks',
    'todos',
    'projects',
    'sync',
  ],
  core: [],
  github: ['core'],
  todoist: ['core'],
  infrastructure: ['core'],
  projects: ['core', 'vault'],
  tasks: ['core', 'projects', 'vault'],
  todos: ['core', 'vault'],
  sync: ['core', 'projects', 'tasks', 'todos'],
  registry: ['core', 'projects'],
  vault: ['core'],
};

const matrixPolicies = Object.entries(MATRIX).map(([type, allowed]) => ({
  from: { element: { type } },
  // An empty allow list (the core block) leaves the global disallow in force:
  // core may import nothing.
  ...(allowed.length === 0
    ? { disallow: { to: { element: { types: { anyOf: ALL_ELEMENT_TYPES } } } } }
    : { allow: { to: { element: { types: { anyOf: allowed } } } } }),
  message:
    allowed.length === 0
      ? `the ${type} block imports no module; move the neutral shape into ${type}`
      : `the ${type} module may not import that element`,
}));

// The composition root is a lone file at the src root. Element patterns match
// folders only, so src/main.ts cannot be an element; the file descriptor in
// the settings block below keeps it known to no-unknown-files, and this policy
// gives it the edges to wire every internal module — including the provider
// adapters under infrastructure/, which only it imports.
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
              'github',
              'todoist',
              'infrastructure',
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
          policies: [...matrixPolicies, ...compositionRootPolicies],
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
