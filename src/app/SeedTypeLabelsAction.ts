import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import { DEFAULT_LABEL_COLOR } from '../shared/labels.js';

// Seeds the configured type-label vocabulary onto an arbitrary repository. The
// settings tab's label-seed button drives it, so the type labels a project's
// issues carry can be established on any repo the token can write to.
//
// Create-if-missing: a label the repository already carries is left untouched
// (its color and description are the user's), so the action is idempotent and
// safe to press repeatedly.
export class SeedTypeLabelsAction {
  constructor(private readonly port: ProjectManagementPort) {}

  async execute(repoInput: string, labels: string[]): Promise<void> {
    // The port accepts either a full repository url or the `owner/name`
    // shorthand; the provider expands it at the boundary.
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
