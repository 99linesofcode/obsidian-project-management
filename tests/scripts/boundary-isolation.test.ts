import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const eslintBin = join(process.cwd(), 'node_modules/eslint/bin/eslint.js');

// Lints a snippet as if it lived at `filename`, using the real flat config.
// The element matrix is enforced by the ordering and policies in
// eslint.config.js, which are easy to break silently — this test is their
// regression guard.
const lint = (
  filename: string,
  code: string,
): { status: number; output: string } => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [eslintBin, '--stdin', '--stdin-filename', filename],
      { input: code, stdio: 'pipe' },
    );

    return { status: 0, output: stdout.toString() };
  } catch (error) {
    const failure = error as { status?: number; stdout?: Buffer };

    return {
      status: failure.status ?? 1,
      output: failure.stdout?.toString() ?? '',
    };
  }
};

const lintExitCode = (filename: string, code: string): number =>
  lint(filename, code).status;

describe('the provider isolation matrix', () => {
  it('rejects a provider importing a sibling provider', () => {
    expect(
      lintExitCode(
        'src/infrastructure/github/probe.ts',
        "import '../todoist/createTodoistTransport.js';\n",
      ),
    ).not.toBe(0);
  });

  it('allows the composition root to import a provider', () => {
    expect(
      lintExitCode(
        'src/main.ts',
        "import './infrastructure/github/CodeHostMirrorAdapter.js';\n",
      ),
    ).toBe(0);
  });
});

describe('the intra-core dependency seam', () => {
  it('rejects a domain file importing an application file', () => {
    const result = lint(
      'src/core/domain/probe.ts',
      "import type { ProjectManagementSettings } from '../application/data/ProjectManagementSettings.js';\n",
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('rejects a domain file importing a port file', () => {
    const result = lint(
      'src/core/domain/probe.ts',
      "import type { VaultPort } from '../port/VaultPort.js';\n",
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('rejects a port file importing an application file', () => {
    const result = lint(
      'src/core/port/probe.ts',
      "import type { ProjectManagementSettings } from '../application/data/ProjectManagementSettings.js';\n",
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('allows an application file importing a domain file', () => {
    expect(
      lintExitCode(
        'src/core/application/probe.ts',
        "import type { Baseline } from '../domain/Baseline.js';\nexport type Probe = Baseline;\n",
      ),
    ).toBe(0);
  });

  it('allows an application file importing a port file', () => {
    expect(
      lintExitCode(
        'src/core/application/probe.ts',
        "import type { VaultPort } from '../port/VaultPort.js';\nexport type Probe = VaultPort;\n",
      ),
    ).toBe(0);
  });
});
