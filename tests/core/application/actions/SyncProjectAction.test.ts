import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../../src/core/application/actions/SyncProjectAction.js';
import type { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import type { SyncChecklistAction } from '../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../../../../src/core/application/actions/CompleteTaskCascadeAction.js';
import type { CaptureTasksAction } from '../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import type { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import type { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import type { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import type { ProjectNoteDataTransferObject } from '../../../../src/core/port/data/ProjectNoteDataTransferObject.js';
import type { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { EntityRecord } from '../../../../src/core/port/data/EntityRecord.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { MigrateProjectHomeNoteAction } from '../../../../src/core/application/actions/MigrateProjectHomeNoteAction.js';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';

class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  projectNotes: ProjectNoteDataTransferObject[] = [];
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();
  renames: Array<{ from: string; to: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  override async createNote(): Promise<void> {}
  override async writeNote(): Promise<void> {}
  override async renameNote(from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
  }
  async moveFolder(): Promise<void> {}
  override async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
  override async trashNote(): Promise<void> {}
  override async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    return this.projectNotes;
  }
  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

function projectNote(
  projectName: string,
  archivedAt: string | null,
  connections: readonly ConnectionDataTransferObject[] = [
    {
      slug: 'github',
      application: 'github',
      target: 'https://github.com/acme/widgets',
    },
    { slug: 'todoist', application: 'todoist', target: 'P1' },
  ],
): ProjectNoteDataTransferObject {
  return {
    path: `${archivedAt !== null ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    archivedAt,
    connections,
    connectionErrors: [],
  };
}

function status(notePath: string): EntityRecord {
  return entityRecord({ id: 'entity-42', notePath });
}

interface HarnessOptions {
  projectNotes?: ProjectNoteDataTransferObject[];
  frozen?: boolean;
  statuses?: EntityRecord[];
  taken?: string[];
  ensureBoard?: boolean;
  connections?: readonly ConnectionDataTransferObject[];
  adapterApplications?: string[];
  failRenames?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const deletedConnections: string[] = [];
  const vault = new FakeVault();
  vault.projectNotes = options.projectNotes ?? [
    projectNote('Acme Widgets', null, options.connections),
  ];
  vault.folders.set('Projecten/Acme Widgets/taken', options.taken ?? []);
  const syncState = new FakeSyncState();
  for (const record of options.statuses ?? []) {
    syncState.records.set(record.id, record);
  }

  const renames = {
    execute: async () => {
      if (options.failRenames) {
        throw new Error('renames failed');
      }
      events.push('renames');
    },
  } as unknown as DetectNoteRenamesAction;
  const cascade = {
    execute: async (input: { notePath: string }) => {
      events.push(`cascade:${input.notePath}`);
    },
  } as unknown as CompleteTaskCascadeAction;
  const checklist = {
    execute: async (input: { notePath: string }) => {
      events.push(`checklist:${input.notePath}`);
    },
  } as unknown as SyncChecklistAction;
  const mirrorStatus = {
    execute: async (input: { todoPath: string }) => {
      events.push(`mirror:${input.todoPath}`);
    },
  } as unknown as MirrorTodoStatusAction;
  const handleDeleted = {
    execute: async (input: {
      notePath: string;
      connections: ReadonlyArray<{ slug: string }>;
    }) => {
      events.push(`delete:${input.notePath}`);
      deletedConnections.push(...input.connections.map((c) => c.slug));
    },
  } as unknown as HandleDeletedNoteAction;

  const ensureBoard = options.ensureBoard
    ? ({
        execute: async (input: {
          projectName: string;
          connectionSlug: string;
        }) => {
          events.push(
            `ensureBoard:${input.projectName}/${input.connectionSlug}`,
          );
        },
      } as unknown as EnsureProjectBoardAction)
    : undefined;

  const adapterApplications = options.adapterApplications ?? ['github'];
  const mirrorAdapters: MirrorAdapterFactoryPort = {
    create: (application) =>
      adapterApplications.includes(application) ? ({} as MirrorPort) : null,
  };

  const frozen =
    options.frozen ?? (vault.projectNotes[0]?.archivedAt ?? null) !== null;

  const lifecycle = {
    invoke: async () => {
      events.push('lifecycle');
      return { frozen, wasFrozen: false };
    },
  } as unknown as ProjectLifecycleSyncAction;
  const taskLocks = {
    invoke: async (input: { frozen: boolean; wasFrozen: boolean }) => {
      events.push(`taskLocks:${input.frozen}:${input.wasFrozen}`);
    },
  } as unknown as ReconcileProjectTaskLocksAction;
  const taskCapture = {
    invoke: async (project: string) => {
      events.push(`capture:${project}`);
    },
  } as unknown as CaptureTasksAction;
  const taskFields = {
    invoke: async (project: string) => {
      events.push(`reconcile:${project}`);
    },
  } as unknown as MirrorSyncAction;

  const action = new SyncProjectAction({
    vault,
    mirrorAdapters,
    lifecycle,
    taskLocks,
    taskCapture,
    taskFields,
    migrateHomeNote: new MigrateProjectHomeNoteAction(vault),
    detectNoteRenames: renames,
    completeTaskCascade: cascade,
    syncChecklist: checklist,
    mirrorTodoStatus: mirrorStatus,
    sweepDeletedNotes: new SweepDeletedNotesAction(
      vault,
      syncState,
      handleDeleted,
    ),
    ensureProjectBoard: ensureBoard,
  });

  return {
    action,
    events,
    vault,
    syncState,
    deletedConnections,
  };
}

describe('the multi-adapter pass', () => {
  it('runs the steps in order', async () => {
    const todo = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    const h = harness({ taken: [todo] });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([
      'lifecycle',
      'taskLocks:false:false',
      'renames',
      `cascade:${todo}`,
      `checklist:${todo}`,
      `mirror:${todo}`,
      'capture:Acme Widgets',
      'reconcile:Acme Widgets',
    ]);
  });

  it('no-ops a stale work item whose pm-note is gone', async () => {
    const h = harness({ projectNotes: [] });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([]);
  });

  it('isolates a failing step: a failing step never starves the rest', async () => {
    const h = harness({ failRenames: true });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([
      'lifecycle',
      'taskLocks:false:false',
      'capture:Acme Widgets',
      'reconcile:Acme Widgets',
    ]);
  });

  it('freezes a project when the folder is archived or the lifecycle pass reports it frozen', async () => {
    for (const options of [
      { projectNotes: [projectNote('Acme Widgets', '')] },
      { frozen: true },
    ]) {
      const h = harness(options);

      await h.action.execute('Acme Widgets');

      expect(h.events).toEqual([
        'lifecycle',
        'taskLocks:true:false',
        'renames',
      ]);
    }
  });

  it('ensures the board for an active project before reconciliation', async () => {
    const h = harness({ ensureBoard: true });

    await h.action.execute('Acme Widgets');

    expect(h.events.slice(0, 2)).toEqual([
      'ensureBoard:Acme Widgets/github',
      'lifecycle',
    ]);
  });

  it('never ensures a board for an archived project', async () => {
    const h = harness({
      projectNotes: [projectNote('Acme Widgets', '')],
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).not.toContain('ensureBoard:Acme Widgets');
  });

  it('migrates a legacy-named home note', async () => {
    const h = harness();

    await h.action.execute('Acme Widgets');

    expect(h.vault.renames).toEqual([
      {
        from: 'Projecten/Acme Widgets/_home.md',
        to: 'Projecten/Acme Widgets/_Acme Widgets.md',
      },
    ]);
  });
});

describe('the deletion sweep', () => {
  it('deletes a gone active-project note for each code-host connection', async () => {
    const h = harness({
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain(
      'delete:Projecten/Acme Widgets/taken/42-gone.md',
    );
  });

  it('leaves a present note alone', async () => {
    const h = harness({
      statuses: [status('Projecten/Acme Widgets/taken/42-fix-the-bug.md')],
    });
    h.vault.notes.set(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'content',
    );

    await h.action.execute('Acme Widgets');

    expect(h.events).not.toContain(
      'delete:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
  });

  it('never sweeps an archived note', async () => {
    const h = harness({
      statuses: [status('Archief/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).not.toContain(
      'delete:Archief/Acme Widgets/taken/42-gone.md',
    );
  });

  it('hands every connection to the deletion handler', async () => {
    const h = harness({
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Acme Widgets');

    expect(h.deletedConnections).toEqual(['github', 'todoist']);
  });
});

describe('SHELL-2 — every declared connection is resolved-or-created', () => {
  it('resolves-or-creates each declared connection, whatever its tool', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null, [
          {
            slug: 'github',
            application: 'github',
            target: 'https://github.com/acme/widgets',
          },
          { slug: 'linear', application: 'linear', target: 'L1' },
        ]),
      ],
      adapterApplications: ['github', 'linear'],
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain('ensureBoard:Acme Widgets/github');
    expect(h.events).toContain('ensureBoard:Acme Widgets/linear');
  });
});

describe('SHELL-3 — the deletion sweep covers every connection', () => {
  it('sweeps a gone note on a connection whose application has no setup port', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null, [
          { slug: 'linear', application: 'linear', target: 'L1' },
        ]),
      ],
      adapterApplications: [],
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain(
      'delete:Projecten/Acme Widgets/taken/42-gone.md',
    );
    expect(h.deletedConnections).toEqual(['linear']);
  });
});

describe('SHELL-2 — the chain runs its origination step before reconciliation', () => {
  it('resolves-or-creates the declared connection, then still runs the task steps', async () => {
    const h = harness({
      connections: [
        {
          slug: 'github',
          application: 'github',
          target: 'https://github.com/acme/widgets',
        },
      ],
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([
      'ensureBoard:Acme Widgets/github',
      'lifecycle',
      'taskLocks:false:false',
      'renames',
      'capture:Acme Widgets',
      'reconcile:Acme Widgets',
    ]);
  });
});

describe('ORG-4 — no declared connection, no fan-out', () => {
  it('fans out nothing when the project declares no connections', async () => {
    const h = harness({ connections: [], ensureBoard: true });

    await h.action.execute('Acme Widgets');

    expect(h.events.filter((event) => event.startsWith('ensureBoard'))).toEqual(
      [],
    );
  });
});
