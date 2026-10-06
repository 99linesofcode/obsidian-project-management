// WHY this resolver exists: the tree uses NodeNext ESM specifiers (`./x.js`)
// that point at TypeScript sources (`x.ts`). eslint-plugin-boundaries resolves
// each import through eslint-module-utils, whose bundled node resolver does
// not rewrite the extension, so every local import would look unresolvable and
// the boundary matrix would never fire. This applies exactly that one mapping
// and nothing else; a bare specifier (a package) is left to the other
// resolvers / treated as external.
const fs = require('node:fs');
const path = require('node:path');

exports.interfaceVersion = 2;

exports.resolve = function resolveTs(source, file) {
  if (!source.startsWith('.')) {
    return { found: false };
  }
  const base = path.resolve(path.dirname(file), source);
  const candidates = source.endsWith('.js')
    ? [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx', base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, base];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { found: true, path: candidate };
    }
  }
  return { found: false };
};
