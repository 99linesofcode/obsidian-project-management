import { parseAffiliation } from '../Notes/parseAffiliation.js';
import { parseChecklist, renderChecklist } from '../Notes/Checklist.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stemOf } from '../Notes/stemOf.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import { ToDoNoteParser, withToDoStatus } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface CompleteTaskCascadeInput {
  notePath: string;
  projectName: string;
  syncedAt: string;
}

// The dt-13 cascade — a task-status change is ONE fact with N vault
// projections. When the task note's status is the done lane the action:
//   1. checks the task note's own checklist lines (so the linked to-dos
//      complete and the checklist sync never reads them as reopened);
//   2. completes every still-open to-do note the task owns;
//   3. checks the task's own line in a parent slice's checklist (the marker
//      representing the task, when the task is nested).
//
// Reopen is asymmetric BY DECISION: the parent slice line mirrors the status,
// but the to-dos are never auto-reopened. The close cascade is a convenience
// sweep over still-open to-dos; reopen is a deliberate act whose per-to-do
// scope the user controls, so the asymmetry needs no new state and cannot
// clobber an independently-completed to-do.
//
// Every write is gated: an already-checked line and an already-completed to-do
// are no-ops, so the cascade settles and the double-sync invariance holds.
export class CompleteTaskCascadeAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly doneOptionName: string,
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
  }

  // The task's own checklist lines are the source of truth for its to-dos, so
  // they follow the status: a done task checks every linked line. The to-do
  // completion below rides the same fact, and the checklist sync's echo settles
  // because line and note agree. A reopen leaves the lines alone — the to-dos
  // stay completed (the asymmetric rule), so unchecking them would be reverted.
  // Returns the linked to-do paths so the completion below touches exactly the
  // task's own to-dos (an affiliated-but-unlinked note is not one of them).
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

  // Every linked to-do that is still open completes; an already-completed one is
  // left untouched, so a second pass writes nothing. The to-do's Todoist twin is
  // not touched here — the existing vault -> Todoist projection settles it on
  // the next chain pass.
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

  // The task's own line in a parent slice's checklist mirrors the status in
  // BOTH directions: the line is the task's representation, so it must not
  // read as done while the task is open. A task with no parent slice (no
  // affiliation beyond the project) has no line to follow.
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
