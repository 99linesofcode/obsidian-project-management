import { describe, expect, it } from 'vitest';
import { MigrateNameAction } from '../../../../src/core/application/actions/MigrateNameAction.js';
import { splitFrontmatter } from '../../../../src/core/domain/note.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

// The one-shot `project:` → `name:` migration. The spec names no action, but
// describes it as "a core Action at the top of the per-project sync chain,
// writing the vault note only — the S14 legacy migration's shape". This suite
// mirrors the retired S14 `MigrateLabelsAction` test, whose action scanned
// `Projecten/<project>/` and rewrote each note in place. The action is
// `MigrateNameAction` by that precedent (`MigrateLabelsAction` → the new
// field's name). If the implementer chooses another name, this import is the
// seam to align — the behaviour below is what the spec pins.
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
  const action = new MigrateNameAction(vault);
  return { action, vault };
}

function note(fields: readonly string[]): string {
  return ['---', ...fields, '---', 'Body line.'].join('\n');
}

describe('NAME-1 / NAME-2 — the `project:` property migrates to `name:`', () => {
  it('gains `name:` with the same value and loses `project:`', async () => {
    const h = harness({ [home]: note(['project: Acme Widgets']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    const migrated = h.vault.notes.get(home) ?? '';
    expect(splitFrontmatter(migrated)?.fields.get('name')).toBe('Acme Widgets');
    expect(splitFrontmatter(migrated)?.fields.has('project')).toBe(false);
    expect(splitFrontmatter(migrated)?.body).toBe('Body line.');
  });

  it('keeps an existing `name:` and drops `project:` when a note carries both', async () => {
    const h = harness({
      [home]: note(['name: Acme Widgets', 'project: Old Name']),
    });

    await h.action.execute({ projectName: 'Acme Widgets' });

    const migrated = h.vault.notes.get(home) ?? '';
    expect(splitFrontmatter(migrated)?.fields.get('name')).toBe('Acme Widgets');
    expect(splitFrontmatter(migrated)?.fields.has('project')).toBe(false);
  });

  it('leaves a note that already carries `name:` alone', async () => {
    const h = harness({ [home]: note(['name: Acme Widgets']) });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes).toEqual([]);
    expect(h.vault.notes.get(home)).toBe(note(['name: Acme Widgets']));
  });

  it('migrates every note in the project, the home note and taken/', async () => {
    const h = harness({
      [home]: note(['project: Acme Widgets']),
      [taken]: note(['project: Acme Widgets']),
    });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(
      splitFrontmatter(h.vault.notes.get(home) ?? '')?.fields.get('name'),
    ).toBe('Acme Widgets');
    expect(
      splitFrontmatter(h.vault.notes.get(taken) ?? '')?.fields.get('name'),
    ).toBe('Acme Widgets');
    expect(h.vault.writes).toHaveLength(2);
  });
});

describe('NAME-2 — the migration is a top-level scan', () => {
  it('does not migrate a nested connection `project:` and touches nothing', async () => {
    const connectionsOnly = note([
      'connections:',
      '  github:',
      '    tool: github',
      '    project: https://github.com/acme/widgets',
    ]);
    const h = harness({ [home]: connectionsOnly });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes).toEqual([]);
    expect(h.vault.notes.get(home)).toBe(connectionsOnly);
  });
});

describe('NAME-2 — the migration is idempotent', () => {
  it('writes nothing on a second pass', async () => {
    const h = harness({ [home]: note(['project: Acme Widgets']) });

    await h.action.execute({ projectName: 'Acme Widgets' });
    const afterFirstPass = h.vault.notes.get(home);
    const writesAfterFirstPass = h.vault.writes.length;

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.vault.writes.length).toBe(writesAfterFirstPass);
    expect(h.vault.notes.get(home)).toBe(afterFirstPass);
  });
});
