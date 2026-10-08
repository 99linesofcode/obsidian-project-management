import { AdoptedProject } from '../../core/data/AdoptedProject.js';
import type { CapturedProject } from '../../core/data/CapturedProject.js';
import type { ProjectCaptureVaultPort } from '../../core/ports/ProjectCaptureVaultPort.js';
import { projectHomePath } from '../../shared/projectHomePath.js';
import { renderConnectionsBlock } from '../../vault/renderConnectionsBlock.js';

export interface CaptureProjectNote {
  projectName: string;
  connections: Record<string, { tool: string; project: string }>;
}

export interface CaptureVault {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
  createNote(path: string, content: string): Promise<void>;
  findProjectNotes(): Promise<readonly CaptureProjectNote[]>;
}

export class VaultProjectCaptureAdapter implements ProjectCaptureVaultPort {
  constructor(private readonly vault: CaptureVault) {}

  async listAdopted(): Promise<readonly AdoptedProject[]> {
    const adopted: AdoptedProject[] = [];
    for (const note of await this.vault.findProjectNotes()) {
      for (const connection of Object.values(note.connections)) {
        adopted.push(
          new AdoptedProject({
            projectName: note.projectName,
            application: connection.tool,
            target: connection.project,
          }),
        );
      }
    }
    return adopted;
  }

  async adopt(
    project: CapturedProject,
    application: string,
    slug: string,
  ): Promise<void> {
    const target = project.targets[0];
    if (target === undefined) {
      throw new Error(`project "${project.name}" has no target to adopt`);
    }

    const path = projectHomePath(project.name, false);
    if ((await this.vault.getNoteByPath(path)) !== null) {
      return;
    }

    await this.vault.createNote(
      path,
      homeNote(project.name, slug, application, target),
    );
  }
}

function homeNote(
  name: string,
  slug: string,
  application: string,
  target: string,
): string {
  return [
    '---',
    ...renderConnectionsBlock({ [slug]: { tool: application, project: target } }),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');
}
