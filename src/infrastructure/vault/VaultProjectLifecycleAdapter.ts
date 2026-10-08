import { OriginObservation } from '../../core/data/OriginObservation.js';
import type { ProjectLifecycleOriginPort } from '../../core/ports/ProjectLifecycleOriginPort.js';
import { projectHomePath } from '../../shared/projectHomePath.js';

export interface ProjectLifecycleVault {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  modifiedTime(path: string): Promise<string | null>;
  moveFolder(fromPrefix: string, toPrefix: string): Promise<void>;
}

export interface ProjectLifecycleRegistry {
  listEntities(
    projectName: string,
  ): Promise<Array<{ id: string; notePath: string }>>;
  setEntity(record: { id: string; notePath: string }): Promise<void>;
}

export class VaultProjectLifecycleAdapter implements ProjectLifecycleOriginPort {
  constructor(
    private readonly vault: ProjectLifecycleVault,
    private readonly registry: ProjectLifecycleRegistry,
  ) {}

  async observeProject(project: string): Promise<OriginObservation> {
    const archived = await this.isArchived(project);
    const path = projectHomePath(project, archived);
    const note = await this.vault.getNoteByPath(path);

    return new OriginObservation({
      current: archived ? 'true' : 'false',
      currentCompleted: false,
      fieldTime: note === null ? null : await this.vault.modifiedTime(path),
      trustworthy: true,
    });
  }

  async applyProjectArchived(
    project: string,
    archived: boolean,
  ): Promise<void> {
    const from = archived ? 'Projecten' : 'Archief';
    const to = archived ? 'Archief' : 'Projecten';
    await this.vault.moveFolder(`${from}/${project}`, `${to}/${project}`);
    await this.relocateEntities(
      project,
      `${from}/${project}/`,
      `${to}/${project}/`,
    );
  }

  private async isArchived(project: string): Promise<boolean> {
    const active = await this.vault.getNoteByPath(
      projectHomePath(project, false),
    );
    return active === null;
  }

  private async relocateEntities(
    project: string,
    fromPrefix: string,
    toPrefix: string,
  ): Promise<void> {
    for (const record of await this.registry.listEntities(project)) {
      if (record.notePath.startsWith(fromPrefix)) {
        await this.registry.setEntity({
          ...record,
          notePath: `${toPrefix}${record.notePath.slice(fromPrefix.length)}`,
        });
      }
    }
  }
}
