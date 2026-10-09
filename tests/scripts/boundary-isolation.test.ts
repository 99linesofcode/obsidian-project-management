import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const eslintBin = join(process.cwd(), 'node_modules/eslint/bin/eslint.js');

// Lints a snippet as if it lived at `filename`, using the real flat config.
// The provider isolation is enforced by element ordering in eslint.config.js,
// which is easy to break silently — this test is its regression guard.
const lintExitCode = (filename: string, code: string): number => {
  try {
    execFileSync(
      process.execPath,
      [eslintBin, '--stdin', '--stdin-filename', filename],
      { input: code, stdio: 'pipe' },
    );
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
};

describe('the provider isolation matrix', () => {
  it('rejects a provider importing a sibling provider', () => {
    expect(
      lintExitCode(
        'src/infrastructure/github/probe.ts',
        "import '../todoist/TodoistTransport.js';\n",
      ),
    ).not.toBe(0);
  });

  it('allows the composition root to import a provider', () => {
    expect(
      lintExitCode(
        'src/main.ts',
        "import './infrastructure/github/githubDescriptor.js';\n",
      ),
    ).toBe(0);
  });
});
