import { describe, expect, it } from 'vitest';
import { MigrateProjectConnectionsAction } from '../../src/projects/MigrateProjectConnectionsAction.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';

// A fake vault with a path→content map, so the migration's read/rewrite is
// observable: writes are recorded and the map is updated in place, which makes
// idempotence (a second run writes nothing) directly assertable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.notes.set(path, content);
  }
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
  async createNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async modifiedTime(): Promise<string | null> {
    return null;
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return [];
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

// The exact legacy shape of the real OPM project note.
const OPM_NOTE = [
  '---',
  'pm: github',
  'url: https://github.com/99linesofcode/obsidian-project-management',
  'board: https://github.com/users/99linesofcode/projects/12',
  'todoist: 6hcfQgmhq95cH2x9',
  '---',
  '',
  '# Obsidian Project Management',
  '',
].join('\n');

const OPM_MIGRATED = [
  '---',
  'connections:',
  '  github:',
  '    tool: github',
  '    project: https://github.com/99linesofcode/obsidian-project-management',
  '  todoist:',
  '    tool: todoist',
  '    project: 6hcfQgmhq95cH2x9',
  '---',
  '',
  '# Obsidian Project Management',
  '',
].join('\n');

const OPM_PATH = 'Projecten/Obsidian Project Management/_Obsidian Project Management.md';

function setup(notes: Array<[string, string]>): {
  action: MigrateProjectConnectionsAction;
  vault: FakeVault;
} {
  const vault = new FakeVault();
  for (const [path, content] of notes) {
    vault.notes.set(path, content);
  }
  return { action: new MigrateProjectConnectionsAction(vault), vault };
}

describe('MIG-1 — the legacy frontmatter migrates to the connection envelope', () => {
  it('converts the real OPM note to exactly the github + todoist connections and strips all four', async () => {
    const { action, vault } = setup([[OPM_PATH, OPM_NOTE]]);

    await action.execute();

    expect(vault.writes).toEqual([{ path: OPM_PATH, content: OPM_MIGRATED }]);
  });

  it('is idempotent: a second run is a no-op', async () => {
    const { action, vault } = setup([[OPM_PATH, OPM_NOTE]]);
    await action.execute();
    vault.writes = [];

    await action.execute();

    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(OPM_PATH)).toBe(OPM_MIGRATED);
  });

  it('migrates an archived project note under Archief/', async () => {
    const path = 'Archief/Obsidian Project Management/_Obsidian Project Management.md';
    const { action, vault } = setup([[path, OPM_NOTE]]);

    await action.execute();

    expect(vault.writes).toEqual([{ path, content: OPM_MIGRATED }]);
  });

  it('is idempotent for an archived project note', async () => {
    const path = 'Archief/Obsidian Project Management/_Obsidian Project Management.md';
    const { action, vault } = setup([[path, OPM_NOTE]]);
    await action.execute();
    vault.writes = [];

    await action.execute();

    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(path)).toBe(OPM_MIGRATED);
  });

  it('normalizes a partial state: legacy stripped, existing connections preserved, missing entries added', async () => {
    const partial = [
      '---',
      'pm: github',
      'url: https://github.com/acme/widgets',
      'connections:',
      '  work:',
      '    tool: todoist',
      '    project: P9',
      '---',
      '',
    ].join('\n');
    const { action, vault } = setup([['Projecten/Acme/_Acme.md', partial]]);

    await action.execute();

    expect(vault.notes.get('Projecten/Acme/_Acme.md')).toBe(
      [
        '---',
        'connections:',
        '  work:',
        '    tool: todoist',
        '    project: P9',
        '  github:',
        '    tool: github',
        '    project: https://github.com/acme/widgets',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('replaces a bare connections key rather than duplicating it', async () => {
    const bare = [
      '---',
      'connections:',
      'url: https://github.com/acme/widgets',
      '---',
      '',
    ].join('\n');
    const { action, vault } = setup([['Projecten/Acme/_Acme.md', bare]]);

    await action.execute();

    expect(vault.notes.get('Projecten/Acme/_Acme.md')).toBe(
      [
        '---',
        'connections:',
        '  github:',
        '    tool: github',
        '    project: https://github.com/acme/widgets',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('leaves a note without legacy properties untouched', async () => {
    const migrated = [
      '---',
      'connections:',
      '  github:',
      '    tool: github',
      '    project: https://github.com/acme/widgets',
      '---',
      '',
    ].join('\n');
    const { action, vault } = setup([['Projecten/Acme/_Acme.md', migrated]]);

    await action.execute();

    expect(vault.writes).toEqual([]);
  });

  it('leaves a task note carrying only the legacy url untouched', async () => {
    const task = ['---', 'url: https://github.com/acme/widgets/issues/1', '---', ''].join(
      '\n',
    );
    const { action, vault } = setup([
      ['Projecten/Acme/taken/1-fix.md', task],
    ]);

    await action.execute();

    expect(vault.writes).toEqual([]);
  });

  it('strips a pm-only note to an empty connections map', async () => {
    const pmOnly = ['---', 'pm: github', '---', ''].join('\n');
    const { action, vault } = setup([['Projecten/Acme/_Acme.md', pmOnly]]);

    await action.execute();

    expect(vault.notes.get('Projecten/Acme/_Acme.md')).toBe(
      ['---', 'connections:', '---', ''].join('\n'),
    );
  });
});
