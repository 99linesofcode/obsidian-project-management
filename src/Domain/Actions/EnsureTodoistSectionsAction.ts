import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';

export interface EnsureTodoistSectionsInput {
  projectId: string;
  // The lane set: the GitHub board's status option names, in board order.
  laneNames: string[];
  // The lane name → section id map from the last sync, used to spot renames.
  stored: Record<string, string>;
}

// UC: ensure the project's lane sections exist (dt-07). The GitHub board's
// status options are the lane set; each becomes a Todoist section, mapped by
// name in sync state. Sections are looked up by name before creating — the live
// probe found that creating an existing name silently duplicates it — so a
// settled project creates nothing. A lane rename keeps its section: the stored
// map pairs a removed lane with an added one and the section is renamed in
// place, rather than a duplicate section being created beside the stale one.
export class EnsureTodoistSectionsAction {
  constructor(private readonly taskManager: TaskManagerPort) {}

  async execute(
    input: EnsureTodoistSectionsInput,
  ): Promise<Record<string, string>> {
    const sections = await this.taskManager.fetchSections(input.projectId);
    const byName = new Map(
      sections.map((section) => [section.name, section.id]),
    );

    // A removed stored lane paired with an added lane is a rename: the section
    // id is stable, so the section follows the new name. Pairing in order is a
    // heuristic — the board's option ids are not carried in the name-keyed map
    // — but it covers the common single-rename case without a duplicate.
    const removed = Object.keys(input.stored).filter(
      (name) => !input.laneNames.includes(name),
    );
    const added = input.laneNames.filter(
      (name) => !(name in input.stored) && !byName.has(name),
    );
    const renameByNewName = new Map<string, string>();
    for (let i = 0; i < Math.min(removed.length, added.length); i++) {
      renameByNewName.set(added[i]!, removed[i]!);
    }

    const result: Record<string, string> = {};
    for (const name of input.laneNames) {
      const oldName = renameByNewName.get(name);
      if (oldName !== undefined) {
        const sectionId = input.stored[oldName]!;
        await this.taskManager.updateSection(sectionId, name);
        result[name] = sectionId;
        continue;
      }

      const existing = byName.get(name);
      if (existing !== undefined) {
        result[name] = existing;
        continue;
      }

      const created = await this.taskManager.createSection(
        input.projectId,
        name,
      );
      result[name] = created.id;
    }
    return result;
  }
}
