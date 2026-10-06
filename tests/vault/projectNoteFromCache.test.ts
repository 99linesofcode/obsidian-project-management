import { describe, expect, it } from 'vitest';
import { projectNoteFromCache } from '../../src/vault/projectNoteFromCache.js';

describe('DISC-1 — the project note is read from the cache', () => {
  it('maps an active or archived note to a project note keyed by its folder', () => {
    const active = projectNoteFromCache('Projecten/Acme Widgets/_home.md', {
      pm: 'github',
      url: 'https://github.com/acme/widgets',
      board: 'https://github.com/orgs/acme/projects/1',
    });
    expect(active).toEqual({
      path: 'Projecten/Acme Widgets/_home.md',
      projectName: 'Acme Widgets',
      archivedAt: null,
      pm: 'github',
      url: 'https://github.com/acme/widgets',
      board: 'https://github.com/orgs/acme/projects/1',
    });

    const archived = projectNoteFromCache('Archief/Acme Widgets/_home.md', {
      pm: 'github',
    });
    expect(archived).toEqual({
      path: 'Archief/Acme Widgets/_home.md',
      projectName: 'Acme Widgets',
      archivedAt: '',
      pm: 'github',
      url: '',
      board: '',
    });
  });

  it('returns null for a note that is not a project home', () => {
    const cases: Array<[string, Record<string, unknown> | undefined]> = [
      ['Notes/Acme Widgets/_home.md', { pm: 'github' }],
      ['Projecten/Acme Widgets/_home.md', { tags: ['project'] }],
      ['Projecten/Acme Widgets/_home.md', undefined],
      ['Projecten/Acme Widgets/sub/note.md', { pm: 'github' }],
      ['Projecten/loose.md', { pm: 'github' }],
    ];
    for (const [path, frontmatter] of cases) {
      expect(projectNoteFromCache(path, frontmatter), path).toBeNull();
    }
  });

  it('accepts every home-note convention and derives the name from the folder', () => {
    const cases: Array<[string, string]> = [
      ['Projecten/Acme Widgets/_home.md', 'Acme Widgets'],
      ['Projecten/Acme Widgets/_Acme Widgets.md', 'Acme Widgets'],
      ['Projecten/Acme Widgets/Acme Widgets.md', 'Acme Widgets'],
      ['Projecten/New Name/Old Name.md', 'New Name'],
      ['Projecten/Other Project/_home.md', 'Other Project'],
    ];
    for (const [path, projectName] of cases) {
      expect(
        projectNoteFromCache(path, { pm: 'github' })?.projectName,
        path,
      ).toBe(projectName);
    }
  });
});
