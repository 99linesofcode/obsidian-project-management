import { describe, expect, it } from 'vitest';
import { MigrateProjectHomeNoteAction } from '../../../src/domain/actions/MigrateProjectHomeNoteAction.js';
import type { NoteReaderPort } from '../../../src/domain/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../../../src/domain/ports/NoteWriterPort.js';

class FakeVault {
  notes = new Map<string, string>();
  renameCalls: Array<{ from: string; to: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    this.renameCalls.push({ from: oldPath, to: newPath });
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
  }
}

function harness() {
  const vault = new FakeVault();
  const action = new MigrateProjectHomeNoteAction(
    vault as unknown as NoteReaderPort & NoteWriterPort,
  );
  return { action, vault };
}

const canonical = 'Projecten/Acme Widgets/_Acme Widgets.md';

describe('DISC-2 — the home note is renamed to the convention once', () => {
  it('renames a _home.md note to the _<project>.md convention', async () => {
    const h = harness();
    const legacy = 'Projecten/Acme Widgets/_home.md';
    h.vault.notes.set(legacy, 'content');

    const result = await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: legacy,
      locationArchived: false,
    });

    expect(result).toBe(canonical);
    expect(h.vault.renameCalls).toEqual([{ from: legacy, to: canonical }]);
    expect(h.vault.notes.has(legacy)).toBe(false);
  });

  it('renames a legacy <name>.md note to the convention', async () => {
    const h = harness();
    const legacy = 'Projecten/Acme Widgets/Acme Widgets.md';
    h.vault.notes.set(legacy, 'content');

    await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: legacy,
      locationArchived: false,
    });

    expect(h.vault.renameCalls).toEqual([{ from: legacy, to: canonical }]);
  });

  it('skips the rename when the target already exists, without clobbering', async () => {
    const h = harness();
    const legacy = 'Projecten/Acme Widgets/_home.md';
    h.vault.notes.set(legacy, 'legacy');
    h.vault.notes.set(canonical, 'existing');

    const result = await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: legacy,
      locationArchived: false,
    });

    expect(result).toBe(legacy);
    expect(h.vault.renameCalls).toEqual([]);
    expect(h.vault.notes.get(canonical)).toBe('existing');
  });

  it('migrates an archived project under Archief/', async () => {
    const h = harness();
    const legacy = 'Archief/Acme Widgets/_home.md';
    const target = 'Archief/Acme Widgets/_Acme Widgets.md';
    h.vault.notes.set(legacy, 'content');

    const result = await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: legacy,
      locationArchived: true,
    });

    expect(result).toBe(target);
    expect(h.vault.renameCalls).toEqual([{ from: legacy, to: target }]);
  });

  it('leaves a folder-renamed note whose basename drifted alone', async () => {
    const h = harness();
    const legacy = 'Projecten/Acme Widgets/Old Name.md';
    h.vault.notes.set(legacy, 'content');

    const result = await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: legacy,
      locationArchived: false,
    });

    expect(result).toBe(legacy);
    expect(h.vault.renameCalls).toEqual([]);
  });
});
