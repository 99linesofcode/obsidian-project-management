import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../src/sync/SyncProjectAction.js';
import type { DetectNoteRenamesAction } from '../../src/sync/DetectNoteRenamesAction.js';
import type { EnsureProjectBoardAction } from '../../src/projects/EnsureProjectBoardAction.js';
import type { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import type { MirrorTodoStatusAction } from '../../src/todos/MirrorTodoStatusAction.js';
import type { ProbeProjectsAction } from '../../src/sync/ProbeProjectsAction.js';
import type {
  ProjectLifecycleVerdict,
  ReconcileProjectLifecycleAction,
} from '../../src/projects/ReconcileProjectLifecycleAction.js';
import type { SyncChecklistAction } from '../../src/todos/SyncChecklistAction.js';
import type { CompleteTaskCascadeAction } from '../../src/tasks/CompleteTaskCascadeAction.js';
import type { SyncHalfFactory } from '../../src/sync/SyncHalves.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { ProjectStateData } from '../../src/shared/ProjectStateData.js';
import type { EntityRecord } from '../../src/shared/SyncStatePort.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';
import { entityRecord } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

// Fakes at the ports and at every composed step, recording into one shared
// events array so the chain's step order and its error isolation are what's
// under test.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  projectNotes: ProjectNoteData[] = [];
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
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

class FakeProbe {
  fail = false;
  states = new Map<string, ProjectStateData>();

  async execute(): Promise<Map<string, ProjectStateData>> {
    if (this.fail) {
      throw new Error('probe failed');
    }
    return this.states;
  }
}

class FakeLifecycle {
  frozen = false;
  projectId: string | null = 'P1';
  fail = false;
  calls: Array<{ projectName: string; closed?: boolean }> = [];

  constructor(private readonly events: string[]) {}

  async execute(input: {
    projectName: string;
    notePath: string;
    locationArchived: boolean;
    syncedAt: string;
    closed?: boolean;
  }): Promise<ProjectLifecycleVerdict> {
    this.calls.push({
      projectName: input.projectName,
      ...(input.closed === undefined ? {} : { closed: input.closed }),
    });
    this.events.push('lifecycle');
    if (this.fail) {
      throw new Error('lifecycle failed');
    }
    return {
      remoteProjectId: this.frozen ? null : this.projectId,
      frozen: this.frozen,
      notePath: input.notePath,
      archivedAt: this.frozen ? '' : null,
    };
  }
}

class FakeSweep {
  fail = false;
  calls: Array<{
    projectName: string;
    syncedAt: string;
    includeBoard: boolean;
  }> = [];

  constructor(private readonly events: string[]) {}

  async execute(input: {
    projectName: string;
    syncedAt: string;
    includeBoard: boolean;
  }): Promise<void> {
    this.calls.push(input);
    this.events.push('sweep');
    if (this.fail) {
      throw new Error('sweep failed');
    }
  }
}

function projectNote(
  projectName: string,
  archivedAt: string | null,
): ProjectNoteData {
  return {
    path: `${archivedAt !== null ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    archivedAt,
    connections: {
      github: { tool: 'github', project: 'https://github.com/acme/widgets' },
      todoist: { tool: 'todoist', project: 'P1' },
    },
    connectionErrors: [],
  };
}

// A tracked issue's registry entity; the deletion sweep reads only its note
// path, so the base content is immaterial here.
function status(notePath: string): EntityRecord {
  return entityRecord({ id: 'entity-42', notePath });
}

interface HarnessOptions {
  projectNotes?: ProjectNoteData[];
  state?: ProjectStateData | undefined;
  statuses?: EntityRecord[];
  taken?: string[];
  todos?: string[];
  ensureBoard?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const vault = new FakeVault();
  vault.projectNotes = options.projectNotes ?? [
    projectNote('Acme Widgets', null),
  ];
  vault.folders.set('Projecten/Acme Widgets/taken', options.taken ?? []);
  vault.folders.set('Projecten/Acme Widgets/todos', options.todos ?? []);
  const syncState = new FakeSyncState();
  for (const record of options.statuses ?? []) {
    syncState.records.set(record.id, record);
  }

  const probe = new FakeProbe();
  if (options.state !== undefined) {
    probe.states.set('Acme Widgets', options.state);
  }

  const lifecycle = new FakeLifecycle(events);
  lifecycle.frozen =
    (vault.projectNotes[0]?.archivedAt ?? null) !== null ||
    (options.state?.closed ?? false);
  const renames = {
    execute: async () => {
      events.push('renames');
    },
  } as unknown as DetectNoteRenamesAction;
  const sweep = new FakeSweep(events);
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
  const todoist = {
    execute: async () => {
      events.push('todoist');
    },
  };
  const handleDeleted = {
    execute: async (input: { notePath: string }) => {
      events.push(`delete:${input.notePath}`);
    },
  } as unknown as HandleDeletedNoteAction;

  const ensureBoard = options.ensureBoard
    ? ({
        execute: async (input: { projectName: string }) => {
          events.push(`ensureBoard:${input.projectName}`);
        },
      } as unknown as EnsureProjectBoardAction)
    : undefined;

  const halfFactory: SyncHalfFactory = {
    create: (slug, connection) => {
      if (connection.tool === 'github') {
        return {
          connectionSlug: slug,
          requiresBoard: true,
          execute: (input) => sweep.execute(input),
        };
      }
      if (connection.tool === 'todoist') {
        return {
          connectionSlug: slug,
          requiresBoard: false,
          execute: async () => {
            await todoist.execute();
          },
        };
      }
      return null;
    },
  };

  const action = new SyncProjectAction(
    vault,
    syncState,
    probe as unknown as ProbeProjectsAction,
    lifecycle as unknown as ReconcileProjectLifecycleAction,
    renames,
    halfFactory,
    cascade,
    checklist,
    mirrorStatus,
    handleDeleted,
    ensureBoard,
  );

  return { action, events, vault, syncState, probe, sweep, lifecycle };
}

const openState: ProjectStateData = {
  projectId: 'PVT_123',
  updatedAt: '2026-09-18T10:00:00Z',
  closed: false,
};

describe('SYNC-8 — the chain settles: a second pass writes nothing', () => {
  it('runs the steps in order', async () => {
    const h = harness({
      state: openState,
      taken: ['Projecten/Acme Widgets/taken/42-fix-the-bug.md'],
      todos: ['Projecten/Acme Widgets/todos/fix-the-bug.md'],
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([
      'lifecycle',
      'renames',
      'sweep',
      'cascade:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'checklist:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'mirror:Projecten/Acme Widgets/todos/fix-the-bug.md',
      'todoist',
    ]);
  });

  it('no-ops a stale work item whose pm-note is gone', async () => {
    const h = harness({ projectNotes: [] });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual([]);
  });

  it('isolates a half-failure: a failing step never starves the rest', async () => {
    type H = ReturnType<typeof harness>;
    const cases: Array<{
      name: string;
      prepare: (h: H) => void;
      assert: (h: H) => void;
    }> = [
      {
        name: 'sweep fails',
        prepare: (h) => {
          h.sweep.fail = true;
        },
        assert: (h) => {
          expect(h.events).toContain('todoist');
          expect(h.syncState.lastUpdateSets).toEqual([]);
        },
      },
      {
        name: 'probe fails',
        prepare: (h) => {
          h.probe.fail = true;
        },
        assert: (h) => {
          expect(h.events).toEqual([
            'lifecycle',
            'renames',
            'todoist',
          ]);
        },
      },
      {
        name: 'lifecycle fails',
        prepare: (h) => {
          h.lifecycle.fail = true;
        },
        assert: (h) => {
          // The lifecycle failure leaves the project unfrozen (the archive
          // signal is the fallback), so both halves still run: each half knows
          // its own connection's project.
          expect(h.events).toEqual([
            'lifecycle',
            'renames',
            'sweep',
            'todoist',
          ]);
        },
      },
    ];
    for (const c of cases) {
      const h = harness({ state: openState });
      c.prepare(h);

      await h.action.execute('Acme Widgets');

      c.assert(h);
    }
  });

  it('advances the stored update only after a successful sweep', async () => {
    const h = harness({ state: openState });

    await h.action.execute('Acme Widgets');

    expect(h.syncState.lastUpdateSets).toEqual([
      { projectName: 'Acme Widgets', iso: '2026-09-18T10:00:00Z' },
    ]);
  });

  it('freezes a project when the folder is archived or the board is closed', async () => {
    for (const options of [
      {
        projectNotes: [projectNote('Acme Widgets', '')],
        state: { ...openState, closed: true },
      },
      { state: { ...openState, closed: true } },
    ]) {
      const h = harness(options);

      await h.action.execute('Acme Widgets');

      expect(h.events).toEqual(['lifecycle', 'renames']);
    }
  });

  it('skips the GitHub side but still mirrors Todoist when there is no probed state', async () => {
    const h = harness({ state: undefined });

    await h.action.execute('Acme Widgets');

    expect(h.events).toEqual(['lifecycle', 'renames', 'todoist']);
  });

  it('sweeps only a gone active-project note, last, after the Todoist half', async () => {
    const gone = harness({
      state: openState,
      statuses: [status('Projecten/Acme Widgets/taken/42-gone.md')],
    });
    await gone.action.execute('Acme Widgets');
    expect(gone.events).toEqual([
      'lifecycle',
      'renames',
      'sweep',
      'todoist',
      'delete:Projecten/Acme Widgets/taken/42-gone.md',
    ]);

    const present = harness({
      state: openState,
      statuses: [status('Projecten/Acme Widgets/taken/42-fix-the-bug.md')],
    });
    present.vault.notes.set(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'content',
    );
    await present.action.execute('Acme Widgets');
    expect(present.events).not.toContain(
      'delete:Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );

    const archived = harness({
      state: openState,
      statuses: [status('Archief/Acme Widgets/taken/42-gone.md')],
    });
    await archived.action.execute('Acme Widgets');
    expect(archived.events).not.toContain(
      'delete:Archief/Acme Widgets/taken/42-gone.md',
    );
  });

  it('opens the board gate only when the probe updatedAt moved', async () => {
    const closed = harness({ state: openState });
    closed.syncState.lastUpdates.set('Acme Widgets', openState.updatedAt);
    await closed.action.execute('Acme Widgets');
    expect(closed.sweep.calls[0]!.includeBoard).toBe(false);

    const open = harness({ state: openState });
    open.syncState.lastUpdates.set('Acme Widgets', '2026-09-18T09:00:00Z');
    await open.action.execute('Acme Widgets');
    expect(open.sweep.calls[0]!.includeBoard).toBe(true);
  });

  it('forces one full scan while the marker is pending, then closes the gate', async () => {
    const h = harness({ state: openState });
    h.syncState.lastUpdates.set('Acme Widgets', openState.updatedAt);
    h.syncState.fullScanPending.add('Acme Widgets');

    await h.action.execute('Acme Widgets');

    expect(h.sweep.calls[0]!.includeBoard).toBe(true);
    expect(h.syncState.fullScanConsumes).toEqual([
      { project: 'Acme Widgets', pending: true },
    ]);
    expect(h.syncState.fullScanPending.has('Acme Widgets')).toBe(false);

    h.sweep.calls = [];
    await h.action.execute('Acme Widgets');
    expect(h.sweep.calls[0]!.includeBoard).toBe(false);
    expect(h.syncState.fullScanConsumes).toEqual([
      { project: 'Acme Widgets', pending: true },
    ]);
  });

  it('leaves the forced scan pending when the GitHub half fails', async () => {
    const h = harness({ state: openState });
    h.syncState.lastUpdates.set('Acme Widgets', openState.updatedAt);
    h.syncState.fullScanPending.add('Acme Widgets');
    h.sweep.fail = true;

    await h.action.execute('Acme Widgets');

    expect(h.syncState.fullScanPending.has('Acme Widgets')).toBe(true);
    expect(h.syncState.fullScanConsumes).toEqual([]);
    expect(h.syncState.lastUpdateSets).toEqual([]);
  });

  it('gives each project its own forced scan', async () => {
    const h = harness({
      projectNotes: [
        projectNote('Acme Widgets', null),
        projectNote('Other', null),
      ],
      state: openState,
    });
    h.probe.states.set('Other', {
      ...openState,
      projectId: 'PVT_456',
    });
    h.syncState.lastUpdates.set('Acme Widgets', openState.updatedAt);
    h.syncState.lastUpdates.set('Other', openState.updatedAt);
    h.syncState.fullScanPending.add('Acme Widgets');
    h.syncState.fullScanPending.add('Other');

    await h.action.execute('Acme Widgets');
    await h.action.execute('Other');

    expect(h.sweep.calls.map((call) => call.includeBoard)).toEqual([
      true,
      true,
    ]);
    expect(h.syncState.fullScanConsumes).toEqual([
      { project: 'Acme Widgets', pending: true },
      { project: 'Other', pending: true },
    ]);
    expect(h.syncState.fullScanPending.size).toBe(0);
  });

  it('ensures the board for an active project before the probe', async () => {
    const h = harness({ state: openState, ensureBoard: true });

    await h.action.execute('Acme Widgets');

    expect(h.events.slice(0, 2)).toEqual([
      'ensureBoard:Acme Widgets',
      'lifecycle',
    ]);
  });

  it('never ensures a board for an archived project', async () => {
    const h = harness({
      projectNotes: [projectNote('Acme Widgets', '')],
      state: { ...openState, closed: true },
      ensureBoard: true,
    });

    await h.action.execute('Acme Widgets');

    expect(h.events).not.toContain('ensureBoard:Acme Widgets');
  });
});
