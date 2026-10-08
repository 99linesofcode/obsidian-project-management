import type { DeclaredConnection } from './data/DeclaredConnection.js';
import type { CapturePort } from './ports/CapturePort.js';
import type { MirrorAdapterFactoryPort } from './ports/MirrorAdapterFactoryPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';
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
      try {
        const result = await this.captureConnection(
          project,
          connection,
          capture,
          syncedAt,
        );
        captured.push(...result.captured);
        errors.push(...result.errors);
      } catch (error) {
        errors.push(error);
      }
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

    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const task of tasks) {
      if (adopted.has(task.handle)) {
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
    }
    return { captured, errors };
  }
}
