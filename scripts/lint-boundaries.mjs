// WHY this gate exists: conventions without a gate erode one dispatch at a
// time. Provider neutrality is a convention, and the only way it survives is
// if a machine refuses the change that breaks it. Provider names are allowed
// only in the provider's own module (src/github/, src/todoist/) and the
// composition root (src/app/); lowercase port-id VALUES such as 'github' and
// 'todoist' are data, not names, and are allowed everywhere.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');

// The zones where provider names are legitimate: the providers themselves and
// the composition root that wires them together.
const allowedZones = new Set(['github', 'todoist', 'app']);

// The capitalized provider vocabulary. Lowercase 'github'/'todoist' string
// literals are port-id values and deliberately do NOT match.
const providerName = /GitHub|Github|Todoist/g;

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

const violations = [];
for await (const file of walk(srcDir)) {
  const rel = relative(root, file);
  // rel is src/<zone>/...; a file directly under src/ has no zone.
  const zone = rel.split('/')[1];
  if (allowedZones.has(zone)) {
    continue;
  }
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    const matches = line.match(providerName);
    if (matches !== null) {
      violations.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('Provider-neutrality boundary violations:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    `\n${violations.length} violation(s). Provider names belong only in src/github/, src/todoist/ and src/app/.`,
  );
  process.exit(1);
}

console.log(
  'Boundary check passed: no provider names outside their own modules.',
);
