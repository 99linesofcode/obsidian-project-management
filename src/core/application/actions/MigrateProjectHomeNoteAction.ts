import { projectHomePath } from '../../domain/paths.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateProjectHomeNoteInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
}

export class MigrateProjectHomeNoteAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: MigrateProjectHomeNoteInput): Promise<string> {
    const target = projectHomePath(input.projectName, input.locationArchived);
    const basename = input.notePath.split('/').pop() ?? '';
    if (basename === (target.split('/').pop() ?? '')) {
      return input.notePath;
    }
    if (basename !== '_home.md' && basename !== `${input.projectName}.md`) {
      return input.notePath;
    }
    if ((await this.vault.getNoteByPath(target)) !== null) {
      return input.notePath;
    }
    await this.vault.renameNote(input.notePath, target);
    return target;
  }
}
