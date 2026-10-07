import type { VaultPort } from '../shared/VaultPort.js';
import type { ProjectManagementSettings } from './settings/settings.js';
import {
  SEED_ARTIFACTS,
  type SeedArtifact,
  type SeedArtifactKey,
} from './seedArtifacts.js';

// Seeds the six vault-owned artifacts the plugin assumes exist — the three
// templates and the three Bases files — so a fresh vault works out of the box.
//
// Create-if-missing only: a file at the configured path is never overwritten,
// even when its content differs from the seed. That makes running on every
// init safe and idempotent, and lets the settings tab reuse the same action to
// scaffold a single missing artifact on demand.
export class SeedVaultArtifactsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly settings: ProjectManagementSettings,
  ) {}

  // Seeds every artifact whose configured path is absent. Running twice
  // creates nothing the second time.
  async execute(): Promise<void> {
    for (const artifact of SEED_ARTIFACTS) {
      await this.seed(artifact);
    }
  }

  // Seeds one artifact on demand (the settings tab's Scaffold button). Same
  // create-if-missing semantics as execute().
  async executeOne(key: SeedArtifactKey): Promise<void> {
    const artifact = SEED_ARTIFACTS.find((candidate) => candidate.key === key);
    if (artifact !== undefined) {
      await this.seed(artifact);
    }
  }

  private async seed(artifact: SeedArtifact): Promise<void> {
    const path = this.settings[artifact.settingKey].trim();
    if (path === '') {
      return;
    }
    // The vault port's create builds the parent folder chain (mkdir -p), so a
    // missing Templates/ or Bases/ folder is created by the write itself.
    if ((await this.vault.getNoteByPath(path)) !== null) {
      return;
    }
    await this.vault.createNote(path, artifact.content);
  }
}
