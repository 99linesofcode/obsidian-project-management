import { describe, expect, it } from 'vitest';
import { TaskManagerMirrorAdapter } from '../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from '../../../src/infrastructure/todoist/TaskManagerTransport.js';

class FakeTransport implements TaskManagerTransport {
  readonly requests: Array<{ method: string; path: string }> = [];
  readonly projects: Array<{ id: string; name: string }> = [];
  readonly missing = new Set<string>();
  readonly created: string[] = [];

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.requests.push({ method: 'get', path });
    if (path === '/projects') {
      return { status: 200, json: this.projects };
    }
    const id = path.replace('/projects/', '');
    if (this.missing.has(id)) {
      return { status: 404, json: {} };
    }
    const project = this.projects.find((candidate) => candidate.id === id);
    return project === undefined
      ? { status: 404, json: {} }
      : { status: 200, json: project };
  }

  async post(
    path: string,
    body: string,
  ): Promise<{ status: number; json: unknown }> {
    this.requests.push({ method: 'post', path });
    const name = (JSON.parse(body) as { name: string }).name;
    const id = `P-${name}`;
    this.created.push(name);
    this.projects.push({ id, name });
    return { status: 200, json: { id, name } };
  }

  async delete(): Promise<never> {
    throw new Error('not used in this test');
  }
}

describe('TaskManagerMirrorAdapter — resolveOrCreateProject', () => {
  it('creates the project by name when the target is empty and it is absent', async () => {
    const transport = new FakeTransport();

    const addressing = await new TaskManagerMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'Widgets', []);

    expect(addressing?.projectHandle).toBe('P-Widgets');
    expect(addressing?.effectiveTarget).toBe('P-Widgets');
    expect(transport.created).toEqual(['Widgets']);
  });

  it('adopts the project by name when the target is empty and it exists', async () => {
    const transport = new FakeTransport();
    transport.projects.push({ id: 'P-1', name: 'Widgets' });

    const addressing = await new TaskManagerMirrorAdapter(
      transport,
    ).resolveOrCreateProject('', 'Widgets', []);

    expect(addressing?.projectHandle).toBe('P-1');
    expect(addressing?.effectiveTarget).toBe('P-1');
    expect(transport.created).toEqual([]);
  });

  it('adopts the explicit target project when it exists', async () => {
    const transport = new FakeTransport();
    transport.projects.push({ id: 'P-9', name: 'Other' });

    const addressing = await new TaskManagerMirrorAdapter(
      transport,
    ).resolveOrCreateProject('P-9', 'Widgets', []);

    expect(addressing?.projectHandle).toBe('P-9');
    expect(addressing?.effectiveTarget).toBe('P-9');
    expect(transport.created).toEqual([]);
  });

  it('re-creates by name when the explicit target project is gone', async () => {
    const transport = new FakeTransport();
    transport.missing.add('P-gone');

    const addressing = await new TaskManagerMirrorAdapter(
      transport,
    ).resolveOrCreateProject('P-gone', 'Widgets', []);

    expect(addressing?.projectHandle).toBe('P-Widgets');
    expect(addressing?.effectiveTarget).toBe('P-Widgets');
    expect(transport.created).toEqual(['Widgets']);
  });
});
