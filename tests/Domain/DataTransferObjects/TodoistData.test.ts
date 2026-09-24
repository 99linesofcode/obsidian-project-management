import { describe, expect, it } from 'vitest';
import type { CreateTodoistTaskData } from '../../../src/Domain/DataTransferObjects/CreateTodoistTaskData.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';
import type { TodoistSectionData } from '../../../src/Domain/DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../../../src/Domain/DataTransferObjects/TodoistTaskData.js';

// The DTOs are plain type contracts, so there is no runtime behaviour to
// protect. These tests pin the shapes the core depends on: the provider
// records the adapter maps onto, and the input the core hands back to create
// a task.
describe('TodoistProjectData', () => {
  it('carries the id, name and archived state', () => {
    // Given — a project record mapped from the provider
    const data: TodoistProjectData = {
      id: 'P1',
      name: 'Widgets',
      isArchived: false,
    };

    // When/Then — the fields are readable as authored
    expect(data.id).toBe('P1');
    expect(data.name).toBe('Widgets');
    expect(data.isArchived).toBe(false);
  });
});

describe('TodoistSectionData', () => {
  it('carries the id, project and lane name', () => {
    // Given — a section record mapped from the provider
    const data: TodoistSectionData = {
      id: 'S1',
      projectId: 'P1',
      name: 'Unshaped',
    };

    // When/Then — the fields are readable as authored
    expect(data.id).toBe('S1');
    expect(data.projectId).toBe('P1');
    expect(data.name).toBe('Unshaped');
  });
});

describe('TodoistTaskData', () => {
  it('carries the snapshot fields, with null section and parent for a top-level task', () => {
    // Given — a top-level task mapped from the provider
    const data: TodoistTaskData = {
      id: 'T1',
      projectId: 'P1',
      sectionId: null,
      parentId: null,
      content: 'Fix the widget',
      labels: ['task'],
      isCompleted: false,
      url: 'https://app.todoist.com/app/task/T1',
    };

    // When/Then — the fields are readable as authored
    expect(data.sectionId).toBeNull();
    expect(data.parentId).toBeNull();
    expect(data.labels).toEqual(['task']);
    expect(data.isCompleted).toBe(false);
  });
});

describe('CreateTodoistTaskData', () => {
  it('carries the required fields and omits absent placement', () => {
    // Given — the minimal input the core hands the port
    const data: CreateTodoistTaskData = {
      projectId: 'P1',
      content: 'Fix the widget',
    };

    // When/Then — the optional placement and labels are absent
    expect(data.projectId).toBe('P1');
    expect(data.content).toBe('Fix the widget');
    expect(data.sectionId).toBeUndefined();
    expect(data.parentId).toBeUndefined();
    expect(data.labels).toBeUndefined();
  });
});
