import { describe, expect, it } from 'vitest';
import { AssembleProjectPassAction } from '../../src/core/AssembleProjectPassAction.js';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { OriginObservation } from '../../src/core/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { OriginPort } from '../../src/core/ports/OriginPort.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';
import { CoreBaselineStoreAdapter } from '../../src/infrastructure/registry/CoreBaselineStoreAdapter.js';
import { RegistryMirrorHandleAdapter } from '../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';
import { VaultProjectSourceAdapter } from '../../src/infrastructure/vault/VaultProjectSourceAdapter.js';
import { SyncStateAdapter } from '../../src/registry/SyncStateAdapter.js';

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

class FakeNotes {
  private readonly notes = new Map<string, string>();

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
}

class RecordingOrigin implements OriginPort {
  readonly observedHandles: string[] = [];

  async observe(handle: string, field: string): Promise<OriginObservation> {
    this.observedHandles.push(handle);
    return new OriginObservation({
      current: originValue(field),
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  async applyField(): Promise<void> {}

  async trash(): Promise<void> {}
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
    const projectSource = new VaultProjectSourceAdapter(notes);

    const syncState = new SyncStateAdapter(memoryStorage().storage);
    await syncState.setEntity({ id: ENTITY_ID, notePath: NOTE_PATH });
    await syncState.setMirrorItem(PROJECT, 'gh-main', HANDLE, {
      entityId: ENTITY_ID,
      base: null,
    });
    const handles = new RegistryMirrorHandleAdapter(syncState);

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

    const origin = new RecordingOrigin();
    const action = new AssembleProjectPassAction(
      projectSource,
      origin,
      new CoreBaselineStoreAdapter(memoryStorage().storage),
      handles,
      mirrorAdapters,
    );

    await action.invoke(PROJECT);

    expect(mirror.currentTask(HANDLE)?.status).toBe('Done');
    expect(mirror.currentTask(NOTE_PATH)).toBeNull();
    expect(origin.observedHandles).toContain(NOTE_PATH);
  });
});
