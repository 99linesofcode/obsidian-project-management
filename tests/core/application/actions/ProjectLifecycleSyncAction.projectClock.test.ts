import { describe, expect, it } from 'vitest';
import { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import { CanonicalProject } from '../../../../src/core/port/data/CanonicalProject.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { ProjectAddressing } from '../../../../src/core/port/data/ProjectAddressing.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { TodoistMirrorAdapter } from '../../../../src/infrastructure/todoist/TodoistMirrorAdapter.js';
import type { TodoistTransport } from '../../../../src/infrastructure/todoist/TodoistTransport.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const MIRROR_TARGET = 'P1';
const ORIGIN_TIME = '2026-10-08T09:00:00Z';
const MIRROR_TIME = '2026-10-08T11:00:00Z';

// The port surface S22 reads the archive fact's decisive time through: the
// project's own clock (`projectTime`, the approved rename), not an
// archive-specific `archivedTime`.
interface ProjectClockPort {
  projectTime?(target: string): Promise<string | null>;
}

// A mirror that reports a project time through the renamed surface only — it
// exposes no archive-specific `archivedTime`. The current action cannot see it
// and falls to the vault tie-break; the amended action reads it and the mirror
// wins the rung.
class ProjectClockMirror implements MirrorPort {
  archived = true;
  name = PROJECT;
  time: string | null = MIRROR_TIME;

  async readProject(target: string): Promise<CanonicalProject> {
    return new CanonicalProject({
      handle: target,
      name: this.name,
      archived: this.archived,
    });
  }

  async renameProject(_target: string, name: string): Promise<void> {
    this.name = name;
  }

  async setArchived(_target: string, archived: boolean): Promise<void> {
    this.archived = archived;
  }

  async projectTime(_target: string): Promise<string | null> {
    return this.time;
  }

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

  async resolveOrCreateProject(
    target: string,
    _name: string,
  ): Promise<ProjectAddressing | null> {
    return new ProjectAddressing({
      projectHandle: target,
      statusFieldHandle: '',
      statusOptions: [],
      effectiveTarget: target,
    });
  }
}

class LifecycleVault extends FakeVaultBase {
  constructor(private readonly archived = false) {
    super();
  }

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return [
      new ConnectionDataTransferObject({
        slug: 'todoist',
        application: 'todoist',
        target: MIRROR_TARGET,
      }),
    ];
  }

  override async observeProject(): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.archived ? 'true' : 'false',
      currentCompleted: false,
      fieldTime: ORIGIN_TIME,
      trustworthy: true,
    });
  }

  override async applyProjectArchived(): Promise<void> {}
}

// A task manager that has just un-archived: the project read reports it active
// with the newer updated_at that un-archiving bumps.
class UnarchivedTodoist implements TodoistTransport {
  async get(): Promise<{ status: number; json: unknown }> {
    return {
      status: 200,
      json: {
        id: MIRROR_TARGET,
        name: PROJECT,
        is_archived: false,
        updated_at: MIRROR_TIME,
      },
    };
  }

  async post(): Promise<{ status: number; json: unknown }> {
    throw new Error('unarchived task manager: unexpected POST');
  }

  async delete(): Promise<{ status: number; json: unknown }> {
    throw new Error('unarchived task manager: unexpected DELETE');
  }
}

describe('NWM-6 amended — the port surface is the project clock, not an archive-specific time', () => {
  it('lets a mirror whose clock is the project last-modified win the archive rung', async () => {
    // Origin active against a baseline of archived (a restore delta); the
    // mirror archived against a baseline of active (an archive delta). Only the
    // mirror's project time can decide it.
    const registry = new FakeSyncState();
    await registry.writeBaseline(
      PROJECT,
      'archived',
      'origin',
      new Baseline('true', false),
    );
    await registry.writeBaseline(
      PROJECT,
      'archived',
      'mirror:todoist',
      new Baseline('false', false),
    );
    const mirror = new ProjectClockMirror();
    const action = new ProjectLifecycleSyncAction(new LifecycleVault(), registry, {
      create: () => mirror,
    });

    const record = await action.invoke(PROJECT);

    expect(record.result.rung).toBe(1);
    expect(record.result.winner).toBe('mirror:todoist');
    expect(record.frozen).toBe(true);
  });

  it('exposes the surface as projectTime, not archivedTime', () => {
    const port = new ConformanceMirrorAdapter() as unknown as ProjectClockPort &
      MirrorPort & { archivedTime?: unknown };

    expect(typeof port.projectTime).toBe('function');
    expect(port.archivedTime).toBeUndefined();
  });
});

describe('ADP-6 / NWM-6 — a task manager is decisive in both directions', () => {
  it('lets a task manager that un-archived win the restore rung on its updated_at', async () => {
    // Origin archived against a baseline of active (an archive delta); the task
    // manager un-archived against a baseline of archived (a restore delta). Its
    // updated_at moves on un-archive and is the newer time, so the restore wins.
    const registry = new FakeSyncState();
    await registry.writeBaseline(
      PROJECT,
      'archived',
      'origin',
      new Baseline('false', false),
    );
    await registry.writeBaseline(
      PROJECT,
      'archived',
      'mirror:todoist',
      new Baseline('true', false),
    );
    const mirror = new TodoistMirrorAdapter(
      new UnarchivedTodoist(),
      MIRROR_TARGET,
    );
    const action = new ProjectLifecycleSyncAction(
      new LifecycleVault(true),
      registry,
      { create: () => mirror },
    );

    const record = await action.invoke(PROJECT);

    expect(record.result.rung).toBe(1);
    expect(record.result.winner).toBe('mirror:todoist');
    expect(record.frozen).toBe(false);
  });
});
