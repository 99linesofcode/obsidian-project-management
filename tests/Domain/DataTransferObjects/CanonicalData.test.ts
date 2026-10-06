import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../../src/Domain/DataTransferObjects/ProjectData.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ToDoData } from '../../../src/Domain/DataTransferObjects/ToDoData.js';

// The canonical DTOs are plain type contracts, so there is no runtime
// behaviour to protect. These tests pin the shapes the core diffs on: identity
// fields link the representations, content fields are the comparable shape.
describe('TaskData', () => {
  it('carries identity and content fields', () => {
    // Given — a canonical task mapped from a provider
    const data: TaskData = {
      url: 'https://github.com/acme/widgets/issues/42',
      remoteId: 42,
      nodeId: 'I_kwDOAAAA42',
      todoistId: 'T1',
      notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      title: 'Fix the bug',
      body: 'The bug happens on resize.',
      status: 'Building',
      completed: false,
      parent: null,
      labels: ['type: task'],
      updatedAt: '2026-09-18T10:00:00Z',
    };

    // When/Then — the fields are readable as authored
    expect(data.remoteId).toBe(42);
    expect(data.todoistId).toBe('T1');
    expect(data.status).toBe('Building');
    expect(data.completed).toBe(false);
    expect(data.parent).toBeNull();
  });
});

describe('ToDoData', () => {
  it('carries identity and content fields, with a nullable parent to-do', () => {
    // Given — a canonical to-do mapped from a provider
    const data: ToDoData = {
      todoistId: 'T2',
      notePath: 'Projecten/Acme Widgets/todos/fix-the-bug.md',
      projectName: 'Acme Widgets',
      taskLink: '42-fix-the-bug',
      parentTodoLink: null,
      title: 'Fix the bug',
      status: 'open',
    };

    // When/Then — the fields are readable as authored
    expect(data.taskLink).toBe('42-fix-the-bug');
    expect(data.parentTodoLink).toBeNull();
    expect(data.status).toBe('open');
    expect(data.completedAt).toBeUndefined();
  });
});

describe('ProjectData', () => {
  it('carries identity and content fields', () => {
    // Given — a canonical project mapped from a provider
    const data: ProjectData = {
      githubUrl: 'https://github.com/acme/widgets',
      todoistId: 'P1',
      name: 'Acme Widgets',
      archived: false,
    };

    // When/Then — the fields are readable as authored
    expect(data.githubUrl).toBe('https://github.com/acme/widgets');
    expect(data.todoistId).toBe('P1');
    expect(data.name).toBe('Acme Widgets');
    expect(data.archived).toBe(false);
  });
});
