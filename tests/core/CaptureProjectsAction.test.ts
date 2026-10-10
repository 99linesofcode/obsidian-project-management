import { describe, expect, it } from 'vitest';
import { CaptureProjectsAction } from '../../src/core/CaptureProjectsAction.js';
import { AdoptedProject } from '../../src/core/data/AdoptedProject.js';
import { CapturedProject } from '../../src/core/data/CapturedProject.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type {
  CaptureSource,
  MirrorAdapterFactoryPort,
} from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { ProjectCaptureCursorPort } from '../../src/core/ports/ProjectCaptureCursorPort.js';
import type { ProjectCaptureVaultPort } from '../../src/core/ports/ProjectCaptureVaultPort.js';

class FakeVault implements ProjectCaptureVaultPort {
  readonly adopted: AdoptedProject[] = [];
  readonly adoptCalls: Array<{
    name: string;
    application: string;
    slug: string;
  }> = [];

  async listAdopted(): Promise<readonly AdoptedProject[]> {
    return this.adopted;
  }

  async adopt(
    project: CapturedProject,
    application: string,
    slug: string,
  ): Promise<void> {
    this.adoptCalls.push({ name: project.name, application, slug });
    this.adopted.push(
      new AdoptedProject({
        projectName: project.name,
        application,
        target: project.targets[0] ?? '',
      }),
    );
  }
}

class FakeCursor implements ProjectCaptureCursorPort {
  readonly cursors = new Map<string, string>();
  readonly writes: Array<{ application: string; iso: string }> = [];

  async read(application: string): Promise<string | null> {
    return this.cursors.get(application) ?? null;
  }

  async write(application: string, iso: string): Promise<void> {
    this.cursors.set(application, iso);
    this.writes.push({ application, iso });
  }
}

function project(
  name: string,
  target: string,
  createdAt: string | null,
): CapturedProject {
  return new CapturedProject({ name, targets: [target], createdAt });
}

function harness(projects: CapturedProject[]): {
  action: CaptureProjectsAction;
  vault: FakeVault;
  cursor: FakeCursor;
} {
  const vault = new FakeVault();
  const cursor = new FakeCursor();
  const source: CaptureSource = {
    application: 'acme',
    capture: { captureProjects: async () => projects },
  };
  const factory: MirrorAdapterFactoryPort = {
    create: (): RegisteredAdapter | null => null,
    captureSources: () => [source],
  };
  return {
    action: new CaptureProjectsAction(factory, vault, cursor),
    vault,
    cursor,
  };
}

const CURSOR = '2026-09-30T00:00:00Z';

describe('CaptureProjectsAction — adopting application-born projects', () => {
  it('adopts a project born after the cursor exactly once', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);
    h.cursor.cursors.set('acme', CURSOR);

    const first = await h.action.invoke('2026-10-06T12:00:00Z');
    const second = await h.action.invoke('2026-10-06T12:05:00Z');

    expect(first.captured).toEqual(['Acme Widgets']);
    expect(second.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([
      { name: 'Acme Widgets', application: 'acme', slug: 'acme' },
    ]);
  });

  it('skips a project the vault already declares', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);
    h.cursor.cursors.set('acme', CURSOR);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Acme Widgets',
        application: 'acme',
        target: 'P1',
      }),
    );

    const result = await h.action.invoke('2026-10-06T12:00:00Z');

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('adopts the newest clock on first sight and captures nothing', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);

    const result = await h.action.invoke('2026-10-06T12:00:00Z');

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
    expect(await h.cursor.read('acme')).toBe('2026-10-05T10:00:00Z');
  });

  it('leaves a project at or before the cursor alone', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-09-01T00:00:00Z')]);
    h.cursor.cursors.set('acme', CURSOR);

    const result = await h.action.invoke('2026-10-06T12:00:00Z');

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('collects an error and stops the watermark when a project links several targets', async () => {
    const multi = new CapturedProject({
      name: 'Acme Widgets',
      targets: ['one', 'two'],
      createdAt: '2026-10-05T10:00:00Z',
    });
    const h = harness([multi]);
    h.cursor.cursors.set('acme', CURSOR);

    const result = await h.action.invoke('2026-10-06T12:00:00Z');

    expect(result.captured).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(await h.cursor.read('acme')).toBe(CURSOR);
  });
});
