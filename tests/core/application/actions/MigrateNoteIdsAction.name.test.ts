import { describe, expect, it } from 'vitest';
import { MigrateNoteIdsAction } from '../../../../src/core/application/actions/MigrateNoteIdsAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// MAT-5 — every note loses the `name:` field. The id migration already rewrites
// a note's frontmatter, so a stray `name:` is removed in the same pass; there
// is no separate migration.

class FakeVault extends FakeVaultBase {
  readonly notes = new Map<string, string>();

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
}

const PROJECT = 'Acme';
const NOTE_PATH = `Projecten/${PROJECT}/taken/fix-the-bug.md`;
const WITH_NAME_NO_ID = [
  '---',
  'name: Fix the Bug',
  'labels: [type:task]',
  '---',
  'Body text',
].join('\n');
const WITH_NAME_AND_ID = [
  '---',
  'name: Fix the Bug',
  'labels: [type:task]',
  'connections:',
  '  vault:',
  '    tool: vault',
  '    id: existing-id',
  '---',
  'Body text',
].join('\n');

function harness(): { vault: FakeVault; action: MigrateNoteIdsAction } {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  return { vault, action: new MigrateNoteIdsAction(vault, syncState) };
}

describe('MAT-5 — the id migration removes a stray name: field', () => {
  it('drops name: from a note it stamps an id on', async () => {
    const h = harness();
    h.vault.notes.set(NOTE_PATH, WITH_NAME_NO_ID);

    await h.action.execute({ projectName: PROJECT });

    const migrated = h.vault.notes.get(NOTE_PATH) ?? '';
    expect(migrated).not.toMatch(/^name:/m);
    expect(migrated).toMatch(/^connections:/m);
  });

  it('drops name: from a note that already carries an id', async () => {
    const h = harness();
    h.vault.notes.set(NOTE_PATH, WITH_NAME_AND_ID);

    await h.action.execute({ projectName: PROJECT });

    expect(h.vault.notes.get(NOTE_PATH) ?? '').not.toMatch(/^name:/m);
  });
});
