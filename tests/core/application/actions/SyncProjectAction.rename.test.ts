import { describe, expect, it, vi } from 'vitest';
import { SyncProjectAction } from '../../../../src/core/application/actions/SyncProjectAction.js';
import { MigrateProjectHomeNoteAction } from '../../../../src/core/application/actions/MigrateProjectHomeNoteAction.js';
import { RenameProjectAction } from '../../../../src/core/application/actions/RenameProjectAction.js';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import type { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import type { CaptureTasksAction } from '../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import type { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import type { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import type { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import type { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import type { SyncChecklistAction } from '../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { ProjectNoteDataTransferObject } from '../../../../src/core/port/data/ProjectNoteDataTransferObject.js';
import type { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { portState } from '../../../helpers/records.js';

const github: ConnectionDataTransferObject = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

const identity = new ProjectIdentityDataTransferObject({
  target: 'https://github.com/acme/widgets',
  targetHandle: 'R_kgDOAAAA',
  projectHandle: 'PVT_123',
  statusFieldHandle: '',
  statusOptions: [],
});

class FakeVault extends FakeVaultBase {
  projectNotes: ProjectNoteDataTransferObject[] = [];
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();
  renames: Array<{ from: string; to: string }> = [];
  writes: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  override async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  override async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  override async renameNote(from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
    const content = this.notes.get(from);
    if (content !== undefined) {
      this.notes.delete(from);
      this.notes.set(to, content);
    }
  }
  override async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
  override async trashNote(_path: string): Promise<void> {}
  override async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    return this.projectNotes;
  }
  override onNoteChanged(_cb: (path: string) => void): void {}
  override onNoteDeleted(_cb: (path: string) => void): void {}
  override onNoteRenamed(
    _cb: (oldPath: string, newPath: string) => void,
  ): void {}
}

function note(overrides: {
  path: string;
  projectName: string;
}): ProjectNoteDataTransferObject {
  return {
    path: overrides.path,
    projectName: overrides.projectName,
    connections: [github],
    connectionErrors: [],
  };
}

function homeNote(name: string): string {
  return [
    '---',
    `project: ${name}`,
    'connections:',
    '  github:',
    '    tool: github',
    '    project: https://github.com/acme/widgets',
    '---',
    '',
  ].join('\n');
}

function harness(options: {
  projectNotes: ProjectNoteDataTransferObject[];
  notes?: Map<string, string>;
  folders?: Map<string, string[]>;
}) {
  const vault = new FakeVault();
  vault.projectNotes = options.projectNotes;
  vault.notes = options.notes ?? new Map();
  vault.folders = options.folders ?? new Map();
  const syncState = new FakeSyncState();

  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => null };
  const lifecycle = {
    invoke: async () => ({ frozen: false, wasFrozen: false }),
  } as unknown as ProjectLifecycleSyncAction;
  const taskLocks = {
    invoke: async () => {},
  } as unknown as ReconcileProjectTaskLocksAction;
  const taskCapture = {
    invoke: async () => {},
  } as unknown as CaptureTasksAction;
  const taskFields = { invoke: async () => {} } as unknown as MirrorSyncAction;
  const detectNoteRenames = {
    execute: async () => {},
  } as unknown as DetectNoteRenamesAction;
  const checklist = {
    execute: async () => {},
  } as unknown as SyncChecklistAction;
  const mirrorTodoStatus = {
    execute: async () => {},
  } as unknown as MirrorTodoStatusAction;
  const handleDeleted = {
    execute: async () => {},
  } as unknown as HandleDeletedNoteAction;

  const action = new SyncProjectAction({
    vault,
    mirrorAdapters,
    lifecycle,
    taskLocks,
    taskCapture,
    taskFields,
    migrateHomeNote: new MigrateProjectHomeNoteAction(vault),
    renameProject: new RenameProjectAction(vault, syncState),
    detectNoteRenames,
    syncChecklist: checklist,
    mirrorTodoStatus,
    sweepDeletedNotes: new SweepDeletedNotesAction(
      vault,
      syncState,
      handleDeleted,
    ),
  });

  return { action, vault, syncState };
}

