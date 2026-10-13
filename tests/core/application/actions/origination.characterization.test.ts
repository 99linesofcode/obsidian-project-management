import { describe, expect, it } from 'vitest';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import { CanonicalProject } from '../../../../src/core/port/data/CanonicalProject.js';
import type { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const TARGET = 'P1';

// A mirror whose resolve-or-create builds the project by name under a handle
// distinct from the declared target — the task manager's shape — while a read
// of the declared target stays absent. It records both origination surfaces so
// a pass that runs both is visible.
class OriginationProbe implements MirrorPort {
  readonly resolveOrCreateTargets: string[] = [];
  readonly createProjectTargets: string[] = [];
  private readonly projects = new Map<string, CanonicalProject>();

  async resolveOrCreateProject(
    target: string,
    name: string,
  ): Promise<ProjectAddressing> {
    this.resolveOrCreateTargets.push(target);
    const handle = `by-name:${name}`;
    this.projects.set(
      handle,
      new CanonicalProject({ handle, name, archived: false }),
    );
    return new ProjectAddressing({
      projectHandle: handle,
      statusFieldHandle: '',
      statusOptions: [],
      effectiveTarget: handle,
    });
  }

  async readProject(target: string): Promise<CanonicalProject | null> {
    return this.projects.get(target) ?? null;
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    this.createProjectTargets.push(target);
    const project = new CanonicalProject({
      handle: target,
      name,
      archived: false,
    });
    this.projects.set(target, project);
    return project;
  }

  async renameProject(): Promise<void> {}

  async setArchived(): Promise<void> {}

  async readTasks(): Promise<CanonicalTask[]> {
    return [];
  }

  async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  async createTask(
    _target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    return task;
  }

  async applyField(): Promise<void> {}

  async deleteTask(): Promise<void> {}
}

class ProbeVault extends FakeVaultBase {
  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return [
      new ConnectionDataTransferObject({
        slug: 'todoist',
        application: 'todoist',
        target: TARGET,
      }),
    ];
  }

  override async observeProject(): Promise<OriginObservation> {
    return new OriginObservation({
      current: 'false',
      currentCompleted: false,
      fieldTime: null,
      trustworthy: false,
    });
  }

  override async applyProjectArchived(): Promise<void> {}
}

async function runBothSites(): Promise<OriginationProbe> {
  const registry = new FakeSyncState();
  const probe = new OriginationProbe();

  await new EnsureProjectBoardAction(registry, []).execute({
    projectName: PROJECT,
    connectionSlug: 'todoist',
    target: TARGET,
    setup: probe,
  });
  await new ProjectLifecycleSyncAction(new ProbeVault(), registry, {
    create: () => probe,
  }).invoke(PROJECT);

  return probe;
}

describe('origination — one owner, the chain site', () => {
  it('originates a missing mirror project at the chain site (ORG-3)', async () => {
    const probe = await runBothSites();

    expect(probe.resolveOrCreateTargets).toEqual([TARGET]);
  });

  it('reads the already-originated project at the lifecycle site instead of creating a second one (ORG-3, SHELL-2)', async () => {
    const probe = await runBothSites();

    expect(probe.createProjectTargets).toEqual([]);
  });
});
