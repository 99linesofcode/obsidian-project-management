import { describe, expect, it, vi } from 'vitest';

const { TFile } = vi.hoisted(() => {
  class TFile {
    stat: { mtime: number };
    constructor(
      public path: string,
      public extension: string,
      stat?: { mtime: number },
    ) {
      this.stat = stat ?? { mtime: 0 };
    }
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import { CaptureTasksAction } from '../../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import { CreateTaskNoteAction } from '../../../../../src/core/application/actions/create-task-note/CreateTaskNoteAction.js';
import { CanonicalTask } from '../../../../../src/core/port/data/CanonicalTask.js';
import type { MirrorPort } from '../../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { VaultAdapter } from '../../../../../src/infrastructure/vault/VaultAdapter.js';
import { connectionsOf } from '../../../../../src/infrastructure/vault/connectionsOf.js';
import { entityRecord } from '../../../../helpers/records.js';
import { FakeSyncState } from '../../../../helpers/fakeSyncState.js';
import { vaultAdapter } from '../../../../helpers/vaultAdapter.js';

const PROJECT = 'Acme Widgets';
const SYNCED_AT = '2026-10-08T12:00:00Z';

class FakeAppVault {
  private readonly notes = new Map<string, string>();
  readonly created: Array<{ path: string; content: string }> = [];

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: {
        connections: connectionsOf(this.notes.get(file.path) ?? ''),
      },
    }),
  };

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    return this.notes.has(path) ? new TFile(path, 'md') : null;
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.keys()].map((path) => new TFile(path, 'md'));
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!;
  }

  async create(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async modify(file: TFileInstance, content: string): Promise<void> {
    this.notes.set(file.path, content);
  }
}

function task(handle: string, title: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title,
    body: '',
    status: 'Building',
    completed: false,
    parent: null,
    labels: [],
  });
}

function registered(
  capture: {
    capture: (target: string) => Promise<CanonicalTask[]>;
  },
  taskHandlesAreUrls: boolean | undefined = undefined,
): MirrorPort {
  return {
    ...capture,
    ...(taskHandlesAreUrls === undefined
      ? {}
      : { taskHandlesAreUrls: () => taskHandlesAreUrls }),
  } as unknown as MirrorPort;
}

function homeNote(connections: string): string {
  return [
    '---',
    'type: project',
    'connections:',
    '  vault:',
    '    tool: vault',
    `    id: ${PROJECT}`,
    connections,
    '---',
  ].join('\n');
}

function harness(
  connectionBlock: string,
  tasks: CanonicalTask[],
): {
  action: CaptureTasksAction;
  vault: FakeAppVault;
  syncState: FakeSyncState;
} {
  const vault = new FakeAppVault();
  vault.seed(`Projecten/${PROJECT}/_${PROJECT}.md`, homeNote(connectionBlock));
  const syncState = new FakeSyncState();
  const app = {
    vault,
    metadataCache: vault.metadataCache,
  } as unknown as App;
  const port: VaultAdapter = vaultAdapter(app, {
    registeredApplications: new Set(['github', 'todoist']),
  });
  const createTaskNote = new CreateTaskNoteAction(port, syncState, '');
  const factory: MirrorAdapterFactoryPort = {
    create: (application) =>
      registered({ capture: async () => tasks }, application === 'github'),
  };
  return {
    action: new CaptureTasksAction(port, factory, syncState, createTaskNote),
    vault,
    syncState,
  };
}

const GITHUB_BLOCK = [
  '  github:',
  '    tool: github',
  '    project: "https://github.com/acme/widgets"',
].join('\n');

const TODOIST_BLOCK = [
  '  todoist:',
  '    tool: todoist',
  '    project: "T1"',
].join('\n');

describe('CaptureTasksAction — the vault wiring (CAP-2)', () => {
  it('writes a code-host task as a task note carrying its url', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';
    const h = harness(GITHUB_BLOCK, [task(url, 'Fix the Bug')]);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toHaveLength(1);
    expect(h.vault.created[0]!.path).toBe(
      'Projecten/Acme Widgets/taken/fix-the-bug.md',
    );
    const record = h.syncState.setCalls[0]!;
    expect(h.syncState.handleOf(record.id, 'github')).toBe(url);
  });

  it('writes a task-manager task as a draft note and stamps its mirror', async () => {
    const h = harness(TODOIST_BLOCK, [task('T1', 'Buy Milk')]);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toHaveLength(1);
    const { path, content } = h.vault.created[0]!;
    expect(path).toBe('Projecten/Acme Widgets/taken/buy-milk.md');
    expect(content).toContain('status: Building');
    expect(content).not.toContain('url:');
    const record = h.syncState.setCalls[0]!;
    expect(h.syncState.handleOf(record.id, 'todoist')).toBe('T1');
  });

  it('refuses a task whose handle is empty', async () => {
    const h = harness(TODOIST_BLOCK, [task('', 'Nameless')]);

    const result = await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(result.captured).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toContain('empty handle');
    expect(h.vault.created).toEqual([]);
  });

  it('skips a task the vault already declares', async () => {
    const h = harness(TODOIST_BLOCK, [task('T1', 'Buy Milk')]);
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/buy-milk.md',
      }),
      { todoist: { handle: 'T1' } },
    );

    const result = await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(result.captured).toEqual([]);
    expect(h.vault.created).toEqual([]);
  });
});
