import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
};

const context = { projectName: 'Acme Widgets', syncedAt: '2026-09-18T12:00:00Z' };

describe('TaskNoteMapper', () => {
  it('maps a task to a note path under the project taken folder', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(task, context);

    // Then — the path carries the project, remote id and title slug
    expect(path).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
  });

  it('writes the sync frontmatter and the body verbatim', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { content } = TaskNoteMapper.map(task, context);

    // Then — the frontmatter carries the sync fields and the body is verbatim
    expect(content).toBe(
      [
        '---',
        'categories: [taken]',
        'url: https://github.com/acme/widgets/issues/42',
        'status: open',
        'affiliation: ["[[Acme Widgets]]"]',
        'synced: 2026-09-18T12:00:00Z',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
  });

  it('maps a closed task to a done status', () => {
    // Given — a closed task
    const closed: TaskData = { ...task, state: 'closed' };

    // When — the note is mapped
    const { content } = TaskNoteMapper.map(closed, context);

    // Then — the frontmatter status is done
    expect(content).toContain('status: done');
  });

  it('sanitizes the title into a slug for the filename', () => {
    // Given — a title with characters that do not belong in a filename
    const messy: TaskData = { ...task, title: '  Fix the Bug!!!  ' };

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(messy, context);

    // Then — the slug is lowercased, trimmed and stripped of specials
    expect(path).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
  });

  it('produces the same path for the same task (idempotent)', () => {
    // Given — the same task mapped twice

    // When — both notes are mapped
    const first = TaskNoteMapper.map(task, context);
    const second = TaskNoteMapper.map(task, context);

    // Then — the paths are identical
    expect(second.path).toBe(first.path);
  });
});
