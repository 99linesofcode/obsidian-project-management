import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const gateScript = join(process.cwd(), 'scripts/lint-boundaries.mjs');
const fixtureRoots: string[] = [];

const fixtureRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'lint-boundaries-'));

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

describe('the provider-vocabulary gate', () => {
  it('passes on the repository', () => {
    expect(gateExitCode()).toBe(0);
  });

  it('fails a lowercase provider name in the core', () => {
    const root = fixtureRoot({
      'src/domain/leak.ts': "export const applicationId = 'github';\n",
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('fails a capitalized provider name in the core', () => {
    const root = fixtureRoot({
      'src/domain/leak.ts': "export const provider = 'Todoist';\n",
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('fails a provider name in neutral infrastructure', () => {
    const root = fixtureRoot({
      'src/infrastructure/fake/leak.ts': "export const provider = 'github';\n",
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('passes a provider name in its own infrastructure module', () => {
    const root = fixtureRoot({
      'src/infrastructure/github/descriptor.ts':
        "export const applicationId = 'github';\nexport const name = 'GitHub';\n",
    });

    expect(gateExitCode(root)).toBe(0);
  });

  it('passes a provider name in the composition root', () => {
    const root = fixtureRoot({
      'src/main.ts': "export const applicationId = 'todoist';\n",
    });

    expect(gateExitCode(root)).toBe(0);
  });

  it('fails a capitalized provider name in the driving side', () => {
    const root = fixtureRoot({
      'src/app/settings.ts': "export const provider = 'GitHub';\n",
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('fails an upper-case provider identifier outside a provider module', () => {
    const root = fixtureRoot({
      'src/app/settings.ts': "export const GITHUB_TOKEN_KEY = 'x';\n",
    });

    expect(gateExitCode(root)).not.toBe(0);
  });

  it('does not flag a lowercase provider value in a non-neutral module', () => {
    const root = fixtureRoot({
      'src/app/legacy.ts': "export const tool = 'todoist';\n",
    });

    expect(gateExitCode(root)).toBe(0);
  });
});
