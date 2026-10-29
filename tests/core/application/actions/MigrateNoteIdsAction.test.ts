import { describe, expect, it } from 'vitest';
import { MigrateNoteIdsAction } from '../../../../src/core/application/actions/MigrateNoteIdsAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../helpers/records.js';

// MIG-1: a one-shot, idempotent pass stamps a minted id onto every note that
// lacks one — the home note included, because a project home note has no ledger
// record and would otherwise be unkeyable — and writes the per-mirror entries.
// The observable is idempotence: run twice, the second run writes nothing.
class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
}

function harness(notes: Record<string, string>) {
  const vault = new FakeVault();
  for (const [path, content] of Object.entries(notes)) {
    vault.notes.set(path, content);
  }
  const syncState = new FakeSyncState();
  const action = new MigrateNoteIdsAction(vault, syncState);
  return { action, vault, syncState };
}

function note(fields: readonly string[]): string {
  return ['---', ...fields, '---', 'Body line.'].join('\n');
}

function stampedId(content: string): string | null {
  const match = /connections:[\s\S]*?\bvault:[\s\S]*?\bid:\s*(\S+)/.exec(
    content,
  );
  return match?.[1] ?? null;
}

const home = 'Projecten/Acme Widgets/_Acme Widgets.md';
const taken = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

describe('MIG-1 — the id migration is a one-shot, idempotent pass', () => {
  it('stamps a minted id on every note that lacks one, the home note included', async () => {
    const h = harness({
      [home]: note(['name: Acme Widgets']),
      [taken]: note([
        'name: Fix the Bug',
        'connections:',
        '  github:',
        '    tool: github',
        '    id: I_kwDOABCD',
      ]),
    });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(stampedId(h.vault.notes.get(home) ?? '')).toBeTruthy();
    expect(stampedId(h.vault.notes.get(taken) ?? '')).toBeTruthy();
  });

  it('writes nothing on a second pass', async () => {
    const h = harness({
      [home]: note(['name: Acme Widgets']),
      [taken]: note(['name: Fix the Bug']),
    });

    await h.action.execute({ projectName: 'Acme Widgets' });
    const writesAfterFirstPass = h.vault.writes.length;
    const homeAfterFirstPass = h.vault.notes.get(home);
    const takenAfterFirstPass = h.vault.notes.get(taken);

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes.length).toBe(writesAfterFirstPass);
    expect(h.vault.notes.get(home)).toBe(homeAfterFirstPass);
    expect(h.vault.notes.get(taken)).toBe(takenAfterFirstPass);
  });

  it('re-keys a name-keyed project node to the home note id', async () => {
    const h = harness({
      [home]: note(['name: Acme Widgets']),
      [taken]: note(['name: Fix the Bug']),
    });
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: taken,
        projectId: 'Acme Widgets',
      }),
    );

    await h.action.execute({ projectName: 'Acme Widgets' });

    const homeId = stampedId(h.vault.notes.get(home) ?? '');
    expect(homeId).toBeTruthy();
    expect((await h.syncState.listEntities(homeId!)).map((r) => r.id)).toEqual([
      'entity-1',
    ]);
    expect(await h.syncState.listEntities(home)).toEqual([]);
  });

  it('stamps a note that holds a ledger record with that record id', async () => {
    const h = harness({
      [home]: note(['name: Acme Widgets']),
      [taken]: note(['name: Fix the Bug']),
    });
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: taken,
        projectId: 'Acme Widgets',
      }),
    );

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(stampedId(h.vault.notes.get(taken) ?? '')).toBe('entity-1');
  });

  it('keys the project to the home note, not a stray note at the project root', async () => {
    const stray = 'Projecten/Acme Widgets/AAA-stray.md';
    const h = harness({
      [stray]: note(['name: Stray']),
      [home]: note(['name: Acme Widgets']),
      [taken]: note(['name: Fix the Bug']),
    });
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: taken,
        projectId: 'Acme Widgets',
      }),
    );

    await h.action.execute({ projectName: 'Acme Widgets' });

    const homeId = stampedId(h.vault.notes.get(home) ?? '');
    const strayId = stampedId(h.vault.notes.get(stray) ?? '');
    expect(homeId).toBeTruthy();
    expect(strayId).toBeTruthy();
    expect(strayId).not.toBe(homeId);
    expect((await h.syncState.listEntities(homeId!)).map((r) => r.id)).toEqual([
      'entity-1',
    ]);
    expect(await h.syncState.listEntities(strayId!)).toEqual([]);
  });
});
