import type { CapturedProject } from './data/CapturedProject.js';
import type {
  CaptureSource,
  MirrorAdapterFactoryPort,
} from './ports/MirrorAdapterFactoryPort.js';
import type { ProjectCaptureCursorPort } from './ports/ProjectCaptureCursorPort.js';
import type { ProjectCaptureVaultPort } from './ports/ProjectCaptureVaultPort.js';

export interface CaptureProjectsResult {
  captured: string[];
  errors: unknown[];
}

export class CaptureProjectsAction {
  constructor(
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly vault: ProjectCaptureVaultPort,
    private readonly cursor: ProjectCaptureCursorPort,
  ) {}

  async invoke(syncedAt: string): Promise<CaptureProjectsResult> {
    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const source of this.factory.captureSources?.() ?? []) {
      const result = await this.captureSource(source, syncedAt);
      captured.push(...result.captured);
      errors.push(...result.errors);
    }
    return { captured, errors };
  }

  private async captureSource(
    source: CaptureSource,
    syncedAt: string,
  ): Promise<CaptureProjectsResult> {
    const projects = sortedByCreatedAt(
      await source.capture.captureProjects(),
    );
    const adopted = await this.vault.listAdopted();
    const names = new Set(adopted.map((project) => project.projectName));
    const targets = new Set(
      adopted
        .filter((project) => project.application === source.application)
        .map((project) => project.target),
    );
    const cursor = await this.cursor.read(source.application);

    if (cursor === null) {
      await this.cursor.write(
        source.application,
        newestCreatedAt(projects) ?? syncedAt,
      );
      return { captured: [], errors: [] };
    }

    const captured: string[] = [];
    const errors: unknown[] = [];
    let next = cursor;
    for (const project of projects) {
      if (!createdAfter(project.createdAt, cursor)) {
        continue;
      }
      if (names.has(project.name)) {
        next = project.createdAt ?? next;
        continue;
      }
      const target = soleTarget(project);
      if (target === null) {
        errors.push(
          new Error(
            `project "${project.name}" links ${project.targets.length} targets; a project is captured through exactly one`,
          ),
        );
        break;
      }
      if (targets.has(target)) {
        next = project.createdAt ?? next;
        continue;
      }
      try {
        await this.vault.adopt(project, source.application, source.application);
      } catch (error) {
        errors.push(error);
        break;
      }
      captured.push(project.name);
      names.add(project.name);
      targets.add(target);
      next = project.createdAt ?? next;
    }

    if (next !== cursor) {
      await this.cursor.write(source.application, next);
    }
    return { captured, errors };
  }
}

function soleTarget(project: CapturedProject): string | null {
  return project.targets.length === 1 ? project.targets[0]! : null;
}

function newestCreatedAt(projects: readonly CapturedProject[]): string | null {
  let newest: string | null = null;
  for (const project of projects) {
    if (project.createdAt === null) {
      continue;
    }
    if (newest === null || project.createdAt > newest) {
      newest = project.createdAt;
    }
  }
  return newest;
}

function sortedByCreatedAt(
  projects: readonly CapturedProject[],
): readonly CapturedProject[] {
  return [...projects].sort((left, right) => {
    if (left.createdAt === null) {
      return 1;
    }
    if (right.createdAt === null) {
      return -1;
    }
    return left.createdAt < right.createdAt
      ? -1
      : left.createdAt > right.createdAt
        ? 1
        : 0;
  });
}

function createdAfter(createdAt: string | null, cursor: string): boolean {
  return createdAt !== null && createdAt > cursor;
}