// PLC-2 — a rename is a property change. When a tracked project note's
// `project` value differs from the name the registry recorded (the recorded
// key), the chain renames the home note and its folder — within the project's
// current root — and re-keys the registry's project node and its
// per-connection state. The mirror project's display name follows via the
// unchanged NWM-31 reconciliation (ProjectLifecycleSyncAction's drifted-name
// rename), which the existing lifecycle suite already pins.
describe('PLC-2 — a property change renames the project', () => {
  it('renames the home note and folder and re-keys the registry (active root)', async () => {
    const h = harness({
      projectNotes: [
        note({
          path: 'Projecten/Old Name/_Old Name.md',
          projectName: 'New Name',
        }),
      ],
      notes: new Map([
        ['Projecten/Old Name/_Old Name.md', homeNote('New Name')],
      ]),
    });
    await h.syncState.setPortState(
      'Old Name',
      'github',
      portState({
        provider: 'github',
        project: 'https://github.com/acme/widgets',
      }),
    );
    await h.syncState.setIdentity('Old Name', 'github', identity);

    await h.action.execute('New Name');

    expect(h.vault.renames).toContainEqual({
      from: 'Projecten/Old Name/_Old Name.md',
      to: 'Projecten/New Name/_New Name.md',
    });
    expect(await h.syncState.getPortState('New Name', 'github')).not.toBeNull();
    expect(await h.syncState.getPortState('Old Name', 'github')).toBeNull();
    expect(await h.syncState.getIdentity('New Name', 'github')).not.toBeNull();
  });

  it('renames within the project’s archived root', async () => {
    const h = harness({
      projectNotes: [
        note({
          path: 'Archief/Old Name/_Old Name.md',
          projectName: 'New Name',
        }),
      ],
    });

    await h.action.execute('New Name');

    expect(h.vault.renames).toContainEqual({
      from: 'Archief/Old Name/_Old Name.md',
      to: 'Archief/New Name/_New Name.md',
    });
  });
});

// PLC-3 — a direct folder rename is reconciled to the property. When the
// `project` value still equals the recorded name but the folder differs, the
// folder is renamed back to match the property, and the reconciliation is
// reported (never done silently). The report surface is the plugin's warning
// channel (`console.warn`), the same channel the chain's rekey step uses.
describe('PLC-3 — a direct folder rename is reconciled to the property', () => {
  it('renames the folder back to the property and reports the reconciliation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const h = harness({
        projectNotes: [
          note({ path: 'Projecten/Beta/_Acme.md', projectName: 'Acme' }),
        ],
      });
      await h.syncState.setPortState(
        'Acme',
        'github',
        portState({
          provider: 'github',
          project: 'https://github.com/acme/widgets',
        }),
      );

      await h.action.execute('Acme');

      expect(h.vault.renames).toContainEqual({
        from: 'Projecten/Beta/_Acme.md',
        to: 'Projecten/Acme/_Acme.md',
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// PLC-4 — adoption. A project note with no `project` property adopts the
// folder segment as its value, once — a migration. A value that differs from
// the folder is PLC-2, not adoption.
describe('PLC-4 — a note with no `project` adopts the folder segment, once', () => {
  it('writes the folder segment into `project` and never rewrites it', async () => {
    const path = 'Projecten/Acme Widgets/_Acme Widgets.md';
    const content = [
      '---',
      'connections:',
      '  github:',
      '    tool: github',
      '    project: https://github.com/acme/widgets',
      '---',
      '',
    ].join('\n');
    const h = harness({
      projectNotes: [note({ path, projectName: 'Acme Widgets' })],
      notes: new Map([[path, content]]),
    });

    await h.action.execute('Acme Widgets');

    const adoption = h.vault.writes.find((write) => write.path === path);
    expect(adoption).toBeDefined();
    expect(adoption?.content ?? '').toContain('project: Acme Widgets');

    const writesAfterFirst = h.vault.writes.length;
    await h.action.execute('Acme Widgets');
    expect(h.vault.writes.length).toBe(writesAfterFirst);
  });
});

// F3 — the re-key is gated on the recorded key, not the folder. A property
// change whose folder was already moved (the re-key half-failed on an earlier
// pass) still re-keys the registry: the property differs from the name the
// registry recorded even though the folder already matches.
describe('F3 — the re-key follows the recorded key, not the folder', () => {
  it('re-keys a project whose folder already matches but whose record is stale', async () => {
    const h = harness({
      projectNotes: [
        note({
          path: 'Projecten/New Name/_New Name.md',
          projectName: 'New Name',
        }),
      ],
    });
    await h.syncState.setPortState(
      'Old Name',
      'github',
      portState({
        provider: 'github',
        project: 'https://github.com/acme/widgets',
      }),
    );
    await h.syncState.setIdentity('Old Name', 'github', identity);

    await h.action.execute('New Name');

    expect(await h.syncState.getPortState('New Name', 'github')).not.toBeNull();
    expect(await h.syncState.getPortState('Old Name', 'github')).toBeNull();
    expect(await h.syncState.getIdentity('New Name', 'github')).not.toBeNull();
  });
});
