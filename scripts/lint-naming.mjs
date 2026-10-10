#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

// The role-folder ↔ suffix rule: a class in a role folder carries that
// folder's role suffix, so a class is findable by role. Only the folders
// whose role vocabulary is settled are gated; the pure-function/content files
// are lowercase and exempt, and a consumer folder's exclusive collaborators
// (a mapper beside its action) are not role-folder residents.
const RULES = [
  { dir: 'src/core/port', suffixes: ['Port'], pascalOnly: false },
  { dir: 'src/core/domain/errors', suffixes: ['Error'], pascalOnly: false },
  {
    dir: 'src/core/application/actions',
    suffixes: ['Action'],
    pascalOnly: true,
  },
];

const toPosix = (path) => path.split(sep).join('/');

const directTsFiles = (root, dir) => {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => ({
      name: entry.name,
      path: toPosix(join(dir, entry.name)),
    }));
};

const isPascalCase = (name) => /^[A-Z]/.test(name);

const carriesSuffix = (name, suffixes) =>
  suffixes.some((suffix) => name.endsWith(`${suffix}.ts`));

const violationsIn = (root, rule) =>
  directTsFiles(root, rule.dir)
    .filter((file) => !rule.pascalOnly || isPascalCase(file.name))
    .filter((file) => !carriesSuffix(file.name, rule.suffixes))
    .map(
      (file) =>
        `${file.path}: expected a ${rule.suffixes.map((s) => `*${s}`).join(' or ')} file`,
    );

const root = process.argv[2] ?? process.cwd();
const violations = RULES.flatMap((rule) => violationsIn(root, rule));

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}
