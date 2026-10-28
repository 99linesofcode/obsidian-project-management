import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../../src/core/application/actions/SyncProjectAction.js';
import type { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import { EnsureProjectBoardAction } from '../../../../src/core/application/actions/EnsureProjectBoardAction.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import type { MigrateNoteIdsAction } from '../../../../src/core/application/actions/MigrateNoteIdsAction.js';
import type { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import type { SyncChecklistAction } from '../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import type { CaptureTasksAction } from '../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import type { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import type { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import type { ProjectNoteDataTransferObject } from '../../../../src/core/port/data/ProjectNoteDataTransferObject.js';
import type { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { EntityRecord } from '../../../../src/core/port/data/EntityRecord.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
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
  noteIds = new Map<string, string>();
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
  override async readNoteIds(): Promise<
    readonly { id: string; path: string }[]
  > {
    return this.projectNotes.map((note) => ({
      id: this.noteIds.get(note.path) ?? note.projectName,
      path: note.path,
    }));
  }
  override async listEntities(projectId: string): Promise<readonly string[]> {
    const note = this.projectNotes.find(
      (candidate) => candidate.projectName === projectId,
    );
    if (note === undefined) {
      return [];
    }
    const folder = note.path.split('/').slice(0, 2).join('/');
    return this.folders.get(`${folder}/taken`) ?? [];
  }
  override async trashNote(): Promise<void> {}
  override async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    return this.projectNotes;
  }
  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}

  appliedArchived: Array<{ project: string; archived: boolean }> = [];

  override async readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]> {
    return (
      this.projectNotes.find((note) => note.projectName === project)
        ?.connections ?? []
    );
  }
  override async observeProject(project: string): Promise<OriginObservation> {
    const note = this.projectNotes.find(
      (candidate) => candidate.projectName === project,
    );
    return new OriginObservation({
      current:
        note !== undefined && note.path.startsWith('Archief/')
          ? 'true'
          : 'false',
      currentCompleted: false,
      fieldTime: null,
      trustworthy: false,
    });
  }
  override async applyProjectArchived(
    project: string,
    archived: boolean,
  ): Promise<void> {
    this.appliedArchived.push({ project, archived });
  }
}

function projectNote(
  projectName: string,
  archived: boolean,
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
    path: `${archived ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    connections,
    connectionErrors: [],
  };
}

function status(notePath: string): EntityRecord {
  return entityRecord({ id: 'entity-42', notePath });
}

function projectNoteAt(path: string): ProjectNoteDataTransferObject {
  return {
    path,
    projectName: 'Acme Widgets',
    connections: [
      {
        slug: 'github',
        application: 'github',
        target: 'https://github.com/acme/widgets',
      },
    ],
    connectionErrors: [],
  };
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
  failLifecycle?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const deletedConnections: string[] = [];
  const vault = new FakeVault();
  vault.projectNotes = options.projectNotes ?? [
    projectNote('Acme Widgets', false, options.connections),
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
    options.frozen ??
    vault.projectNotes[0]?.path.startsWith('Archief/') ??
    false;

  const lifecycle = {
    invoke: async () => {
      if (options.failLifecycle) {
        throw new Error('lifecycle failed');
      }
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
    invoke: async (project: { projectName: string }) => {
      events.push(`capture:${project.projectName}`);
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
    migrateNoteIds: {
      execute: async () => {},
    } as unknown as MigrateNoteIdsAction,
    migrateHomeNote: new MigrateProjectHomeNoteAction(vault),
    detectNoteRenames: renames,
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

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).toEqual([
      'lifecycle',
      'taskLocks:false:false',
      'renames',
      `checklist:${todo}`,
      `mirror:${todo}`,
      'capture:Acme Widgets',
      'reconcile:Acme Widgets',
    ]);
  });

  it('no-ops a stale work item whose pm-note is gone', async () => {
    const h = harness({ projectNotes: [] });

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).toEqual([]);
  });

  it('isolates a failing step: a failing step never starves the rest', async () => {
    const h = harness({ failRenames: true });

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).toEqual([
      'lifecycle',
      'taskLocks:false:false',
      'capture:Acme Widgets',
      'reconcile:Acme Widgets',
    ]);
  });

  it('freezes a project when the folder is archived or the lifecycle pass reports it frozen', async () => {
    for (const options of [
      {
        folder: 'Archief/Acme Widgets',
        projectNotes: [projectNote('Acme Widgets', true)],
      },
      { folder: 'Projecten/Acme Widgets', frozen: true },
    ]) {
      const h = harness(options);

      await h.action.execute(options.folder);

      expect(h.events).toEqual([
        'lifecycle',
        'taskLocks:true:false',
        'renames',
      ]);
    }
  });

  it('ensures the board for an active project before reconciliation', async () => {
    const h = harness({ ensureBoard: true });

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events.slice(0, 2)).toEqual([
      'ensureBoard:Acme Widgets/github',
      'lifecycle',
    ]);
  });

  it('originates the declared connections of an archived project (SHELL-2, ORG-3)', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', true, [
          { slug: 'todoist', application: 'todoist', target: '' },
        ]),
      ],
      adapterApplications: ['todoist'],
      ensureBoard: true,
    });

    await h.action.execute('Archief/Acme Widgets');

    expect(h.events).toContain('ensureBoard:Acme Widgets/todoist');
  });

  it('migrates a legacy-named home note', async () => {
    const h = harness();

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.vault.renames).toEqual([
      {
        from: 'Projecten/Acme Widgets/_home.md',
        to: 'Projecten/Acme Widgets/_Acme Widgets.md',
      },
    ]);
  });
});

describe('I6 — the project is keyed by the home note, not a stray root note', () => {
  it('keys the project to the home note id when a stray note enumerates first', async () => {
    const stray = 'Projecten/Acme Widgets/AAA-stray.md';
    const home = 'Projecten/Acme Widgets/_Acme Widgets.md';
    const h = harness({
      projectNotes: [projectNoteAt(stray), projectNoteAt(home)],
    });
    h.vault.noteIds.set(stray, 'stray-id');
    h.vault.noteIds.set(home, 'home-id');

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).toContain('reconcile:home-id');
    expect(h.events).not.toContain('reconcile:stray-id');
  });
});

describe('the lifecycle fallback', () => {
  it('derives frozen from the folder when the lifecycle pass throws', async () => {
    for (const [archived, verdict] of [
      [false, 'taskLocks:false:false'],
      [true, 'taskLocks:true:false'],
    ] as const) {
      const h = harness({
        projectNotes: [projectNote('Acme Widgets', archived)],
        failLifecycle: true,
      });

      await h.action.execute(
        archived ? 'Archief/Acme Widgets' : 'Projecten/Acme Widgets',
      );

      expect(h.events).toContain(verdict);
    }
  });
});

describe('the deletion sweep', () => {
  it('deletes a gone active-project note for each code-host connection', async () => {
    const h = harness({
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Projecten/Acme Widgets');

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

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).not.toContain(
      'delete:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );
  });

  it('never sweeps an archived note', async () => {
    const h = harness({
      statuses: [status('Archief/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).not.toContain(
      'delete:Archief/Acme Widgets/taken/42-gone.md',
    );
  });

  it('hands every connection to the deletion handler', async () => {
    const h = harness({
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.deletedConnections).toEqual(['github', 'todoist']);
  });
});

describe('SHELL-2 — every declared connection is resolved-or-created', () => {
  it('resolves-or-creates each declared connection, whatever its tool', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', false, [
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

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events).toContain('ensureBoard:Acme Widgets/github');
    expect(h.events).toContain('ensureBoard:Acme Widgets/linear');
  });
});

describe('SHELL-3 — the deletion sweep covers every connection', () => {
  it('sweeps a gone note on a connection whose application has no setup port', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', false, [
          { slug: 'linear', application: 'linear', target: 'L1' },
        ]),
      ],
      adapterApplications: [],
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Projecten/Acme Widgets');

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

    await h.action.execute('Projecten/Acme Widgets');

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

    await h.action.execute('Projecten/Acme Widgets');

    expect(h.events.filter((event) => event.startsWith('ensureBoard'))).toEqual(
      [],
    );
  });
});

describe('ORG-2, ORG-3 — an archived project originates its empty-target connection', () => {
  it('records the identity and fans the restore out instead of dropping the connection (ORG-2, ORG-3)', async () => {
    const vault = new FakeVault();
    vault.projectNotes = [
      projectNote('Acme Widgets', true, [
        { slug: 'todoist', application: 'todoist', target: '' },
      ]),
    ];
    const syncState = new FakeSyncState();
    await syncState.writeBaseline(
      'Acme Widgets',
      'archived',
      'origin',
      new Baseline('true', false),
    );
    await syncState.writeBaseline(
      'Acme Widgets',
      'archived',
      'mirror:todoist',
      new Baseline('true', false),
    );
    const mirror = new ConformanceMirrorAdapter();
    const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => mirror };

    const action = new SyncProjectAction({
      vault,
      mirrorAdapters,
      lifecycle: new ProjectLifecycleSyncAction(
        vault,
        syncState,
        mirrorAdapters,
      ),
      taskLocks: {
        invoke: async () => {},
      } as unknown as ReconcileProjectTaskLocksAction,
      taskCapture: {
        invoke: async () => {},
      } as unknown as CaptureTasksAction,
      taskFields: {
        invoke: async () => {},
      } as unknown as MirrorSyncAction,
      migrateNoteIds: {
        execute: async () => {},
      } as unknown as MigrateNoteIdsAction,
      migrateHomeNote: new MigrateProjectHomeNoteAction(vault),
      detectNoteRenames: {
        execute: async () => {},
      } as unknown as DetectNoteRenamesAction,
      syncChecklist: {
        execute: async () => {},
      } as unknown as SyncChecklistAction,
      mirrorTodoStatus: {
        execute: async () => {},
      } as unknown as MirrorTodoStatusAction,
      sweepDeletedNotes: new SweepDeletedNotesAction(vault, syncState, {
        execute: async () => {},
      } as unknown as HandleDeletedNoteAction),
      ensureProjectBoard: new EnsureProjectBoardAction(syncState, []),
    });

    await action.execute('Archief/Acme Widgets');

    expect(
      await syncState.getIdentity('Acme Widgets', 'todoist'),
    ).not.toBeNull();
    expect(vault.appliedArchived).toEqual([
      { project: 'Acme Widgets', archived: false },
    ]);
  });
});
