import { describe, expect, it } from 'vitest';
import { projectNoteFromCache } from '../../../src/Infrastructure/Obsidian/projectNoteFromCache.js';

// The pure mapping from a markdown file's path + frontmatter cache to a
// project note. This is the filtering logic VaultAdapter.findProjectNotes
// delegates to; it is unit-tested here because the metadataCache itself is
// awkward to fake (the adapter's other methods are covered in the
// integration pass).
describe('projectNoteFromCache', () => {
  it('maps an active note under Projecten to a project note', () => {
    // Given — a project home note whose frontmatter declares pm: github
    const path = 'Projecten/Acme Widgets/_home.md';
    const frontmatter = {
      pm: 'github',
      url: 'https://github.com/acme/widgets',
      board: 'https://github.com/orgs/acme/projects/1',
    };

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, frontmatter);

    // Then — the project name is derived from the path and the urls carried
    expect(note).toEqual({
      path,
      projectName: 'Acme Widgets',
      archived: false,
      pm: 'github',
      url: 'https://github.com/acme/widgets',
      board: 'https://github.com/orgs/acme/projects/1',
    });
  });

  it('maps an archived note under Archief to an archived project note', () => {
    // Given — a project home note that has been moved to the archive
    const path = 'Archief/Acme Widgets/_home.md';
    const frontmatter = { pm: 'github' };

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, frontmatter);

    // Then — the project name is the folder segment and the note is archived
    expect(note).toEqual({
      path,
      projectName: 'Acme Widgets',
      archived: true,
      pm: 'github',
      url: '',
      board: '',
    });
  });

  it('returns null for a pm note outside Projecten and Archief', () => {
    // Given — a pm note that lives somewhere else entirely
    const path = 'Notes/Acme Widgets/_home.md';
    const frontmatter = { pm: 'github' };

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, frontmatter);

    // Then — it is not a project note (no empty-name project is discovered)
    expect(note).toBeNull();
  });

  it('returns null for a note without a pm property', () => {
    // Given — a note whose frontmatter has no pm property
    const path = 'Projecten/Acme Widgets/_home.md';
    const frontmatter = { tags: ['project'] };

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, frontmatter);

    // Then — it is not a project note
    expect(note).toBeNull();
  });

  it('returns null when there is no frontmatter at all', () => {
    // Given — a note with no frontmatter cache
    const path = 'Projecten/Acme Widgets/_home.md';

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, undefined);

    // Then — it is not a project note
    expect(note).toBeNull();
  });

  it('derives the project name from the Projecten/<project> path', () => {
    // Given — a project home note nested under a project folder
    const path = 'Projecten/Other Project/_home.md';
    const frontmatter = { pm: 'github' };

    // When — the cache entry is mapped
    const note = projectNoteFromCache(path, frontmatter);

    // Then — the project name is the folder segment
    expect(note?.projectName).toBe('Other Project');
  });
});
