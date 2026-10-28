import {
  normalizedStem,
  slugify,
  topLevelFrontmatterField,
} from '../../domain/note.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export interface DetectNoteRenamesInput {
  projectName: string;
  syncedAt: string;
}

export class DetectNoteRenamesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
  ) {}

  async execute(input: DetectNoteRenamesInput): Promise<void> {
    const currentPaths: string[] = await this.vault.listNotesInFolder(
      `Projecten/${input.projectName}/taken`,
    );
    const currentSet = new Set(currentPaths);

    const records = (
      await this.syncState.listEntities(input.projectName)
    ).filter((record) =>
      record.notePath.startsWith(`Projecten/${input.projectName}/`),
    );
    const trackedPaths = new Set(records.map((record) => record.notePath));

    const untrackedByKey = new Map<string, string[]>();
    for (const path of [...currentPaths].sort()) {
      if (trackedPaths.has(path)) {
        continue;
      }
      for (const key of await this.recoveryKeys(path)) {
        const list = untrackedByKey.get(key) ?? [];
        list.push(path);
        untrackedByKey.set(key, list);
      }
    }

    for (const record of records) {
      if (currentSet.has(record.notePath)) {
        continue;
      }
      const newPath = takeUntracked(
        untrackedByKey,
        normalizedStem(record.notePath),
      );
      if (newPath === undefined) {
        continue;
      }
      await this.syncState.setEntity({ ...record, notePath: newPath });
    }
  }

  private async recoveryKeys(path: string): Promise<string[]> {
    const keys = new Set<string>([normalizedStem(path)]);
    const declared = await this.declaredName(path);
    if (declared !== null) {
      keys.add(slugify(declared));
    }
    return [...keys];
  }

  private async declaredName(path: string): Promise<string | null> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null) {
      return null;
    }
    const declared = topLevelFrontmatterField(note.content, 'name');
    return declared === null || declared === '' ? null : declared;
  }
}

function takeUntracked(
  untrackedByKey: Map<string, string[]>,
  key: string,
): string | undefined {
  const path = untrackedByKey.get(key)?.shift();
  if (path === undefined) {
    return undefined;
  }
  for (const candidates of untrackedByKey.values()) {
    const index = candidates.indexOf(path);
    if (index !== -1) {
      candidates.splice(index, 1);
    }
  }
  return path;
}
