import { describe, expect, it } from 'vitest';
import { TodoistTaskMapper } from '../../../src/Domain/Mappers/TodoistTaskMapper.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';

const task: TodoistTaskData = {
  id: 'T1',
  projectId: 'P1',
  sectionId: 'S1',
  parentId: null,
  content: 'Fix the bug',
  labels: ['task'],
  isCompleted: false,
  url: 'https://app.todoist.com/app/task/T1',
};

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

    // Then — identity and content are carried, the lane comes from the section
    expect(parsed.todoistId).toBe('T1');
    expect(parsed.url).toBe(task.url);
    expect(parsed.title).toBe('Fix the bug');
    expect(parsed.status).toBe('Building');
    expect(parsed.completed).toBe(false);
    expect(parsed.parent).toBeNull();
    expect(parsed.labels).toEqual(['task']);
  });

  it('reads a subtask parent from the parent record', () => {
    // Given — a subtask under a parent task
    const parent: TodoistTaskData = { ...task, id: 'T0', content: 'Slice' };

    // When — the subtask is parsed
    const parsed = TodoistTaskMapper.parseTask(
      { ...task, parentId: 'T0' },
      null,
      parent,
    );

    // Then — the parent id is carried
    expect(parsed.parent).toBe('T0');
  });

  it('parses a to-do with its completion status', () => {
    // Given — a completed to-do twin

    // When — it is parsed
    const todo = TodoistTaskMapper.parseToDo(
      { ...task, isCompleted: true },
      null,
    );

    // Then — the canonical to-do is completed
    expect(todo.todoistId).toBe('T1');
    expect(todo.title).toBe('Fix the bug');
    expect(todo.status).toBe('completed');
  });

  it('round-trips a task through render', () => {
    // Given — a canonical task parsed from a Todoist task
    const parsed = TodoistTaskMapper.parseTask(task, section, null);

    // When — it is rendered back
    const rendered = TodoistTaskMapper.renderTask(parsed, 'P1', 'S1');

    // Then — the create payload recovers content, labels and placement
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
