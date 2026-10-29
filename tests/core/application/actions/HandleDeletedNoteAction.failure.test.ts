import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// DEL-2 (restored from review): a failed mirror delete is reported and retried,
// never silently dropped. One connection's failure must not abandon the other
// connections' deletes in the same pass, and the failure must reach the sync's
// error channel rather than being swallowed.
class FakeTaskSurface {
  deleted: string[] = [];
  writes: CanonicalFieldWrite[] = [];
  failDelete = new Set<string>();

  async readTasks(): Promise<never> {
    throw new Error('not used in this test');
  }
  async readTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.writes.push(write);
  }
  async deleteTask(handle: string): Promise<void> {
    if (this.failDelete.has(handle)) {
      throw new Error(`mirror delete failed: ${handle}`);
    }
    this.deleted.push(handle);
  }
}

class FakeMirrorAdapters implements MirrorAdapterFactoryPort {
  readonly tasks = new FakeTaskSurface();
  readonly targets: string[] = [];

  create(_application: string, target: string): MirrorPort {
    this.targets.push(target);
    if (target === '') {
      throw new Error('code host: invalid repository url');
    }
    return this.tasks as unknown as MirrorPort;
  }
}

const url = 'https://github.com/acme/widgets/issues/42';
const todoistHandle = 'T1';
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const target = 'https://github.com/acme/widgets';
const connections = [
  { slug: 'github', application: 'github', target },
  { slug: 'todoist', application: 'todoist', target: 'P1' },
] as const;

function setup() {
  const mirrorAdapters = new FakeMirrorAdapters();
  const syncState = new FakeSyncState();
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url },
    todoist: { handle: todoistHandle },
  });
  const action = new HandleDeletedNoteAction(syncState, mirrorAdapters);
  return { action, mirrorAdapters, syncState };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DEL-2 — a failed mirror delete is reported and retried, never dropped', () => {
  it('still deletes the remaining mirrors when one delete fails, and reports it', async () => {
    const h = setup();
    h.mirrorAdapters.tasks.failDelete.add(url);
    const reports: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      reports.push(args);
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      reports.push(args);
    });

    await h.action
      .execute({
        notePath,
        projectId: projectName,
        connections: [...connections],
      })
      .catch(() => undefined);

    expect(h.mirrorAdapters.tasks.deleted).toContain(todoistHandle);
    expect(reports.flat().join(' ')).toContain(url);
  });

  it('retries the failed mirror delete on a later pass', async () => {
    const h = setup();
    h.mirrorAdapters.tasks.failDelete.add(url);

    await h.action
      .execute({
        notePath,
        projectId: projectName,
        connections: [...connections],
      })
      .catch(() => undefined);
    h.mirrorAdapters.tasks.failDelete.delete(url);
    await h.action.execute({
      notePath,
      projectId: projectName,
      connections: [...connections],
    });

    expect(h.mirrorAdapters.tasks.deleted).toContain(url);
  });
});

describe('DEL-1 — the delete path addresses the effective target (ORG-2)', () => {
  it('resolves an empty declared target to the recorded identity before deleting', async () => {
    const h = setup();
    await h.syncState.setIdentity(
      projectName,
      'github',
      new ProjectIdentityDataTransferObject({
        target,
        targetHandle: '',
        projectHandle: '',
        statusFieldHandle: '',
        statusOptions: [],
      }),
    );

    await h.action.execute({
      notePath,
      projectId: projectName,
      connections: [{ slug: 'github', application: 'github', target: '' }],
    });

    expect(h.mirrorAdapters.targets).toEqual([target]);
    expect(h.mirrorAdapters.tasks.deleted).toContain(url);
  });
});
