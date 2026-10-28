import { describe, expect, it } from 'vitest';
import { RenameProjectAction } from '../../../../src/core/application/actions/RenameProjectAction.js';
import { splitFrontmatter } from '../../../../src/core/domain/note.js';
import type { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { portState } from '../../../helpers/records.js';

const github: ConnectionDataTransferObject = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  renames: Array<{ from: string; to: string }> = [];
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
  override async renameNote(from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
    const content = this.notes.get(from);
    if (content !== undefined) {
      this.notes.delete(from);
      this.notes.set(to, content);
    }
  }
  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new RenameProjectAction(vault, syncState);
  return { action, vault, syncState };
}

function homeNote(name: string | null): string {
  const lines = ['---'];
  if (name !== null) {
    lines.push(`name: ${name}`);
  }
  lines.push(
    'connections:',
    '  github:',
    '    tool: github',
    '    project: https://github.com/acme/widgets',
    '---',
    '',
  );
  return lines.join('\n');
}

// PLC-3 / NAME-2 — the rename authority. The `name:` property wins; when the
// folder disagrees with it the folder is renamed back to match the property,
// and the property is never rewritten to the folder.
describe('PLC-3 — the folder is corrected to the declared `name`', () => {
  it('renames the folder back to `name` and never rewrites the property', async () => {
    const h = harness();
    const path = 'Projecten/Beta/_Acme.md';
    h.vault.notes.set(path, homeNote('Acme'));
    await h.syncState.setPortState(
      'Acme',
      'github',
      portState({
        provider: 'github',
        project: 'https://github.com/acme/widgets',
      }),
    );

    const warnings = await h.action.execute({
      projectName: 'Acme',
      notePath: path,
      locationArchived: false,
      connections: [github],
    });

    expect(h.vault.renames).toContainEqual({
      from: path,
      to: 'Projecten/Acme/_Acme.md',
    });
    expect(h.vault.writes.find((write) => write.path === path)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

// PLC-4 (changed) — a project note with no `name:` adopts the folder segment as
// its value, once. The adopted key is `name:`, not the retired `project:`.
describe('PLC-4 — a note with no `name` adopts the folder segment into `name`', () => {
  it('writes the folder segment into `name`', async () => {
    const h = harness();
    const path = 'Projecten/Acme Widgets/_Acme Widgets.md';
    h.vault.notes.set(path, homeNote(null));

    await h.action.execute({
      projectName: 'Acme Widgets',
      notePath: path,
      locationArchived: false,
      connections: [github],
    });

    const adoption = h.vault.writes.find((write) => write.path === path);
    expect(adoption).toBeDefined();
    expect(splitFrontmatter(adoption?.content ?? '')?.fields.get('name')).toBe(
      'Acme Widgets',
    );
  });
});
