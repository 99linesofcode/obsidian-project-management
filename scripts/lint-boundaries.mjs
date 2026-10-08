#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PROVIDER_MODULE_ROOTS = [
  'src/github',
  'src/todoist',
  'src/infrastructure/github',
  'src/infrastructure/todoist',
];

const NEUTRAL_MODULE_ROOTS = ['src/core', 'src/infrastructure'];

const COMPOSITION_ROOT = 'src/main.ts';
const DRIVING_SIDE_ROOT = 'src/app';

const providerNameAnyCase = /github|todoist/i;
const providerNameCapitalized = /GitHub|Github|Todoist/;

const toPosixPath = (path) => path.split(sep).join('/');

const isUnder = (path, root) => path === root || path.startsWith(`${root}/`);

const isAllowedLocation = (path) =>
  PROVIDER_MODULE_ROOTS.some((root) => isUnder(path, root)) ||
  path === COMPOSITION_ROOT ||
  isUnder(path, DRIVING_SIDE_ROOT);

const isNeutralModule = (path) =>
  NEUTRAL_MODULE_ROOTS.some((root) => isUnder(path, root));

const collectTypeScriptFiles = (root) => {
  const files = [];

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  };

  walk(join(root, 'src'));

  return files;
};

const violationsIn = (path, content) => {
  if (isAllowedLocation(path)) {
    return [];
  }

  const pattern = isNeutralModule(path)
    ? providerNameAnyCase
    : providerNameCapitalized;

  return content
    .split('\n')
    .flatMap((line, index) =>
      pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
    );
};

const findViolations = (root) =>
  collectTypeScriptFiles(root).flatMap((fullPath) => {
    const path = toPosixPath(relative(root, fullPath));

    return violationsIn(path, readFileSync(fullPath, 'utf8'));
  });

const root = process.argv[2] ?? process.cwd();
const violations = findViolations(root);

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}
