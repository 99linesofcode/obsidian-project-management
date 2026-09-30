import { describe, expect, it } from 'vitest';
import { VaultTaskMapper } from '../../../src/Domain/Mappers/VaultTaskMapper.js';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import { ToDoNoteMapper } from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import { ToDoData } from '../../../src/Domain/DataTransferObjects/ToDoData.js';
import { taskData } from '../../helpers/records.js';

const context = { projectName: 'Acme Widgets', doneLane: 'Shipped' };
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';

describe('VaultTaskMapper', () => {
  it('parses a task note onto the canonical task', () => {
    // Given — a task note produced by the note mapper
    const { content } = TaskNoteMapper.map(
      {
        id: 'uuid-42',
        type: 'task',
        title: 'Fix the bug',
        body: 'The bug happens on resize.',
        createdAt: null,
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Building',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — the vault-owned identity and content are carried
    expect(task?.id).toBe('uuid-42');
    expect(task?.type).toBe('task');
    expect(task?.notePath).toBe(notePath);
    expect(task?.mirrors).toEqual({});
    expect(task?.title).toBe('fix the bug');
    expect(task?.body).toBe('The bug happens on resize.');
    expect(task?.status).toBe('Building');
    expect(task?.completedAt).toBeNull();
    // The mapper is pure: the affiliation-derived parent waits for the action
    // layer, which alone can reach the registry.
    expect(task?.parent).toBeNull();
    expect(task?.createdAt).toBe('2026-09-18');
    expect(task?.updatedAt).toBeNull();
  });

  it('reads the done lane as completed (the stamp may be unknown)', () => {
    // Given — a task note in the done lane
    const { content } = TaskNoteMapper.map(
      {
        id: 'uuid-42',
        type: 'task',
        title: 'Fix the bug',
        body: '',
        createdAt: null,
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Shipped',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — the task is completed: '' marks done with an unknown stamp
    expect(task?.completedAt).toBe('');
    expect(task?.status).toBe('Shipped');
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
        taskLink: 'fix-the-bug',
      },
      { syncedAt: '2026-09-18T12:00:00Z', statusName: 'open' },
    );

    // When — the note is parsed
    const todo = VaultTaskMapper.parseToDo(
      content,
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      context,
    );

    // Then — the content is carried; the uuids wait for the action layer
    expect(todo?.id).toBe('');
    expect(todo?.title).toBe('fix the bug');
    expect(todo?.status).toBe('open');
    expect(todo?.completedAt).toBeNull();
    expect(todo?.parentTodo).toBeNull();
    expect(todo?.task).toBeNull();
    expect(todo?.mirrors).toEqual({});
  });

  it('round-trips a task through render', () => {
    // Given — a canonical task
    const task = taskData({
      id: 'uuid-42',
      notePath,
      type: 'task',
      title: 'Fix the bug',
      body: 'The bug happens on resize.',
      status: 'Building',
      createdAt: '2026-09-18',
    });

    // When — it is rendered to a note
    const note = VaultTaskMapper.renderTask(task, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the note path and managed fields match the note mapper
    expect(note.path).toBe(notePath);
    expect(note.content).toContain('id: uuid-42');
    expect(note.content).toContain('type: task');
    expect(note.content).toContain('status: Building');
    expect(note.content).not.toContain('url:');
  });

  it('round-trips a to-do through render', () => {
    // Given — a canonical to-do and its resolved affiliation links
    const todo = new ToDoData(
      'todo-uuid',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      {},
      'Fix the bug',
      'open',
      null,
      null,
      'task-uuid',
      null,
      null,
    );

    // When — it is rendered to a note
    const note = VaultTaskMapper.renderToDo(todo, {
      projectName: 'Acme Widgets',
      syncedAt: '2026-09-18T12:00:00Z',
      taskLink: 'fix-the-bug',
    });

    // Then — the note path and affiliation match the note mapper
    expect(note.path).toBe('Projecten/Acme Widgets/todos/fix-the-bug.md');
    expect(note.content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[fix-the-bug]]"]',
    );
  });
});
