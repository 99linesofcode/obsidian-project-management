import { describe, expect, it } from 'vitest';
import { EnsureTodoistSectionsAction } from '../../src/projects/EnsureTodoistSectionsAction.js';
import type { CreateTodoistTaskData } from '../../src/todoist/CreateTodoistTaskData.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';
import type { TodoistSectionData } from '../../src/todoist/TodoistSectionData.js';
import type { TodoistTaskData } from '../../src/todoist/TodoistTaskData.js';
import type { TaskManagerPort } from '../../src/todoist/TaskManagerPort.js';

// A fake task manager holding the project's sections in memory, so the
// ensure action's lookup-before-create and rename decisions are observable
// through the mutations it performs.
class FakeTaskManager implements TaskManagerPort {
  sections: TodoistSectionData[] = [];
  createCalls: Array<{ projectId: string; name: string }> = [];
  updateCalls: Array<{ id: string; name: string }> = [];
  nextId = 1;

  async fetchSections(projectId: string): Promise<TodoistSectionData[]> {
    return this.sections.filter((section) => section.projectId === projectId);
  }
  async createSection(
    projectId: string,
    name: string,
  ): Promise<TodoistSectionData> {
    this.createCalls.push({ projectId, name });
    const section = { id: `S${this.nextId++}`, projectId, name };
    this.sections.push(section);
    return section;
  }
  async updateSection(id: string, name: string): Promise<void> {
    this.updateCalls.push({ id, name });
    const section = this.sections.find((candidate) => candidate.id === id);
    if (section) {
      section.name = name;
    }
  }

  async fetchProjects(): Promise<TodoistProjectData[]> {
    return [];
  }
  async fetchProject(): Promise<null> {
    return null;
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectArchived(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchActiveTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async fetchCompletedTasks(): Promise<TodoistTaskData[]> {
    return [];
  }
  async createTask(_input: CreateTodoistTaskData): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setTaskCompleted(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async ensureLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
}

function section(name: string, id: string): TodoistSectionData {
  return { id, projectId: 'P1', name };
}

describe('LANE-1 — Todoist has one section per lane', () => {
  it('creates a section for every lane and maps it by name', async () => {
    const taskManager = new FakeTaskManager();
    const action = new EnsureTodoistSectionsAction(taskManager);

    const result = await action.execute({
      projectId: 'P1',
      laneNames: ['Unshaped', 'Shipped'],
      stored: {},
    });

    expect(taskManager.createCalls).toEqual([
      { projectId: 'P1', name: 'Unshaped' },
      { projectId: 'P1', name: 'Shipped' },
    ]);
    expect(result).toEqual({ Unshaped: 'S1', Shipped: 'S2' });
  });

  it('looks up by name before creating, so an existing section is reused', async () => {
    const taskManager = new FakeTaskManager();
    taskManager.sections = [section('Unshaped', 'S-existing')];
    const action = new EnsureTodoistSectionsAction(taskManager);

    const result = await action.execute({
      projectId: 'P1',
      laneNames: ['Unshaped'],
      stored: {},
    });

    expect(taskManager.createCalls).toEqual([]);
    expect(result).toEqual({ Unshaped: 'S-existing' });
  });

  it('renames a section when a lane is renamed', async () => {
    const taskManager = new FakeTaskManager();
    taskManager.sections = [section('Todo', 'S1'), section('Done', 'S2')];
    const action = new EnsureTodoistSectionsAction(taskManager);

    const result = await action.execute({
      projectId: 'P1',
      laneNames: ['Backlog', 'Done'],
      stored: { Todo: 'S1', Done: 'S2' },
    });

    expect(taskManager.updateCalls).toEqual([{ id: 'S1', name: 'Backlog' }]);
    expect(taskManager.createCalls).toEqual([]);
    expect(result).toEqual({ Backlog: 'S1', Done: 'S2' });
  });

  it('is idempotent: a settled lane set creates and renames nothing', async () => {
    const taskManager = new FakeTaskManager();
    taskManager.sections = [
      section('Unshaped', 'S1'),
      section('Shipped', 'S2'),
    ];
    const action = new EnsureTodoistSectionsAction(taskManager);

    const result = await action.execute({
      projectId: 'P1',
      laneNames: ['Unshaped', 'Shipped'],
      stored: { Unshaped: 'S1', Shipped: 'S2' },
    });

    expect(taskManager.createCalls).toEqual([]);
    expect(taskManager.updateCalls).toEqual([]);
    expect(result).toEqual({ Unshaped: 'S1', Shipped: 'S2' });
  });
});
