import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const gateScript = join(process.cwd(), 'scripts/lint-naming.mjs');
const fixtureRoots: string[] = [];

const fixtureRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'lint-naming-'));

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  fixtureRoots.push(root);

  return root;
};

const gateExitCode = (root?: string): number => {
  const args = root === undefined ? [gateScript] : [gateScript, root];

  try {
    execFileSync('node', args, { stdio: 'pipe' });

    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
};

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the role-folder suffix gate', () => {
  it('passes on the repository', () => {
    expect(gateExitCode()).toBe(0);
  });

  it('fails a non-Port file in the port folder', () => {
    const root = fixtureRoot({
      'src/core/port/MirrorAdapter.ts': 'export interface MirrorAdapter {}\n',
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('passes a *Port file in the port folder', () => {
    const root = fixtureRoot({
      'src/core/port/MirrorPort.ts': 'export interface MirrorPort {}\n',
    });

    expect(gateExitCode(root)).toBe(0);
  });

  it('fails a PascalCase non-Action file in the actions folder', () => {
    const root = fixtureRoot({
      'src/core/application/actions/SyncProject.ts':
        'export class SyncProject {}\n',
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('passes a lowercase pure module in the actions folder', () => {
    const root = fixtureRoot({
      'src/core/application/actions/seedArtifacts.ts': 'export const x = 1;\n',
    });

    expect(gateExitCode(root)).toBe(0);
  });

  it('does not gate a consumer folder inside the actions folder', () => {
    const root = fixtureRoot({
      'src/core/application/actions/create-task-note/TaskNoteMapper.ts':
        'export const TaskNoteMapper = {};\n',
    });

    expect(gateExitCode(root)).toBe(0);
  });
});
