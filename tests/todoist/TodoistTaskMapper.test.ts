import { describe, expect, it } from 'vitest';
import { TodoistTaskMapper } from '../../src/todoist/TodoistTaskMapper.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import { todoistTask } from '../helpers/records.js';

const task = todoistTask({
  id: 'T1',
  sectionId: 'S1',
  content: 'Fix the bug',
  labels: ['type: task'],
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
});
