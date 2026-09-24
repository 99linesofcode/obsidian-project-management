import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../../../src/Domain/Notes/TaskNoteParser.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: [],
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

describe('TaskNoteParser', () => {
  it('round-trips a mapped note back to url, status and body', () => {
    // Given — a note produced by the mapper
    const { content } = TaskNoteMapper.map(task, context);

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — url, status, body and affiliation are preserved
    expect(parsed).toEqual({
      url: task.url,
      status: 'Building',
      body: task.body,
      affiliation: ['[[Acme Widgets]]'],
    });
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

  it('returns null for content with frontmatter but no url', () => {
    // Given — a note that is not a synced artifact (no url frontmatter)
    const content = ['---', 'categories: [taken]', '---', 'Some body.'].join(
      '\n',
    );

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — it is not recognised as a synced task note
    expect(parsed).toBeNull();
  });

  it('returns null for content without frontmatter', () => {
    // Given — a plain note with no frontmatter
    const content = 'Just a note.';

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — it is not recognised as a synced task note
    expect(parsed).toBeNull();
  });
});
