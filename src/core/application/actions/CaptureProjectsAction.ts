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
    private readonly isCodeHost: (application: string) => boolean,
  ) {}

  async invoke(): Promise<CaptureProjectsResult> {
    const captured: string[] = [];
    const errors: unknown[] = [];

    const sources = this.factory.captureSources?.() ?? [];
    const listings = await this.listProjects(sources);
    const codeHostNames = await this.codeHostProjectNames(sources, listings);

    for (const source of sources) {
      const result = await this.captureSource(
        source,
        listings.get(source) ?? [],
        codeHostNames,
      );
      captured.push(...result.captured);
      errors.push(...result.errors);
    }
    return { captured, errors };
  }

  private async listProjects(
    sources: readonly CaptureSource[],
  ): Promise<Map<CaptureSource, readonly CapturedProject[]>> {
    const listings = new Map<CaptureSource, readonly CapturedProject[]>();
    for (const source of sources) {
      listings.set(source, await source.capture.captureProjects());
    }
    return listings;
  }

  private async codeHostProjectNames(
    sources: readonly CaptureSource[],
    listings: ReadonlyMap<CaptureSource, readonly CapturedProject[]>,
  ): Promise<ReadonlySet<string>> {
    const names = new Set<string>();
    for (const source of sources) {
      if (!this.isCodeHost(source.application)) {
        continue;
      }
      for (const project of listings.get(source) ?? []) {
        names.add(project.name);
      }
    }
    for (const project of await this.vault.listAdoptedProjects()) {
      if (this.isCodeHost(project.application)) {
        names.add(project.projectName);
      }
    }
    return names;
  }

  private async captureSource(
    source: CaptureSource,
    projects: readonly CapturedProject[],
    codeHostNames: ReadonlySet<string>,
  ): Promise<CaptureProjectsResult> {
    const adopted = await this.vault.listAdoptedProjects();
    const names = new Set(
      adopted
        .filter((project) => project.application === source.application)
        .map((project) => project.projectName),
    );
    const targets = new Set(
      adopted
        .filter((project) => project.application === source.application)
        .map((project) => project.target),
    );
    const followsCodeHost = !this.isCodeHost(source.application);

    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const project of projects) {
      if (names.has(project.name)) {
        continue;
      }
      if (followsCodeHost && !codeHostNames.has(project.name)) {
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
