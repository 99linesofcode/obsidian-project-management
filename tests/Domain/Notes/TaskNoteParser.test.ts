import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../../../src/Domain/Notes/TaskNoteParser.js';

const task = {
  type: 'task',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  createdAt: null,
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

describe('TaskNoteParser', () => {
  it('round-trips a mapped note back to type, status and body', () => {
    // Given — a note produced by the mapper
    const { content } = TaskNoteMapper.map(task, context);

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the content fields are preserved; no machine id is surfaced
    expect(parsed).toEqual({
      type: 'task',
      status: 'Building',
      body: task.body,
      affiliation: ['[[Acme Widgets]]'],
    });
  });

  it('ignores a legacy url and id without requiring one', () => {
    // Given — a note with legacy id and url fields
    const content = [
      '---',
      'id: uuid-42',
      'url: https://github.com/acme/widgets/issues/42',
      'status: Building',
      '---',
      'Body.',
    ].join('\n');

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the legacy fields are not surfaced (dt-20) but the note parses
    expect(parsed?.status).toBe('Building');
    expect(parsed?.body).toBe('Body.');
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('url');
  });

  it('parses a note with frontmatter but no machine id', () => {
    // Given — a new-style note carrying no id or url
    const content = ['---', 'status: open', '---', 'Body.'].join('\n');

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — it is recognised: a task note needs no machine id
    expect(parsed?.status).toBe('open');
    expect(parsed?.body).toBe('Body.');
  });

  it('round-trips a lane name with spaces verbatim', () => {
    // Given — a note whose card sits in a multi-word lane
    const { content } = TaskNoteMapper.map(task, {
      ...context,
      statusName: 'Shipped',
    });

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the status is the lane name verbatim
    expect(parsed?.status).toBe('Shipped');
  });

  it('returns null for content without frontmatter', () => {
    // Given — a plain note with no frontmatter
    const content = 'Just a note.';

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — it is not recognised as a task note
    expect(parsed).toBeNull();
  });
});
