import { describe, expect, it } from 'vitest';
import { MigrateLabelsAction } from '../../../../src/core/application/actions/MigrateLabelsAction.js';
import {
  labelsFromNote,
  splitFrontmatter,
} from '../../../../src/core/domain/note.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

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

const home = 'Projecten/Acme Widgets/_Acme Widgets.md';
const taken = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

function harness(notes: Record<string, string>) {
  const vault = new FakeVault();
  for (const [path, content] of Object.entries(notes)) {
    vault.notes.set(path, content);
  }
  const action = new MigrateLabelsAction(vault);
  return { action, vault };
}

function note(fields: readonly string[]): string {
  return ['---', ...fields, '---', 'Body line.'].join('\n');
}

describe('MIG-1 — the legacy type scalar becomes a type label', () => {
  it('gains type:X in labels and loses the type scalar when the note has no labels', async () => {
    const h = harness({ [home]: note(['type: task']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    const migrated = h.vault.notes.get(home) ?? '';
    expect(labelsFromNote(migrated)).toEqual(['type:task']);
    expect(splitFrontmatter(migrated)?.fields.has('type')).toBe(false);
    expect(splitFrontmatter(migrated)?.body).toBe('Body line.');
  });

  it('appends the type label after existing non-type labels', async () => {
    const h = harness({ [home]: note(['type:bug', 'labels: [priority:high]']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(labelsFromNote(h.vault.notes.get(home) ?? '')).toEqual([
      'priority:high',
      'type:bug',
    ]);
  });

  it('keeps an existing type label without duplicating it and drops the scalar', async () => {
    const h = harness({ [home]: note(['type:bug', 'labels: [type:bug]']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    const migrated = h.vault.notes.get(home) ?? '';
    expect(labelsFromNote(migrated)).toEqual(['type:bug']);
    expect(splitFrontmatter(migrated)?.fields.has('type')).toBe(false);
  });

  it('trims a spaced scalar to the canonical type:task label', async () => {
    const h = harness({ [home]: note(['type:   task']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(labelsFromNote(h.vault.notes.get(home) ?? '')).toEqual(['type:task']);
  });

  it('migrates every note in the project, the home note and taken/', async () => {
    const h = harness({
      [home]: note(['type: task']),
      [taken]: note(['type: bug']),
    });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(labelsFromNote(h.vault.notes.get(home) ?? '')).toEqual(['type:task']);
    expect(labelsFromNote(h.vault.notes.get(taken) ?? '')).toEqual(['type:bug']);
  });
});

describe('MIG-2 — the migration is idempotent', () => {
  it('leaves a migrated note untouched and writes nothing on a second pass', async () => {
    const h = harness({ [home]: note(['type: task']) });

    await h.action.execute({ projectName: 'Acme Widgets' });
    const afterFirstPass = h.vault.notes.get(home);
    const writesAfterFirstPass = h.vault.writes.length;

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes.length).toBe(writesAfterFirstPass);
    expect(h.vault.notes.get(home)).toBe(afterFirstPass);
  });
});

describe('MIG-3 — the migration writes the vault note only', () => {
  it('rewrites the vault note and reaches no mirror', async () => {
    const h = harness({ [home]: note(['type: task']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes).toHaveLength(1);
    expect(h.vault.writes[0]?.path).toBe(home);
  });
});
