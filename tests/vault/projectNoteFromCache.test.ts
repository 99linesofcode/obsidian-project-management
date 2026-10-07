import { describe, expect, it } from 'vitest';
import { projectNoteFromCache } from '../../src/vault/projectNoteFromCache.js';

const github = { tool: 'github', project: 'https://github.com/acme/widgets' };

describe('DISC-1 — the project note is read from the cache', () => {
  it('maps a note declaring a non-empty connections map to a project note keyed by its folder', () => {
    const active = projectNoteFromCache('Projecten/Acme Widgets/_home.md', {
      connections: {
        github,
        todoist: { tool: 'todoist', project: 'P1' },
      },
    });
    expect(active).toEqual({
      path: 'Projecten/Acme Widgets/_home.md',
      projectName: 'Acme Widgets',
      archivedAt: null,
      connections: {
        github,
        todoist: { tool: 'todoist', project: 'P1' },
      },
      connectionErrors: [],
    });

    const archived = projectNoteFromCache('Archief/Acme Widgets/_home.md', {
      connections: { github },
    });
    expect(archived).toEqual({
      path: 'Archief/Acme Widgets/_home.md',
      projectName: 'Acme Widgets',
      archivedAt: '',
      connections: { github },
      connectionErrors: [],
    });
  });

  it('returns null for a note that is not a project home or declares no connections', () => {
    const cases: Array<[string, Record<string, unknown> | undefined]> = [
      ['Notes/Acme Widgets/_home.md', { connections: { github } }],
      ['Projecten/Acme Widgets/_home.md', { tags: ['project'] }],
      ['Projecten/Acme Widgets/_home.md', undefined],
      ['Projecten/Acme Widgets/_home.md', { connections: {} }],
      ['Projecten/Acme Widgets/_home.md', { connections: 'nope' }],
      ['Projecten/Acme Widgets/sub/note.md', { connections: { github } }],
      ['Projecten/loose.md', { connections: { github } }],
      // A note carrying only the legacy properties is not a project note until
      // the migration rewrites it.
      [
        'Projecten/Acme Widgets/_home.md',
        { pm: 'github', url: 'https://github.com/acme/widgets' },
      ],
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
        projectNoteFromCache(path, { connections: { github } })?.projectName,
        path,
      ).toBe(projectName);
    }
  });

  it('drops invalid entries with a collected error', () => {
    const note = projectNoteFromCache('Projecten/Acme Widgets/_home.md', {
      connections: {
        'Bad Slug': { tool: 'github', project: 'x' },
        work: { tool: 'linear', project: 'x' },
        empty: { tool: 'todoist', project: '' },
        good: github,
      },
    });

    expect(note?.connections).toEqual({ good: github });
    expect(note?.connectionErrors).toHaveLength(3);
  });

  it('accepts two connections of the same tool under distinct slugs', () => {
    const note = projectNoteFromCache('Projecten/Acme Widgets/_home.md', {
      connections: {
        'todoist-work': { tool: 'todoist', project: 'P-work' },
        'todoist-personal': { tool: 'todoist', project: 'P-personal' },
      },
    });

    expect(note?.connections).toEqual({
      'todoist-work': { tool: 'todoist', project: 'P-work' },
      'todoist-personal': { tool: 'todoist', project: 'P-personal' },
    });
    expect(note?.connectionErrors).toHaveLength(0);
  });

  it('rejects a slug that does not start alphanumeric', () => {
    const note = projectNoteFromCache('Projecten/Acme Widgets/_home.md', {
      connections: {
        '-work': { tool: 'todoist', project: 'P-work' },
        good: github,
      },
    });

    expect(note?.connections).toEqual({ good: github });
    expect(note?.connectionErrors).toHaveLength(1);
  });
});
