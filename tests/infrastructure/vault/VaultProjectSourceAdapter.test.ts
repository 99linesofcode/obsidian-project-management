import { describe, expect, it } from 'vitest';
import { VaultProjectSourceAdapter } from '../../../src/infrastructure/vault/VaultProjectSourceAdapter.js';

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

const HOME = [
  '---',
  'type: project',
  'connections:',
  '  conformance:',
  '    tool: conformance',
  '    project: board-1',
  '  second:',
  '    tool: conformance',
  '    project: board-2',
  '---',
].join('\n');

describe('VaultProjectSourceAdapter — the project source', () => {
  it('reads the declared connections as application/target envelopes', async () => {
    const notes = new FakeNotes();
    notes.seed('Projecten/Acme/_Acme.md', HOME);
    const source = new VaultProjectSourceAdapter(notes);

    const connections = await source.readConnections('Acme');

    expect(connections).toEqual([
      { application: 'conformance', target: 'board-1' },
      { application: 'conformance', target: 'board-2' },
    ]);
  });

  it('returns no connections when the project note is absent', async () => {
    const source = new VaultProjectSourceAdapter(new FakeNotes());

    expect(await source.readConnections('Missing')).toEqual([]);
  });

  it('enumerates the project task notes', async () => {
    const notes = new FakeNotes();
    notes.seed('Projecten/Acme/taken/fix.md', '');
    notes.seed('Projecten/Acme/taken/ship.md', '');
    notes.seed('Projecten/Acme/todos/other.md', '');
    const source = new VaultProjectSourceAdapter(notes);

    expect(await source.listEntities('Acme')).toEqual([
      'Projecten/Acme/taken/fix.md',
      'Projecten/Acme/taken/ship.md',
    ]);
  });
});
