// WHY this gate exists: conventions without a gate erode one dispatch at a
// time. Provider neutrality is a convention, and the only way it survives is
// if a machine refuses the change that breaks it. Provider names are allowed
// only in the provider's own module (src/github/, src/todoist/) and the
// composition root (src/app/); lowercase port-id VALUES such as 'github' and
// 'todoist' are data, not names, and are allowed everywhere.
//
// The second rule guards the shared kernel's DIRECTION: src/shared/ is the
// neutral ground every module may import, so it must import from no module. A
// provider-neutral NAME is not enough if the file reaches back into a provider;
// that is how the neutral port first grew a `../github/` import unnoticed.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// The tree to scan: src/ by default, overridable so the gate's own rule can be
// pinned by a test that plants a violation in a temporary tree.
const srcDir = resolve(process.argv[2] ?? join(root, 'src'));

// The zones where provider names are legitimate: the providers themselves and
// the composition root that wires them together.
const allowedZones = new Set(['github', 'todoist', 'app']);

// The capitalized provider vocabulary. Lowercase 'github'/'todoist' string
// literals are port-id values and deliberately do NOT match.
const providerName = /GitHub|Github|Todoist/g;

// The modules the shared kernel must never import from. A shared file reaches a
// sibling module only as `../<zone>/...` (shared is one level under src).
const forbiddenKernelZones = ['github', 'todoist', 'vault'];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && path.endsWith('.ts')) {
      yield path;
    }
  }
}

// The module specifiers of a file's static imports and re-exports. Dynamic
// imports are deliberately not matched: the codebase uses none.
function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

// Whether a relative specifier resolves into one of the forbidden zones.
function forbiddenKernelImport(specifier) {
  for (const zone of forbiddenKernelZones) {
    const prefix = `../${zone}`;
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
      return zone;
    }
  }
  return null;
}

const violations = [];
for await (const file of walk(srcDir)) {
  const display = file.startsWith(root) ? relative(root, file) : file;
  // The first path segment under the scanned tree is the zone.
  const zone = relative(srcDir, file).split('/')[0];
  const source = await readFile(file, 'utf8');

  if (!allowedZones.has(zone)) {
    source.split('\n').forEach((line, index) => {
      if (line.match(providerName) !== null) {
        violations.push(`${display}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (zone === 'shared') {
    for (const specifier of importSpecifiers(source)) {
      const reached = forbiddenKernelImport(specifier);
      if (reached !== null) {
        violations.push(
          `${display}: shared kernel must not import from ${reached}/ (found '${specifier}')`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Provider-neutrality boundary violations:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    `\n${violations.length} violation(s). Provider names belong only in src/github/, src/todoist/ and src/app/; src/shared/ imports from no module.`,
  );
  process.exit(1);
}

console.log(
  'Boundary check passed: no provider names outside their own modules, no shared-kernel provider imports.',
);
