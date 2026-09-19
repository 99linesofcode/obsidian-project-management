import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../../../src/Domain/Notes/TaskNoteParser.js';
import { TaskStatus } from '../../../src/Domain/Enums/TaskStatus.js';
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

const context = { projectName: 'Acme Widgets', syncedAt: '2026-09-18T12:00:00Z' };

describe('TaskNoteParser', () => {
  it('round-trips a mapped note back to url, status and body', () => {
    // Given — a note produced by the mapper
    const { content } = TaskNoteMapper.map(task, context);

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — url, status and body are preserved
    expect(parsed).toEqual({
      url: task.url,
      status: TaskStatus.Open,
      body: task.body,
    });
  });

  it('round-trips a closed task to a done status', () => {
    // Given — a closed task mapped to a note
    const closed: TaskData = { ...task, state: 'closed' };
    const { content } = TaskNoteMapper.map(closed, context);

    // When — the note is parsed
    const parsed = TaskNoteParser.parse(content);

    // Then — the status is done
    expect(parsed?.status).toBe(TaskStatus.Done);
  });

  it('returns null for content with frontmatter but no url', () => {
    // Given — a note that is not a synced artifact (no url frontmatter)
    const content = ['---', 'categories: [taken]', '---', 'Some body.'].join('\n');

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
