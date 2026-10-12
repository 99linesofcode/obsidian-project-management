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

function source(
  application: string,
  projects: CapturedProject[],
): CaptureSource {
  return {
    application,
    capture: { captureProjects: async () => projects },
  };
}

function harness(
  sources: CaptureSource[],
  isCodeHost: (application: string) => boolean = (application) =>
    application === 'github',
): {
  action: CaptureProjectsAction;
  vault: FakeVault;
} {
  const vault = new FakeVault();
  const factory: MirrorAdapterFactoryPort = {
    create: (): MirrorPort | null => null,
    captureSources: () => sources,
  };
  return {
    action: new CaptureProjectsAction(factory, vault, isCodeHost),
    vault,
  };
}

describe('CaptureProjectsAction — the project capture gate (CAP-1, I16)', () => {
  it('adopts a code-host project exactly once (CAP-1)', async () => {
    const h = harness([
      source('github', [project('Acme Widgets', 'R1', '2026-10-05T10:00:00Z')]),
    ]);

    const first = await h.action.invoke();
    const second = await h.action.invoke();

    expect(first.captured).toEqual(['Acme Widgets']);
    expect(second.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([
      { name: 'Acme Widgets', application: 'github', slug: 'github' },
    ]);
  });

  it('adopts the whole back-catalogue on the first run (CAP-1)', async () => {
    const h = harness([
      source('github', [
        project('Acme Widgets', 'R1', '2026-09-01T00:00:00Z'),
        project('Acme Gadgets', 'R2', '2026-10-05T10:00:00Z'),
      ]),
    ]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Acme Widgets', 'Acme Gadgets']);
    expect(h.vault.adoptCalls).toHaveLength(2);
  });

  it('skips a project the vault already declares by name+connection (CAP-1)', async () => {
    const h = harness([
      source('github', [project('Acme Widgets', 'R1', '2026-10-05T10:00:00Z')]),
    ]);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Acme Widgets',
        application: 'github',
        target: 'R1',
      }),
    );

    const result = await h.action.invoke();

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('skips a project whose target is already adopted (CAP-1)', async () => {
    const h = harness([
      source('github', [project('Acme Widgets', 'R1', '2026-10-05T10:00:00Z')]),
    ]);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Other',
        application: 'github',
        target: 'R1',
      }),
    );

    const result = await h.action.invoke();

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('collects an error and keeps adopting when a project links several targets (CAP-1)', async () => {
    const multi = new CapturedProject({
      name: 'Acme Widgets',
      targets: ['one', 'two'],
      createdAt: '2026-10-05T10:00:00Z',
    });
    const h = harness([
      source('github', [
        multi,
        project('Acme Gadgets', 'R2', '2026-10-06T10:00:00Z'),
      ]),
    ]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Acme Gadgets']);
    expect(result.errors).toHaveLength(1);
  });

  it('does not adopt a task-manager-only project (CAP-1, I16)', async () => {
    const h = harness([source('todoist', [project('Solo Tasks', 'T1', null)])]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual([]);
    expect(h.vault.adoptCalls).toEqual([]);
  });

  it('does not adopt a task-manager project with no code-host project of the same name (CAP-1, I16)', async () => {
    const h = harness([
      source('github', [project('Other Repo', 'R1', '2026-09-01T00:00:00Z')]),
      source('todoist', [project('Solo Tasks', 'T1', '2026-10-05T10:00:00Z')]),
    ]);

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Other Repo']);
    expect(h.vault.adoptCalls.map((call) => call.name)).toEqual(['Other Repo']);
  });

  it('adopts a task-manager project whose name matches a code-host project (CAP-1, I16)', async () => {
    const h = harness([
      source('todoist', [
        project('Acme Widgets', 'T1', '2026-10-05T10:00:00Z'),
      ]),
    ]);
    h.vault.adopted.push(
      new AdoptedProject({
        projectName: 'Acme Widgets',
        application: 'github',
        target: 'https://github.com/acme/widgets',
      }),
    );

    const result = await h.action.invoke();

    expect(result.captured).toEqual(['Acme Widgets']);
    expect(h.vault.adoptCalls).toEqual([
      { name: 'Acme Widgets', application: 'todoist', slug: 'todoist' },
    ]);
  });
});
