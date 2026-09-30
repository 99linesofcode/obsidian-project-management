import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../../../src/Domain/Notes/TaskNoteParser.js';

const task = {
  id: 'uuid-42',
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
  it('round-trips a mapped note back to id, type, status and body', () => {
    // Given — a note produced by the mapper
    const { content } = TaskNoteMapper.map(task, context);

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the vault-owned identity and the content are preserved
    expect(parsed).toEqual({
      id: 'uuid-42',
      type: 'task',
      url: '',
      status: 'Building',
      body: task.body,
      affiliation: ['[[Acme Widgets]]'],
    });
  });

  it('still reads a legacy url but does not require one', () => {
    // Given — a note with a legacy url and no vault-owned id
    const content = [
      '---',
      'url: https://github.com/acme/widgets/issues/42',
      'status: Building',
      '---',
      'Body.',
    ].join('\n');

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the legacy url is surfaced and the id defaults to ''
    expect(parsed?.url).toBe('https://github.com/acme/widgets/issues/42');
    expect(parsed?.id).toBe('');
  });

  it('parses a note with frontmatter but no url (identity is the id)', () => {
    // Given — a new-style note carrying no url
    const content = ['---', 'id: uuid-1', 'status: open', '---', 'Body.'].join(
      '\n',
    );

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — it is recognised: a task note no longer needs a url
    expect(parsed?.id).toBe('uuid-1');
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
