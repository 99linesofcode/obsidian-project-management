import { renderFilename } from '../../domain/note.js';
import { ORIGIN_SIDE } from '../../domain/sides.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface MigrateNoteFilenamesInput {
  projectName: string;
}

const ROOTS = ['Projecten', 'Archief'] as const;

export class MigrateNoteFilenamesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
  ) {}

  async execute(input: MigrateNoteFilenamesInput): Promise<void> {
    const notes = await this.takenNotes(input.projectName);
    const plan = await this.renamePlan(notes);

    for (const [source, target] of plan) {
      await this.rename(source, target);
    }
  }

  private async takenNotes(projectName: string): Promise<string[]> {
    const notes: string[] = [];
    for (const root of ROOTS) {
      notes.push(
        ...(await this.vault.listNotesInFolder(`${root}/${projectName}/taken`)),
      );
    }
    return notes;
  }

  private async renamePlan(
    notes: readonly string[],
  ): Promise<Map<string, string>> {
    const sources = new Map<string, string[]>();
    for (const path of notes) {
      const target = await this.titleFilename(path);
      if (target !== null && target !== path) {
        sources.set(target, [...(sources.get(target) ?? []), path]);
      }
    }
    return this.withoutCollisions(sources, new Set(notes));
  }

  private async titleFilename(path: string): Promise<string | null> {
    const baseline = await this.registry.readBaseline(
      path,
      'title',
      ORIGIN_SIDE,
    );
    if (baseline === null || baseline.value === null) {
      console.warn(
        `MigrateNoteFilenamesAction: no title baseline for ${path}; leaving its filename alone`,
      );
      return null;
    }
    return this.render(path, baseline.value);
  }

  private render(path: string, title: string): string | null {
    try {
      return `${folderOf(path)}/${renderFilename(title)}`;
    } catch (error) {
      console.warn(
        `MigrateNoteFilenamesAction: cannot render a filename for ${path}: ${String(error)}`,
      );
      return null;
    }
  }

  private withoutCollisions(
    sources: ReadonlyMap<string, string[]>,
    occupied: ReadonlySet<string>,
  ): Map<string, string> {
    const plan = new Map<string, string>();
    for (const [target, paths] of sources) {
      const source = paths.length === 1 ? paths[0] : undefined;
      if (source === undefined) {
        console.warn(
          `MigrateNoteFilenamesAction: ${paths.length} notes render to ${target}; leaving them alone`,
        );
        continue;
      }
      if (occupied.has(target)) {
        console.warn(
          `MigrateNoteFilenamesAction: ${target} is already taken; leaving ${source} alone`,
        );
        continue;
      }
      plan.set(source, target);
    }
    return plan;
  }

  private async rename(source: string, target: string): Promise<void> {
    await this.vault.renameNote(source, target);

    const record = await this.registry.findByNotePath(source);
    if (record !== null) {
      await this.registry.setEntity({ ...record, notePath: target });
    }
    await this.registry.rekeyBaseline(source, target);
  }
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
