import type { VaultPort } from '../core/VaultPort.js';
import type { ProjectManagementSettings } from './settings/settings.js';
import {
  SEED_ARTIFACTS,
  type SeedArtifact,
  type SeedArtifactKey,
} from './seedArtifacts.js';

export class SeedVaultArtifactsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly settings: ProjectManagementSettings,
  ) {}

  async execute(): Promise<void> {
    for (const artifact of SEED_ARTIFACTS) {
      await this.seed(artifact);
    }
  }

  async executeOne(key: SeedArtifactKey): Promise<void> {
    const artifact = SEED_ARTIFACTS.find((candidate) => candidate.key === key);
    if (artifact !== undefined) {
      await this.seed(artifact);
    }
  }

  private async seed(artifact: SeedArtifact): Promise<void> {
    const path = (this.settings[artifact.settingKey] ?? '').trim();
    if (path === '') {
      return;
    }
    if ((await this.vault.getNoteByPath(path)) !== null) {
      return;
    }
    await this.vault.createNote(path, artifact.content);
  }
}
