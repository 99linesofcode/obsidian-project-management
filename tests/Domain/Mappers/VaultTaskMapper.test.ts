import { describe, expect, it } from 'vitest';
import { VaultTaskMapper } from '../../../src/Domain/Mappers/VaultTaskMapper.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';

const context = { projectName: 'Acme Widgets', doneLane: 'Shipped' };
const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';

describe('VaultTaskMapper', () => {
  it('parses a task note onto the canonical task', () => {
    // Given — a task note produced by the note mapper
    const { content } = TaskNoteMapper.map(
      {
        url: 'https://github.com/acme/widgets/issues/42',
        remoteId: 42,
        title: 'Fix the bug',
        body: 'The bug happens on resize.',
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Building',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — identity and content are carried
    expect(task?.url).toBe('https://github.com/acme/widgets/issues/42');
    expect(task?.remoteId).toBe(42);
    expect(task?.title).toBe('fix the bug');
    expect(task?.body).toBe('The bug happens on resize.');
    expect(task?.status).toBe('Building');
    expect(task?.completed).toBe(false);
  });

  it('reads the done lane as completed', () => {
    // Given — a task note in the done lane
    const { content } = TaskNoteMapper.map(
      {
        url: 'https://github.com/acme/widgets/issues/42',
        remoteId: 42,
        title: 'Fix the bug',
        body: '',
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Shipped',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — the task is completed
    expect(task?.completed).toBe(true);
  });

  it('returns null for a note that is not a task note', () => {
    // Given — a plain note

    // When — it is parsed
    const task = VaultTaskMapper.parseTask('Just a note.', notePath, context);

    // Then — it is not a task note
    expect(task).toBeNull();
  });

  it('parses a to-do note onto the canonical to-do', () => {
    // Given — a to-do note produced by the note mapper
    const { content } = ToDoNoteMapper.map(
      {
        title: 'Fix the bug',
        projectName: 'Acme Widgets',
        taskLink: '42-fix-the-bug',
      },
      { syncedAt: '2026-09-18T12:00:00Z', statusName: 'open' },
    );

    // When — the note is parsed
    const todo = VaultTaskMapper.parseToDo(
      content,
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      context,
    );

    // Then — identity and content are carried
    expect(todo?.projectName).toBe('Acme Widgets');
    expect(todo?.taskLink).toBe('42-fix-the-bug');
    expect(todo?.parentTodoLink).toBeNull();
    expect(todo?.title).toBe('fix the bug');
    expect(todo?.status).toBe('open');
  });

  it('round-trips a task through render', () => {
    // Given — a canonical task
    const task = {
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: '',
      todoistId: '',
      notePath,
      title: 'Fix the bug',
      body: 'The bug happens on resize.',
      status: 'Building',
      completed: false,
      parent: null,
      labels: [],
      updatedAt: '',
    };

    // When — it is rendered to a note
    const note = VaultTaskMapper.renderTask(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the note path and managed fields match the note mapper
    expect(note.path).toBe(notePath);
    expect(note.content).toContain(
      'url: https://github.com/acme/widgets/issues/42',
    );
    expect(note.content).toContain('status: Building');
  });

  it('round-trips a to-do through render', () => {
    // Given — a canonical to-do
    const todo = {
      todoistId: 'T1',
      notePath: 'Projecten/Acme Widgets/todos/fix-the-bug.md',
      projectName: 'Acme Widgets',
      taskLink: '42-fix-the-bug',
      parentTodoLink: null,
      title: 'Fix the bug',
      status: 'open' as const,
    };

    // When — it is rendered to a note
    const note = VaultTaskMapper.renderToDo(todo, '2026-09-18T12:00:00Z');

    // Then — the note path and affiliation match the note mapper
    expect(note.path).toBe('Projecten/Acme Widgets/todos/fix-the-bug.md');
    expect(note.content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
    );
  });
});
