import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export interface DetectNoteRenamesInput {
  projectId: string;
  syncedAt: string;
}

export class DetectNoteRenamesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
  ) {}

  async execute(input: DetectNoteRenamesInput): Promise<void> {
    const records = await this.syncState.listEntities(input.projectId);

    const noteIds = await this.vault.readNoteIds();
    const presentPaths = new Set(noteIds.map((note) => note.path));
    const pathsById = groupPathsById(noteIds);

    for (const record of records) {
      if (presentPaths.has(record.notePath)) {
        continue;
      }
      const candidates = pathsById.get(record.id) ?? [];
      const [first, ...duplicates] = candidates;
      if (first === undefined) {
        continue;
      }
      if (duplicates.length > 0) {
        console.warn(
          `DetectNoteRenamesAction: id ${record.id} is carried by ${candidates.join(', ')}; keeping ${first}`,
        );
      }
      await this.syncState.setEntity({ ...record, notePath: first });
    }
  }
}

function groupPathsById(
  noteIds: readonly { id: string; path: string }[],
): Map<string, string[]> {
  const pathsById = new Map<string, string[]>();
  for (const { id, path } of noteIds) {
    const paths = pathsById.get(id) ?? [];
    paths.push(path);
    pathsById.set(id, paths);
  }
  return pathsById;
}
