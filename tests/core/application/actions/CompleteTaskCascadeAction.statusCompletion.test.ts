import { describe, expect, it } from 'vitest';
import { CompleteTaskCascadeAction } from '../../../../src/core/application/actions/CompleteTaskCascadeAction.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import type { RegistryPort } from '../../../../src/core/port/RegistryPort.js';
import type { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import {
  parseTaskNote,
  writeIntoNote,
} from '../../../../src/infrastructure/vault/taskNoteCodec.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// ST-1/ST-2 — the state ↔ completion edge.
//
// Seam: the vault-side cascade, because ST-2's write lives there and the edge
// needs the *previous* state — the state as of the last reconciled pass — which
// only the registry's per-field baseline holds. A pure vault-port unit test
// cannot see that baseline, so this suite wires the real cascade with a fake
// registry (FakeSyncState) carrying a Status baseline, read with
// `registry.readBaseline(notePath, 'Status', 'origin')`. The cascade runs in
// SyncProjectAction.vaultConsistency *before* the field merge, which is why that
// baseline still holds the previous state when the cascade runs.
//
// The action does not yet accept a registry; the construction cast below names
// the dependency ST-2 requires, so the suite fails on the missing write (an
// assertion), not on the extra argument (a syntax/type error).
type CascadeConstructor = new (
  vault: ConstructorParameters<typeof CompleteTaskCascadeAction>[0],
  doneOptionName: string,
  registry: RegistryPort,
) => CompleteTaskCascadeAction;

// Fakes at the vault port: a path-keyed note store recording every write, so
// the completion field the rule writes (or leaves) is observable. applyField is
// wired through the real task-note codec so either write path is honoured.
class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }
  override async applyField(write: CanonicalFieldWrite): Promise<void> {
    const content = this.notes.get(write.handle);
    if (content === undefined) {
      return;
    }
    await this.writeNote(write.handle, writeIntoNote(content, write));
  }
  override async createNote(): Promise<void> {}
  override async renameNote(): Promise<void> {}
  override async trashNote(): Promise<void> {}
  override async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

const projectName = 'Acme Widgets';
const doneLane = 'Shipped';
const openLane = 'Building';
const syncedAt = '2026-09-18T12:00:00Z';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

function taskNote(
  status: string,
  options: { completed?: boolean; body?: string } = {},
): string {
  const lines = [
    '---',
    `status: ${status}`,
    `affiliation: ["[[${projectName}]]"]`,
    `synced: ${syncedAt}`,
  ];
  if (options.completed === true) {
    lines.push('completed: true');
  }
  lines.push('---', options.body ?? '');
  return lines.join('\n');
}

function makeAction(
  vault: FakeVault,
  registry: FakeSyncState,
): CompleteTaskCascadeAction {
  const Ctor = CompleteTaskCascadeAction as unknown as CascadeConstructor;
  return new Ctor(vault, doneLane, registry);
}

async function seedBaseline(
  registry: FakeSyncState,
  previousState: string,
): Promise<void> {
  await registry.writeBaseline(
    taskPath,
    'Status',
    'origin',
    new Baseline(previousState, false),
  );
}

const input = { notePath: taskPath, projectName, syncedAt };

function completionOf(vault: FakeVault): boolean {
  return parseTaskNote(vault.notes.get(taskPath)!, taskPath).completed;
}

describe('ST-1, ST-2 — the state drives completion, edge-triggered', () => {
  it('writes the note’s own completed field when the state enters the done option (ST-2)', async () => {
    const vault = new FakeVault();
    const registry = new FakeSyncState();
    await seedBaseline(registry, openLane);
    vault.notes.set(taskPath, taskNote(doneLane));
    const action = makeAction(vault, registry);

    await action.execute(input);

    expect(completionOf(vault)).toBe(true);
    // ST-1 — the rule sets completion; it never moves the state.
    expect(parseTaskNote(vault.notes.get(taskPath)!, taskPath).status).toBe(
      doneLane,
    );
  });

  it('removes the note’s completed field when the state leaves the done option (ST-2)', async () => {
    const vault = new FakeVault();
    const registry = new FakeSyncState();
    await seedBaseline(registry, doneLane);
    vault.notes.set(taskPath, taskNote(openLane, { completed: true }));
    const action = makeAction(vault, registry);

    await action.execute(input);

    expect(completionOf(vault)).toBe(false);
    // ST-1 — the state is independent: leaving the done option clears
    // completion, it does not re-open the issue (the state is already open).
    expect(parseTaskNote(vault.notes.get(taskPath)!, taskPath).status).toBe(
      openLane,
    );
  });

  it('leaves completion alone when the state never was the done option (ST-1, ST-2)', async () => {
    const vault = new FakeVault();
    const registry = new FakeSyncState();
    await seedBaseline(registry, openLane);
    // A remote close (a merged pull request closing the issue) set completion
    // through the ordinary field merge; the state is not the done option.
    vault.notes.set(taskPath, taskNote(openLane, { completed: true }));
    const action = makeAction(vault, registry);

    await action.execute(input);

    expect(completionOf(vault)).toBe(true);
    expect(parseTaskNote(vault.notes.get(taskPath)!, taskPath).status).toBe(
      openLane,
    );
  });

  it('writes nothing on a second pass with no state change (ST-2, I14)', async () => {
    const vault = new FakeVault();
    const registry = new FakeSyncState();
    await seedBaseline(registry, doneLane);
    vault.notes.set(taskPath, taskNote(doneLane, { completed: true }));
    const action = makeAction(vault, registry);

    await action.execute(input);
    vault.written = [];
    await action.execute(input);

    expect(vault.written).toEqual([]);
  });
});
