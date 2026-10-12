import type { CapturedProject } from '../../port/data/CapturedProject.js';
import type {
  CaptureSource,
  MirrorAdapterFactoryPort,
} from '../../port/MirrorAdapterFactoryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface CaptureProjectsResult {
  captured: string[];
  errors: unknown[];
}

export class CaptureProjectsAction {
  constructor(
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly vault: VaultPort,
  ) {}

  async invoke(): Promise<CaptureProjectsResult> {
    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const source of this.factory.captureSources?.() ?? []) {
      const result = await this.captureSource(source);
      captured.push(...result.captured);
      errors.push(...result.errors);
    }
    return { captured, errors };
  }

  private async captureSource(
    source: CaptureSource,
  ): Promise<CaptureProjectsResult> {
    const projects = await source.capture.captureProjects();
    const adopted = await this.vault.listAdoptedProjects();
    const names = new Set(adopted.map((project) => project.projectName));
    const targets = new Set(
      adopted
        .filter((project) => project.application === source.application)
        .map((project) => project.target),
    );

    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const project of projects) {
      if (names.has(project.name)) {
        continue;
      }
      const target = soleTarget(project);
      if (target === null) {
        errors.push(
          new Error(
            `project "${project.name}" links ${project.targets.length} targets; a project is captured through exactly one`,
          ),
        );
        continue;
      }
      if (targets.has(target)) {
        continue;
      }
      try {
        await this.vault.adoptProject(
          project,
          source.application,
          source.application,
        );
      } catch (error) {
        errors.push(error);
        continue;
      }
      captured.push(project.name);
      names.add(project.name);
      targets.add(target);
    }
    return { captured, errors };
  }
}

function soleTarget(project: CapturedProject): string | null {
  return project.targets.length === 1 ? project.targets[0]! : null;
}
