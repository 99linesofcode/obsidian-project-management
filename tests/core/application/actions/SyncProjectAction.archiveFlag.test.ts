import { describe, expect, it } from 'vitest';
import { SyncProjectAction } from '../../../../src/core/application/actions/SyncProjectAction.js';
import type { CaptureTasksAction } from '../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import type { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import type { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import type { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import type { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import type { ReconcileProjectTaskLocksAction } from '../../../../src/core/application/actions/ReconcileProjectTaskLocksAction.js';
import type { SyncChecklistAction } from '../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import type { MigrateProjectHomeNoteAction } from '../../../../src/core/application/actions/MigrateProjectHomeNoteAction.js';
import type { MigrateNameAction } from '../../../../src/core/application/actions/MigrateNameAction.js';
import type { RenameProjectAction } from '../../../../src/core/application/actions/RenameProjectAction.js';
import type { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import type { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import type { ProjectNoteDataTransferObject } from '../../../../src/core/port/data/ProjectNoteDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const github: ConnectionDataTransferObject = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

// A note as it appears after S22: the folder is the archived state, and there
// is no archive flag on the DTO. Cast so the literal compiles before the field
// is removed.
function note(
  projectName: string,
  path: string,
): ProjectNoteDataTransferObject {
  return {
    path,
    projectName,
    connections: [github],
    connectionErrors: [],
  } as unknown as ProjectNoteDataTransferObject;
}

interface Captured {
  migrate: Array<{ notePath: string; locationArchived: boolean }>;
  rename: Array<{ notePath: string; locationArchived: boolean }>;
}

class RecordingVault extends FakeVaultBase {
  readonly captured: Captured = { migrate: [], rename: [] };
  readonly notes: ProjectNoteDataTransferObject[];

  constructor(notes: ProjectNoteDataTransferObject[]) {
    super();
    this.notes = notes;
  }

  override async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    return this.notes;
  }

  override async listNotesInFolder(): Promise<string[]> {
    return [];
  }
}

function harness(projectNote: ProjectNoteDataTransferObject): {
  action: SyncProjectAction;
  captured: Captured;
} {
  const vault = new RecordingVault([projectNote]);
  const captured = vault.captured;

  const migrate = {
    execute: async (input: {
      notePath: string;
      locationArchived: boolean;
    }) => {
      captured.migrate.push(input);
      return input.notePath;
    },
  } as unknown as MigrateProjectHomeNoteAction;

  const rename = {
    execute: async (input: { notePath: string; locationArchived: boolean }) => {
      captured.rename.push(input);
      return [];
    },
  } as unknown as RenameProjectAction;

  const action = new SyncProjectAction({
    vault,
    mirrorAdapters: { create: () => null } as MirrorAdapterFactoryPort,
    lifecycle: {
      invoke: async () => ({ frozen: false, wasFrozen: false }),
    } as unknown as ProjectLifecycleSyncAction,
    taskLocks: { invoke: async () => {} } as unknown as ReconcileProjectTaskLocksAction,
    taskCapture: { invoke: async () => {} } as unknown as CaptureTasksAction,
    taskFields: { invoke: async () => {} } as unknown as MirrorSyncAction,
    migrateName: { execute: async () => {} } as unknown as MigrateNameAction,
    migrateHomeNote: migrate,
    renameProject: rename,
    detectNoteRenames: {
      execute: async () => {},
    } as unknown as DetectNoteRenamesAction,
    syncChecklist: {
      execute: async () => {},
    } as unknown as SyncChecklistAction,
    mirrorTodoStatus: {
      execute: async () => {},
    } as unknown as MirrorTodoStatusAction,
    sweepDeletedNotes: {
      execute: async () => {},
    } as unknown as SweepDeletedNotesAction,
  });

  return { action, captured };
}

describe('S22 — the note-flag consumers read the folder instead', () => {
  it('derives the archived location from the note path for the migrate and rename steps', async () => {
    const active = harness(note('Acme Widgets', 'Projecten/Acme Widgets/_home.md'));
    await active.action.execute('Acme Widgets');

    const archived = harness(note('Acme Widgets', 'Archief/Acme Widgets/_home.md'));
    await archived.action.execute('Acme Widgets');

    expect(active.captured.migrate[0]?.locationArchived).toBe(false);
    expect(active.captured.rename[0]?.locationArchived).toBe(false);
    expect(archived.captured.migrate[0]?.locationArchived).toBe(true);
    expect(archived.captured.rename[0]?.locationArchived).toBe(true);
  });
});
