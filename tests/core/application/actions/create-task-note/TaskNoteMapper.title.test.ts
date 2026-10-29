import { describe, expect, it, vi } from 'vitest';
import { TaskNoteMapper } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';
import type { TaskNoteSource } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';

// FN-1 — the renderer. The task note's filename is the title, verbatim, with
// each illegal character replaced by a single space and runs of whitespace
// collapsed. Nothing else changes: no lowercasing, no dash-joining, no prefix.
// A colon becomes a space, not a dash. MAT-5 — the note shape loses `name:`.

const base: Omit<TaskNoteSource, 'title'> = {
  type: 'task',
  body: 'Body text.',
  createdAt: null,
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

function pathFor(title: string): string {
  return TaskNoteMapper.map({ ...base, title }, context).path;
}

describe('FN-1 — the task note filename is the rendered title', () => {
  it('renders a colon as a space, never a dash', () => {
    expect(pathFor('fix: a to-do twin')).toBe(
      'Projecten/Acme Widgets/taken/fix a to-do twin.md',
    );
  });

  it('preserves case', () => {
    expect(pathFor('Fix the Bug')).toBe(
      'Projecten/Acme Widgets/taken/Fix the Bug.md',
    );
  });

  it('introduces no dashes', () => {
    expect(pathFor('fix a to-do twin')).toBe(
      'Projecten/Acme Widgets/taken/fix a to-do twin.md',
    );
  });

  it('adds no prefix and strips no prefix', () => {
    expect(pathFor('fix the bug')).toBe(
      'Projecten/Acme Widgets/taken/fix the bug.md',
    );
    expect(pathFor('61-fix the bug')).toBe(
      'Projecten/Acme Widgets/taken/61-fix the bug.md',
    );
  });

  it.each(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])(
    'renders the illegal character %s as a single space',
    (character) => {
      expect(pathFor(`a${character}b`)).toBe(
        'Projecten/Acme Widgets/taken/a b.md',
      );
    },
  );

  it('collapses runs of whitespace and illegal characters to one space', () => {
    expect(pathFor('a<>  : b')).toBe('Projecten/Acme Widgets/taken/a b.md');
  });

  it('keeps two titles that differ only in case distinct', () => {
    expect(pathFor('Fix the Bug')).not.toBe(pathFor('fix the bug'));
  });
});

describe('FN-1 — an unrenderable title is refused with an error naming it', () => {
  it.each([
    ['an empty title', ''],
    ['a title that renders empty', ':'],
    ['a single dot', '.'],
    ['two dots', '..'],
    ['all dots', '...'],
    ['a title ending in a dot', 'Fix the bug.'],
    ['a title ending in a space', 'Fix the bug '],
  ])('refuses %s', (_label, title) => {
    expect(() => pathFor(title)).toThrow();
  });

  it('names the title in the refusal', () => {
    for (const title of ['...', 'Fix the bug.', 'Fix the bug ']) {
      expect(() => pathFor(title)).toThrow(title.trim());
    }
  });
});

describe('FN-1 — a title over 255 bytes truncates on a word boundary and is reported', () => {
  it('truncates at a word boundary and reports the truncation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const title = Array.from({ length: 60 }, () => 'word').join(' ');

    const stem = pathFor(title).replace(/^.*\//, '').replace(/\.md$/, '');

    expect(Buffer.byteLength(stem)).toBeLessThanOrEqual(255);
    expect(title.startsWith(stem)).toBe(true);
    expect(title[stem.length]).toBe(' ');
    expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);

    warn.mockRestore();
    error.mockRestore();
  });
});

describe('MAT-5 — a rendered task note carries no name: field', () => {
  it('writes no name: line on the built-in frontmatter', () => {
    const { content } = TaskNoteMapper.map(
      { ...base, title: 'Fix the Bug' },
      context,
    );

    expect(content).not.toMatch(/^name:/m);
  });
});
