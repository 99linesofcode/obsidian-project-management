import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import { DEFAULT_LABEL_COLOR } from '../shared/labels.js';

export class SeedTypeLabelsAction {
  constructor(private readonly port: ProjectManagementPort) {}

  async execute(repoInput: string, labels: string[]): Promise<void> {
    const repo = repoInput.trim();
    if (repo === '') {
      return;
    }
    const existing = new Set(await this.port.listRepoLabels(repo));
    for (const label of labels) {
      const name = label.trim();
      if (name === '' || existing.has(name)) {
        continue;
      }
      await this.port.createRepoLabel(repo, name, DEFAULT_LABEL_COLOR);
    }
  }
}
