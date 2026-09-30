import { describe, expect, it } from 'vitest';
import { TodoistTaskMapper } from '../../../src/Domain/Mappers/TodoistTaskMapper.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import { todoistTask } from '../../helpers/records.js';

const task = todoistTask({
  id: 'T1',
  sectionId: 'S1',
  content: 'Fix the bug',
  labels: ['task'],
  addedAt: '2026-09-18T09:00:00Z',
  updatedAt: '2026-09-18T10:00:00Z',
});

const section: TodoistSectionData = {
  id: 'S1',
  projectId: 'P1',
  name: 'Building',
};

describe('TodoistTaskMapper', () => {
  it('parses a task, its section and parent onto the canonical task', () => {
    // Given — a top-level task in a lane section

    // When — the records are parsed
    const parsed = TodoistTaskMapper.parseTask(task, section, null);

    // Then — identity is left for the half to compose, content and the lane are
    // carried, and the mirror handle names the twin
    expect(parsed.id).toBe('');
    expect(parsed.notePath).toBe('');
    expect(parsed.mirrors).toEqual({ todoist: 'T1' });
    expect(parsed.title).toBe('Fix the bug');
    expect(parsed.status).toBe('Building');
    expect(parsed.completedAt).toBeNull();
    expect(parsed.parent).toBeNull();
    expect(parsed.type).toBe('task');
  });

  it('maps the provider clocks: updatedAt is not dropped, addedAt is createdAt', () => {
    // Given — a task carrying the provider clocks

    // When — it is parsed
    const parsed = TodoistTaskMapper.parseTask(task, section, null);

    // Then — the trustworthy task-scoped clock reaches the diff hints
    expect(parsed.updatedAt).toBe('2026-09-18T10:00:00Z');
    expect(parsed.createdAt).toBe('2026-09-18T09:00:00Z');
  });

  it('stamps the completion from the provider clock, or empty when absent', () => {
    // Given — a completed task with a completion stamp, and one without
    const stamped = todoistTask({
      id: 'T1',
      isCompleted: true,
      completedAt: '2026-09-24T11:00:00Z',
    });
    const unstamped = todoistTask({ id: 'T1', isCompleted: true });

    // When — both are parsed
    const a = TodoistTaskMapper.parseTask(stamped, null, null);
    const b = TodoistTaskMapper.parseTask(unstamped, null, null);

    // Then — the stamp is carried; a missing one is '' ("done, stamp unknown")
    expect(a.completedAt).toBe('2026-09-24T11:00:00Z');
    expect(b.completedAt).toBe('');
  });

  it('reads a subtask parent from the task record', () => {
    // Given — a subtask under a parent task

    // When — the subtask is parsed
    const parsed = TodoistTaskMapper.parseTask(
      { ...task, parentId: 'T0' },
      null,
      null,
    );

    // Then — the parent twin id is carried for the action to resolve to a uuid
    expect(parsed.parent).toBe('T0');
  });

  it('parses a to-do with its completion status and mirror handle', () => {
    // Given — a completed to-do twin

    // When — it is parsed
    const todo = TodoistTaskMapper.parseToDo(
      { ...task, isCompleted: true, completedAt: '2026-09-24T11:00:00Z' },
      null,
    );

    // Then — the canonical to-do is completed and its identity is composed by
    // the half
    expect(todo.mirrors).toEqual({ todoist: 'T1' });
    expect(todo.title).toBe('Fix the bug');
    expect(todo.status).toBe('completed');
    expect(todo.completedAt).toBe('2026-09-24T11:00:00Z');
    expect(todo.task).toBeNull();
    expect(todo.parentTodo).toBeNull();
  });

  it('round-trips a task through render', () => {
    // Given — a canonical task parsed from a Todoist task
    const parsed = TodoistTaskMapper.parseTask(task, section, null);

    // When — it is rendered back
    const rendered = TodoistTaskMapper.renderTask(parsed, 'P1', 'S1');

    // Then — the create payload recovers content, type label and placement
    expect(rendered).toEqual({
      projectId: 'P1',
      content: 'Fix the bug',
      labels: ['task'],
      sectionId: 'S1',
    });
  });

  it('round-trips a to-do through render', () => {
    // Given — a canonical to-do
    const todo = TodoistTaskMapper.parseToDo(task, null);

    // When — it is rendered back
    const rendered = TodoistTaskMapper.renderToDo(todo, 'P1', 'T0');

    // Then — the create payload is a todo-labeled subtask
    expect(rendered).toEqual({
      projectId: 'P1',
      parentId: 'T0',
      content: 'Fix the bug',
      labels: ['todo'],
    });
  });
});
