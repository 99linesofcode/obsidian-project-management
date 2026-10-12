import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../../../src/core/application/actions/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { CanonicalTask } from '../../../../src/core/application/data/CanonicalTask.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { ConnectionDataTransferObject } from '../../../../src/core/application/data/ConnectionDataTransferObject.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { connectionsOf } from '../../../../src/infrastructure/vault/connectionsOf.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const ENTITY_ID = 'uuid-1';
const NOTE_PATH = 'Projecten/Acme/taken/fix-the-bug.md';
const HOME_PATH = 'Projecten/Acme/_Acme.md';
const HANDLE = 'handle-a';

const HOME = [
  '---',
  'type: project',
  'connections:',
  '  gh-main:',
  '    tool: github',
  '    project: target-a',
  '---',
].join('\n');

class FakeNotes extends FakeVaultBase {
  private readonly notes = new Map<string, string>();
  readonly observedHandles: string[] = [];

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  async findHomeNotePath(project: string): Promise<string | null> {
    for (const path of this.notes.keys()) {
      const segments = path.split('/');
      if (
        (segments[0] === 'Projecten' || segments[0] === 'Archief') &&
        segments[1] === project &&
        segments.length === 3
      ) {
        return path;
      }
    }
    return null;
  }

  override async readConnections(
    project: string,
  ): Promise<readonly ConnectionDataTransferObject[]> {
    const path = await this.findHomeNotePath(project);
    if (path === null) {
      return [];
    }
    const note = await this.getNoteByPath(path);
    if (note === null) {
      return [];
    }
    return Object.entries(connectionsOf(note.content)).map(
      ([slug, connection]) =>
        new ConnectionDataTransferObject({
          slug,
          application: connection.tool,
          target: connection.project,
        }),
    );
  }

  override async listEntities(project: string): Promise<readonly string[]> {
    return this.listNotesInFolder(`Projecten/${project}/taken`);
  }

  override async observe(
    handle: string,
    field: string,
  ): Promise<OriginObservation> {
    this.observedHandles.push(handle);
    return new OriginObservation({
      current: originValue(field),
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  override async applyField(): Promise<void> {}

  override async trashNote(): Promise<void> {}
}

function originValue(field: string): string | null {
  switch (field) {
    case 'Status':
      return 'Done';
    case 'subtasks':
      return null;
    case 'completion':
      return 'false';
    case 'title':
      return 'Task';
    default:
      return '';
  }
}

function memoryStorage() {
  let data: Record<string, unknown> = {};
  return {
    storage: {
      async load() {
        return data;
      },
      async save(next: unknown) {
        data = next as Record<string, unknown>;
      },
    },
  };
}

describe('AssembleProjectPassAction — the real adapter wiring (F02 NWM-2)', () => {
  it('bridges a note path to its entity id and then to the connection handle', async () => {
    const notes = new FakeNotes();
    notes.seed(HOME_PATH, HOME);
    notes.seed(NOTE_PATH, '---\ntype: task\n---');

    const syncState = new SyncStateAdapter(memoryStorage().storage);
    await syncState.setEntity({ id: ENTITY_ID, notePath: NOTE_PATH });
    await syncState.setMirrorItem(PROJECT, 'gh-main', HANDLE, {
      entityId: ENTITY_ID,
    });

    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(
      new CanonicalTask({
        handle: HANDLE,
        entityId: ENTITY_ID,
        title: 'Task',
        body: '',
        status: 'Building',
        completed: false,
        parent: null,
        labels: [],
      }),
    );
    const registered: RegisteredAdapter = registerAdapters([
      new AdapterRegistration(conformanceDescriptor('github'), mirror),
    ]).adapters.get('github')!;
    const mirrorAdapters: MirrorAdapterFactoryPort = {
      create: () => registered,
    };

    const action = new AssembleProjectPassAction(
      notes,
      syncState,
      mirrorAdapters,
    );

    await action.invoke(PROJECT);

    expect(mirror.currentTask(HANDLE)?.status).toBe('Done');
    expect(mirror.currentTask(NOTE_PATH)).toBeNull();
    expect(notes.observedHandles).toContain(NOTE_PATH);
  });
});
