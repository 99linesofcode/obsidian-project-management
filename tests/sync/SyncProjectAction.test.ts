import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../src/sync/SyncProjectAction.js';
import type { DetectNoteRenamesAction } from '../../src/sync/DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from '../../src/projects/EnsureProjectBoardAction.js';
import type { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../src/todos/MirrorTodoStatusAction.js';
import type { SyncChecklistAction } from '../../src/todos/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import type { ProjectLifecycleReconciler } from '../../src/sync/ProjectLifecycleReconciler.js';
import type { ProjectTaskLocksReconciler } from '../../src/sync/ProjectTaskLocksReconciler.js';
import type { ProjectReactivationReconciler } from '../../src/sync/ProjectReactivationReconciler.js';
import type { TaskCaptureReconciler } from '../../src/sync/TaskCaptureReconciler.js';
import type { TaskFieldReconciler } from '../../src/sync/TaskFieldReconciler.js';
import type { ProjectNoteData } from '../../src/core/ProjectNoteData.js';
import type { ConnectionData } from '../../src/core/ConnectionData.js';
import type { ProjectSetupPort } from '../../src/core/ports/ProjectSetupPort.js';
import type { ProjectSetupFactoryPort } from '../../src/core/ports/ProjectSetupFactoryPort.js';
import type { EntityRecord } from '../../src/core/data/EntityRecord.js';
import type { NoteEnumeratorPort } from '../../src/core/ports/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../src/core/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../../src/core/ports/NoteWriterPort.js';
import type { VaultEventPort } from '../../src/core/ports/VaultEventPort.js';
import { entityRecord } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { ProjectShell } from '../../src/sync/ProjectShell.js';
import type { CoreReconcilers } from '../../src/sync/CoreReconcilers.js';

class FakeVault
  implements NoteReaderPort, NoteWriterPort, NoteEnumeratorPort, VaultEventPort
{
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  projectNotes: ProjectNoteData[] = [];
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();
  renames: Array<{ from: string; to: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
  }
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.projectNotes;
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

function reconcileRecorder(events: string[]): TaskFieldReconciler {
  return {
    reconcile: async (project) => {
      events.push(`reconcile:${project}`);
    },
  };
}

function projectLifecycleRecorder(
  events: string[],
  frozen: boolean,
  wasFrozen = false,
): ProjectLifecycleReconciler {
  return {
    reconcile: async () => {
      events.push('lifecycle');
      return { frozen, wasFrozen };
    },
  };
}

function taskCaptureRecorder(events: string[]): TaskCaptureReconciler {
  return {
    capture: async (project) => {
      events.push(`capture:${project}`);
    },
  };
}

function taskLocksRecorder(events: string[]): ProjectTaskLocksReconciler {
  return {
    reconcile: async (input) => {
      events.push(`taskLocks:${input.frozen}:${input.wasFrozen}`);
    },
  };
}

function reactivationRecorder(events: string[]): ProjectReactivationReconciler {
  return {
    reactivate: async (project) => {
      events.push(`reactivate:${project}`);
      return false;
    },
  };
}

function projectNote(
  projectName: string,
  archivedAt: string | null,
  connections: Record<string, ConnectionData> = {
    github: { tool: 'github', project: 'https://github.com/acme/widgets' },
    todoist: { tool: 'todoist', project: 'P1' },
  },
): ProjectNoteData {
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
  projectNotes?: ProjectNoteData[];
  frozen?: boolean;
  statuses?: EntityRecord[];
  taken?: string[];
  todos?: string[];
  ensureBoard?: boolean;
  connections?: Record<string, ConnectionData>;
  setupApplications?: string[];
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
  vault.folders.set('Projecten/Acme Widgets/todos', options.todos ?? []);
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

  const setupApplications = options.setupApplications ?? ['github'];
  const setupFactory: ProjectSetupFactoryPort = {
    setupFor: (application) =>
      setupApplications.includes(application) ? ({} as ProjectSetupPort) : null,
  };

  const frozen =
    options.frozen ?? (vault.projectNotes[0]?.archivedAt ?? null) !== null;

  const shell = new ProjectShell({
    vault,
    syncState,
    setupFactory,
    detectNoteRenames: renames,
    completeTaskCascade: cascade,
    syncChecklist: checklist,
    mirrorTodoStatus: mirrorStatus,
    handleDeletedNote: handleDeleted,
    ensureProjectBoard: ensureBoard,
  });
  const reconcilers: CoreReconcilers = {
    taskFields: reconcileRecorder(events),
    lifecycle: projectLifecycleRecorder(events, frozen),
    taskLocks: taskLocksRecorder(events),
    reactivation: reactivationRecorder(events),
    taskCapture: taskCaptureRecorder(events),
  };

  const action = new SyncProjectAction(vault, shell, reconcilers);

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
    const h = harness({
      taken: ['Projecten/Acme Widgets/taken/42-fix-the-bug.md'],
      todos: ['Projecten/Acme Widgets/todos/fix-the-bug.md'],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([
      'reactivate:Acme Widgets',
      'lifecycle',
      'taskLocks:false:false',
      'renames',
      'cascade:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'checklist:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'mirror:Projecten/Acme Widgets/todos/fix-the-bug.md',
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
      'reactivate:Acme Widgets',
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
        'reactivate:Acme Widgets',
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
      'reactivate:Acme Widgets',
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

describe('SHELL-2 — setup-capable connections only', () => {
  it('skips ensure-board for a connection whose application has no setup port', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null, {
          github: {
            tool: 'github',
            project: 'https://github.com/acme/widgets',
          },
          linear: { tool: 'linear', project: 'L1' },
        }),
      ],
      setupApplications: ['github'],
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain('ensureBoard:Acme Widgets/github');
    expect(h.events).not.toContain('ensureBoard:Acme Widgets/linear');
  });

  it('runs ensure-board for a setup-capable non-github connection', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null, {
          linear: { tool: 'linear', project: 'L1' },
        }),
      ],
      setupApplications: ['linear'],
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain('ensureBoard:Acme Widgets/linear');
  });
});

describe('SHELL-3 — the deletion sweep covers every connection', () => {
  it('sweeps a gone note on a connection whose application has no setup port', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null, {
          linear: { tool: 'linear', project: 'L1' },
        }),
      ],
      setupApplications: [],
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toContain(
      'delete:Projecten/Acme Widgets/taken/42-gone.md',
    );
    expect(h.deletedConnections).toEqual(['linear']);
  });
});
