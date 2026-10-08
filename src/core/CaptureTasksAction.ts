import type { DeclaredConnection } from './data/DeclaredConnection.js';
import type { CapturePort } from './ports/CapturePort.js';
import type { MirrorAdapterFactoryPort } from './ports/MirrorAdapterFactoryPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';
import type { TaskCaptureCursorPort } from './ports/TaskCaptureCursorPort.js';
import type { TaskCaptureVaultPort } from './ports/TaskCaptureVaultPort.js';

export interface CaptureTasksResult {
  captured: string[];
  errors: unknown[];
}

export class CaptureTasksAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly vault: TaskCaptureVaultPort,
    private readonly cursor: TaskCaptureCursorPort,
  ) {}

  async invoke(project: string, syncedAt: string): Promise<CaptureTasksResult> {
    const connections = await this.projectSource.readConnections(project);
    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const connection of connections) {
      const adapter = this.factory.create(
        connection.envelope.application,
        connection.envelope.target,
        connection.slug,
        project,
      );
      const capture = adapter?.capture;
      if (capture === undefined) {
        continue;
      }
      const result = await this.captureConnection(
        project,
        connection,
        capture,
        syncedAt,
      );
      captured.push(...result.captured);
      errors.push(...result.errors);
    }
    return { captured, errors };
  }

  private async captureConnection(
    project: string,
    connection: DeclaredConnection,
    capture: CapturePort,
    syncedAt: string,
  ): Promise<CaptureTasksResult> {
    const tasks = await capture.capture(connection.envelope.target);
    const adopted = new Set(
      await this.vault.listAdopted(project, connection.slug),
    );
    const cursor = await this.cursor.read(project, connection.slug);
    const start = resumeIndex(tasks, cursor);

    const captured: string[] = [];
    const errors: unknown[] = [];
    let next = cursor;
    for (const task of tasks.slice(start)) {
      if (adopted.has(task.handle)) {
        next = task.handle;
        continue;
      }
      try {
        await this.vault.adopt({
          task,
          application: connection.envelope.application,
          slug: connection.slug,
          projectName: project,
          syncedAt,
        });
      } catch (error) {
        errors.push(error);
        break;
      }
      captured.push(task.handle);
      adopted.add(task.handle);
      next = task.handle;
    }

    if (next !== null && next !== cursor) {
      await this.cursor.write(project, connection.slug, next);
    }
    return { captured, errors };
  }
}

function resumeIndex(
  tasks: readonly { handle: string }[],
  cursor: string | null,
): number {
  if (cursor === null) {
    return 0;
  }
  return tasks.findIndex((task) => task.handle === cursor) + 1;
}
