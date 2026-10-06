import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Pin the boundary gate's shared-kernel rule: a src/shared file that imports
// from a provider module must fail the gate. The gate is scanned against a
// temporary tree so the test plants a violation without touching the real
// source. WHY an integration spawn and not a unit import: the gate is the
// `node scripts/lint-boundaries.mjs` command the delivery bar runs, so the pin
// exercises the command itself.
const script = fileURLToPath(
  new URL('../../scripts/lint-boundaries.mjs', import.meta.url),
);

const tempDirs: string[] = [];

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'opm-boundaries-'));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function runGate(dir: string) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('boundary gate — the shared kernel imports from no module', () => {
  it('fails a shared file that imports from a provider module', () => {
    const dir = makeTree({
      'shared/Neutral.ts':
        "import type { BoardItemData } from '../github/BoardItemData.js';\nexport type X = BoardItemData;\n",
    });

    const result = runGate(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shared kernel must not import from github/');
  });

  it('fails a shared file that imports from the vault', () => {
    const dir = makeTree({
      'shared/Neutral.ts':
        "import { parse } from '../vault/parser.js';\nexport const p = parse;\n",
    });

    const result = runGate(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shared kernel must not import from vault/');
  });

  it('passes a shared file that imports only from shared', () => {
    const dir = makeTree({
      'shared/Neutral.ts':
        "import type { TaskData } from './TaskData.js';\nexport type X = TaskData;\n",
    });

    const result = runGate(dir);

    expect(result.status).toBe(0);
  });
});
