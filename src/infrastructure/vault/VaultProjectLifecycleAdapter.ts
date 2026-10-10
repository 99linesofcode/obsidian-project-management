import { OriginObservation } from '../../core/data/OriginObservation.js';
import type { ProjectLifecycleOriginPort } from '../../core/ports/ProjectLifecycleOriginPort.js';

export interface ProjectLifecycleVault {
  findHomeNotePath(project: string): Promise<string | null>;
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
    const path = await this.vault.findHomeNotePath(project);
    if (path === null) {
      return new OriginObservation({
        current: null,
        currentCompleted: false,
        fieldTime: null,
        trustworthy: true,
      });
    }

    return new OriginObservation({
      current: path.startsWith('Archief/') ? 'true' : 'false',
      currentCompleted: false,
      fieldTime: await this.vault.modifiedTime(path),
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
