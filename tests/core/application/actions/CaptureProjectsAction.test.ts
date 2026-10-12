import { describe, expect, it } from 'vitest';
import { CaptureProjectsAction } from '../../../../src/core/application/actions/CaptureProjectsAction.js';
import { AdoptedProject } from '../../../../src/core/port/data/AdoptedProject.js';
import { CapturedProject } from '../../../../src/core/port/data/CapturedProject.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type {
  CaptureSource,
  MirrorAdapterFactoryPort,
} from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

class FakeVault extends FakeVaultBase {
  readonly adopted: AdoptedProject[] = [];
  readonly adoptCalls: Array<{
    name: string;
    application: string;
    slug: string;
  }> = [];

  override async listAdoptedProjects(): Promise<readonly AdoptedProject[]> {
    return this.adopted;
  }

  override async adoptProject(
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
} {
  const vault = new FakeVault();
  const source: CaptureSource = {
    application: 'acme',
    capture: { captureProjects: async () => projects },
  };
  const factory: MirrorAdapterFactoryPort = {
    create: (): MirrorPort | null => null,
    captureSources: () => [source],
  };
  return {
    action: new CaptureProjectsAction(factory, vault),
    vault,
  };
}

describe('CaptureProjectsAction — adopting application-born projects', () => {
  it('adopts a remote project exactly once', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);

    const first = await h.action.invoke();
    const second = await h.action.invoke();

    expect(first.captured).toEqual(['Acme Widgets']);
    expect(second.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([
      { name: 'Acme Widgets', application: 'acme', slug: 'acme' },
    ]);
  });

  it('adopts the whole back-catalogue on the first run', async () => {
    const h = harness([
      project('Acme Widgets', 'P1', '2026-09-01T00:00:00Z'),
      project('Acme Gadgets', 'P2', '2026-10-05T10:00:00Z'),
    ]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Acme Widgets', 'Acme Gadgets']);
    expect(h.vault.adoptCalls).toHaveLength(2);
  });

  it('skips a project the vault already declares by name', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Acme Widgets',
        application: 'acme',
        target: 'P1',
      }),
    );

    const result = await h.action.invoke();

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('skips a project whose target is already adopted', async () => {
    const h = harness([project('Acme Widgets', 'P1', '2026-10-05T10:00:00Z')]);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Other',
        application: 'acme',
        target: 'P1',
      }),
    );

    const result = await h.action.invoke();

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('collects an error and keeps adopting when a project links several targets', async () => {
    const multi = new CapturedProject({
      name: 'Acme Widgets',
      targets: ['one', 'two'],
      createdAt: '2026-10-05T10:00:00Z',
    });
    const h = harness([
      multi,
      project('Acme Gadgets', 'P2', '2026-10-06T10:00:00Z'),
    ]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Acme Gadgets']);
    expect(result.errors).toHaveLength(1);
  });
});
