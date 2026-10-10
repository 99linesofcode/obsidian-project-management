import { projectHomePath } from '../projectHomePath.js';
import type { NoteReaderPort } from '../ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../ports/NoteWriterPort.js';

export interface MigrateProjectHomeNoteInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
}

// Renames a discovered home note to the _<project>.md convention. Guard rails:
// only a recognised legacy form is touched (`_home.md` or exactly
// `<project>.md`) — a folder-renamed note whose basename drifted is left
// alone — and a pre-existing file at the target is never clobbered. Archived
// projects migrate too, so the note lands under Archief/. Returns the note's
// path after the migration (unchanged when nothing moved).
export class MigrateProjectHomeNoteAction {
  constructor(private readonly vault: NoteReaderPort & NoteWriterPort) {}

  async execute(input: MigrateProjectHomeNoteInput): Promise<string> {
    const target = projectHomePath(input.projectName, input.locationArchived);
    const basename = input.notePath.split('/').pop() ?? '';
    if (basename === (target.split('/').pop() ?? '')) {
      return input.notePath;
    }
    if (basename !== '_home.md' && basename !== `${input.projectName}.md`) {
      return input.notePath;
    }
    // A pre-existing file at the target belongs to the user; leave both in
    // place rather than clobbering it.
    if ((await this.vault.getNoteByPath(target)) !== null) {
      return input.notePath;
    }
    await this.vault.renameNote(input.notePath, target);
    return target;
  }
}
