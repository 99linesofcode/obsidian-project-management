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

describe('MAT-4 — a Todoist task maps to the canonical shape', () => {
  it('parses a task, its section and parent onto the canonical task', () => {

    const parsed = TodoistTaskMapper.parseTask(task, section, null);

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

    const parsed = TodoistTaskMapper.parseTask(task, section, null);

    expect(parsed.updatedAt).toBe('2026-09-18T10:00:00Z');
    expect(parsed.createdAt).toBe('2026-09-18T09:00:00Z');
  });

  it('stamps the completion from the provider clock, or empty when absent', () => {
    const stamped = todoistTask({
      id: 'T1',
      isCompleted: true,
      completedAt: '2026-09-24T11:00:00Z',
    });
    const unstamped = todoistTask({ id: 'T1', isCompleted: true });

    const a = TodoistTaskMapper.parseTask(stamped, null, null);
    const b = TodoistTaskMapper.parseTask(unstamped, null, null);

    expect(a.completedAt).toBe('2026-09-24T11:00:00Z');
    expect(b.completedAt).toBe('');
  });

  it('reads a subtask parent from the task record', () => {

    const parsed = TodoistTaskMapper.parseTask(
      { ...task, parentId: 'T0' },
      null,
      null,
    );

    expect(parsed.parent).toBe('T0');
  });
});
