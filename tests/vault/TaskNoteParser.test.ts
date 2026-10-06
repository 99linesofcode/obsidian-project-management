import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import { TaskNoteParser } from '../../src/vault/TaskNoteParser.js';

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

describe('MAT-1 — a task note parses to the canonical shape', () => {
  it('round-trips a mapped note back to type, status and body', () => {
    const { content } = TaskNoteMapper.map(task, context);

    const parsed = TaskNoteParser.parse(content);

    expect(parsed).toEqual({
      type: 'task',
      status: 'Building',
      body: task.body,
      affiliation: ['[[_Acme Widgets]]'],
    });
  });

  it('ignores a legacy url and id without requiring one', () => {
    const content = [
      '---',
      'id: uuid-42',
      'url: https://github.com/acme/widgets/issues/42',
      'status: Building',
      '---',
      'Body.',
    ].join('\n');

    const parsed = TaskNoteParser.parse(content);

    expect(parsed?.status).toBe('Building');
    expect(parsed?.body).toBe('Body.');
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('url');
  });

  it('parses a note with frontmatter but no machine id', () => {
    const content = ['---', 'status: open', '---', 'Body.'].join('\n');

    const parsed = TaskNoteParser.parse(content);

    expect(parsed?.status).toBe('open');
    expect(parsed?.body).toBe('Body.');
  });

  it('round-trips a lane name with spaces verbatim', () => {
    const { content } = TaskNoteMapper.map(task, {
      ...context,
      statusName: 'Shipped',
    });

    const parsed = TaskNoteParser.parse(content);

    expect(parsed?.status).toBe('Shipped');
  });

  it('returns null for content without frontmatter', () => {
    const content = 'Just a note.';

    const parsed = TaskNoteParser.parse(content);

    expect(parsed).toBeNull();
  });
});
