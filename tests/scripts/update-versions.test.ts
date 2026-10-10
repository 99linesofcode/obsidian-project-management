import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const nodeRequire = createRequire(import.meta.url);
const { preCommit } = nodeRequire(
  join(process.cwd(), 'scripts', 'update-versions.cjs'),
) as { preCommit: (props: { tag: string; version: string }) => void };

const originalWorkspace = process.env.GITHUB_WORKSPACE;
const fixtureRoots: string[] = [];

function writeFixture(
  manifest: Record<string, string>,
  versions: Record<string, string>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'update-versions-'));

  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'versions.json'), JSON.stringify(versions));
  fixtureRoots.push(root);

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }

  if (originalWorkspace === undefined) {
    delete process.env.GITHUB_WORKSPACE;
  } else {
    process.env.GITHUB_WORKSPACE = originalWorkspace;
  }
});

describe('update-versions pre-commit hook', () => {
  it('records the bumped version against the manifest minimum app version', () => {
    const root = writeFixture(
      { version: '0.23.0', minAppVersion: '1.13.0' },
      { '0.22.0': '1.13.0' },
    );
    process.env.GITHUB_WORKSPACE = root;

    preCommit({ tag: '0.23.0', version: '0.23.0' });

    const versions = JSON.parse(
      readFileSync(join(root, 'versions.json'), 'utf8'),
    );

    expect(versions).toEqual({ '0.22.0': '1.13.0', '0.23.0': '1.13.0' });
  });
});
