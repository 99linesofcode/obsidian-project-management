import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ProjectLifecycleSyncAction } from './ProjectLifecycleSyncAction.js';

// A gone project folder is a tracked change reached from the registry: a
// recorded project whose vault folder no longer exists (neither active nor
// archived) has its remote project removed on every connection, then its
// registry record is pruned. The absence is verified against the vault's real
// files, never the metadata cache, so a cold cache is never mistaken for a
// delete.
export class SweepDeletedProjectsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    private readonly lifecycle: ProjectLifecycleSyncAction,
  ) {}

  async execute(): Promise<void> {
    for (const project of await this.registry.listProjects()) {
      if (await this.projectFolderExists(project)) {
        continue;
      }
      await this.removeGoneProject(project);
    }
  }

  private async projectFolderExists(project: string): Promise<boolean> {
    if (
      (await this.vault.listNotesInFolder(`Projecten/${project}`)).length > 0
    ) {
      return true;
    }
    return (
      (await this.vault.listNotesInFolder(`Archief/${project}`)).length > 0
    );
  }

  private async removeGoneProject(project: string): Promise<void> {
    try {
      const outcome = await this.lifecycle.invoke(project);
      if (outcome.failed.length > 0) {
        return;
      }
      await this.registry.removeProject(project);
    } catch (error) {
      console.error(`SweepDeletedProjectsAction: ${project} failed`, error);
    }
  }
}
