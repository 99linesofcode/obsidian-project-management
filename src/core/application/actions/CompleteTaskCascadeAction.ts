import { parseAffiliation, taskLinkFromAffiliation } from '../../domain/affiliation.js';
import { parseChecklist, renderChecklist } from '../../domain/checklist.js';
import {
  isCompleted,
  splitFrontmatter,
  stemOf,
  withBody,
  type SplitFrontmatter,
} from '../../domain/note.js';
import { ORIGIN_SIDE } from '../../domain/sides.js';
import { ToDoNoteParser, withToDoStatus } from '../../domain/ToDoNoteParser.js';
import { CanonicalFieldWrite } from '../../port/data/CanonicalFieldWrite.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

export interface CompleteTaskCascadeInput {
  notePath: string;
  projectName: string;
  syncedAt: string;
}

export class CompleteTaskCascadeAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly doneOptionName: string,
    private readonly registry: RegistryPort,
  ) {}

  async execute(input: CompleteTaskCascadeInput): Promise<void> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      return;
    }
    const split = splitFrontmatter(note.content);
    if (!split) {
      return;
    }

    const status = split.fields.get('status') ?? '';
    const done = this.doneOptionName !== '' && status === this.doneOptionName;
    const taskStem = stemOf(input.notePath);

    if (done) {
      const linked = await this.checkOwnChecklistLines(input, note.content);
      await this.completeToDos(input, linked);
    }

    await this.mirrorParentSliceLine(
      input,
      parseAffiliation(split.fields.get('affiliation')),
      taskStem,
      done,
    );

    // Run last: a failure in the completion write (a registry read or an
    // applyField) must not skip the note's to-do and slice cascade work above.
    await this.syncCompletion(input.notePath, split, done);
  }

  private async syncCompletion(
    notePath: string,
    split: SplitFrontmatter,
    done: boolean,
  ): Promise<void> {
    if (this.doneOptionName === '') {
      return;
    }
    const baseline = await this.registry.readBaseline(
      notePath,
      'Status',
      ORIGIN_SIDE,
    );
    const wasDone = baseline?.value === this.doneOptionName;
    if (done === wasDone) {
      return;
    }
    const hasCompleted = isCompleted(split.fields);
    if (done === hasCompleted) {
      return;
    }
    await this.vault.applyField(
      new CanonicalFieldWrite({
        handle: notePath,
        field: 'completion',
        value: done ? 'true' : 'false',
      }),
    );
  }

  private async checkOwnChecklistLines(
    input: CompleteTaskCascadeInput,
    content: string,
  ): Promise<string[]> {
    const split = splitFrontmatter(content);
    if (!split) {
      return [];
    }
    const items = parseChecklist(split.body);
    const linked: string[] = [];
    let changed = false;
    for (const item of items) {
      if (item.linkPath === undefined) {
        continue;
      }
      linked.push(item.linkPath);
      if (!item.checked) {
        item.checked = true;
        changed = true;
      }
    }
    if (changed) {
      await this.vault.writeNote(
        input.notePath,
        withBody(content, renderChecklist(split.body, items)),
      );
    }
    return linked;
  }

  private async completeToDos(
    input: CompleteTaskCascadeInput,
    linked: string[],
  ): Promise<void> {
    for (const path of linked) {
      const note = await this.vault.getNoteByPath(path);
      if (!note) {
        continue;
      }
      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed || parsed.status === 'completed') {
        continue;
      }
      await this.vault.writeNote(
        path,
        withToDoStatus(note.content, 'completed', input.syncedAt),
      );
    }
  }

  private async mirrorParentSliceLine(
    input: CompleteTaskCascadeInput,
    affiliation: string[],
    taskStem: string,
    done: boolean,
  ): Promise<void> {
    const sliceStem = taskLinkFromAffiliation(affiliation, input.projectName);
    if (sliceStem === null) {
      return;
    }
    const slicePath = `Projecten/${input.projectName}/taken/${sliceStem}.md`;
    const slice = await this.vault.getNoteByPath(slicePath);
    if (!slice) {
      return;
    }
    const split = splitFrontmatter(slice.content);
    if (!split) {
      return;
    }

    const items = parseChecklist(split.body);
    const item = items.find(
      (candidate) =>
        candidate.linkPath !== undefined &&
        stemOf(candidate.linkPath) === taskStem,
    );
    if (!item || item.checked === done) {
      return;
    }

    item.checked = done;
    await this.vault.writeNote(
      slicePath,
      withBody(slice.content, renderChecklist(split.body, items)),
    );
  }
}
