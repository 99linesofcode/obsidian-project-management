import { describe, expect, it } from 'vitest';
import { TaskManagerMirrorAdapter } from '../../../src/infrastructure/todoist/TaskManagerMirrorAdapter.js';
import type { TaskManagerTransport } from '../../../src/infrastructure/todoist/TaskManagerTransport.js';

// The port surface the archive fact's decisive time is read through. S22
// renames it from an archive-specific `archivedTime` to the project's own
// clock, `projectTime` (the approved rename); the value it returns is the
// project's `updated_at`.
interface ProjectClockPort {
  projectTime?(target: string): Promise<string | null>;
}

const TARGET = 'P1';

class FakeTransport implements TaskManagerTransport {
  readonly calls: Array<{ method: string; path: string }> = [];
  private readonly responses: Array<{ status: number; json: unknown }>;

  constructor(responses: Array<{ status: number; json: unknown }>) {
    this.responses = [...responses];
  }

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'GET', path });
    return this.next();
  }

  async post(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'POST', path });
    return this.next();
  }

  async delete(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push({ method: 'DELETE', path });
    return this.next();
  }

  private next(): { status: number; json: unknown } {
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('fake transport: no more responses queued');
    }
    return response;
  }
}

// A transport that routes by path, so a project read and a task read are
// distinct resources. The queue-based fake cannot express that: it hands out
// the next response whatever the path, so a clock that read a task would still
// receive the project's response and pass for the wrong reason.
class RoutingTransport implements TaskManagerTransport {
  readonly calls: string[] = [];
  private readonly resources: ReadonlyMap<
    string,
    { status: number; json: unknown }
  >;

  constructor(
    resources: ReadonlyMap<string, { status: number; json: unknown }>,
  ) {
    this.resources = resources;
  }

  async get(path: string): Promise<{ status: number; json: unknown }> {
    this.calls.push(path);
    const response = this.resources.get(path);
    if (response === undefined) {
      throw new Error(`routing transport: unexpected GET ${path}`);
    }
    return response;
  }

  async post(): Promise<{ status: number; json: unknown }> {
    throw new Error('routing transport: unexpected POST');
  }

  async delete(): Promise<{ status: number; json: unknown }> {
    throw new Error('routing transport: unexpected DELETE');
  }
}

function adapterWith(responses: Array<{ status: number; json: unknown }>): {
  adapter: TaskManagerMirrorAdapter;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(responses);
  return {
    adapter: new TaskManagerMirrorAdapter(transport, TARGET),
    transport,
  };
}

function project(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: TARGET,
    name: 'Widgets',
    is_archived: false,
    updated_at: '2026-10-08T10:00:00Z',
    ...overrides,
  };
}

describe('ADP-6 — the task manager reports the project clock from the project updated_at', () => {
  it('reports the project updated_at as the archive fact time', async () => {
    const { adapter } = adapterWith([
      { status: 200, json: project({ updated_at: '2026-10-08T11:00:00Z' }) },
    ]);
    const port = adapter as unknown as ProjectClockPort;

    expect(await port.projectTime?.(TARGET)).toBe('2026-10-08T11:00:00Z');
  });

  it('reads the clock from the project, unaffected by a task inside it', async () => {
    // A task inside the project carries its own, later updated_at; the project
    // resource carries the clock. Routing by path makes the task's later time
    // reachable, so a clock that read the task would return it and fail.
    const transport = new RoutingTransport(
      new Map([
        [
          `/projects/${TARGET}`,
          {
            status: 200,
            json: project({ updated_at: '2026-10-08T10:00:00Z' }),
          },
        ],
        [
          '/tasks/T1',
          {
            status: 200,
            json: {
              id: 'T1',
              project_id: TARGET,
              content: 'Edited later',
              labels: ['type: task'],
              checked: false,
              updated_at: '2026-10-08T18:00:00Z',
            },
          },
        ],
      ]),
    );
    const adapter = new TaskManagerMirrorAdapter(transport, TARGET);
    const port = adapter as unknown as ProjectClockPort;

    expect(await port.projectTime?.(TARGET)).toBe('2026-10-08T10:00:00Z');
    expect(transport.calls).toEqual([`/projects/${TARGET}`]);
  });

  it('moves on both archive and un-archive', async () => {
    const archived = adapterWith([
      {
        status: 200,
        json: project({
          is_archived: true,
          updated_at: '2026-10-08T11:00:00Z',
        }),
      },
    ]);
    const restored = adapterWith([
      {
        status: 200,
        json: project({
          is_archived: false,
          updated_at: '2026-10-09T09:00:00Z',
        }),
      },
    ]);

    expect(
      await (archived.adapter as unknown as ProjectClockPort).projectTime?.(
        TARGET,
      ),
    ).toBe('2026-10-08T11:00:00Z');
    expect(
      await (restored.adapter as unknown as ProjectClockPort).projectTime?.(
        TARGET,
      ),
    ).toBe('2026-10-09T09:00:00Z');
  });
});
