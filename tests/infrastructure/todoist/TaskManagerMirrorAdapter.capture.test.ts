import { describe, expect, it } from 'vitest';
import { TaskManagerMirrorAdapter } from '../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from '../../../src/infrastructure/todoist/TaskManagerTransport.js';

class ProjectsTransport implements TaskManagerTransport {
  readonly paths: string[] = [];

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.paths.push(path);
    return {
      status: 200,
      json: [
        {
          id: 'P-new',
          name: 'New Project',
          created_at: '2026-10-05T10:00:00Z',
        },
        { id: 'P-old', name: 'Old Project', created_at: '2026-09-01T00:00:00Z' },
      ],
    };
  }

  async post(): Promise<never> {
    throw new Error('not used');
  }
  async delete(): Promise<never> {
    throw new Error('not used');
  }
}

describe('TaskManagerMirrorAdapter — the project-capture surface', () => {
  it('enumerates the task-manager projects with their creation clocks', async () => {
    const transport = new ProjectsTransport();
    const adapter = new TaskManagerMirrorAdapter(transport);

    const projects = await adapter.captureProjects();

    expect(transport.paths).toEqual(['/projects']);
    expect(
      projects.map((project) => ({
        name: project.name,
        targets: project.targets,
        createdAt: project.createdAt,
      })),
    ).toEqual([
      { name: 'New Project', targets: ['P-new'], createdAt: '2026-10-05T10:00:00Z' },
      { name: 'Old Project', targets: ['P-old'], createdAt: '2026-09-01T00:00:00Z' },
    ]);
  });
});
