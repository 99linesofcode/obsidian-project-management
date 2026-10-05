import { TaskData } from '../DataTransferObjects/TaskData.js';
import { stemOf } from '../Notes/stemOf.js';
import { titleFromNotePath } from '../Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../Notes/TaskNoteParser.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';

// The vault side of the canonical task. A task note carries its vault-owned id
// and type, lane (status), body and affiliation. The mapper wraps the existing
// parsers, so the vault boundary has one home. One-way: parse maps a note onto
// TaskData; the writers render notes through the note mappers directly.
export interface VaultTaskContext {
  projectName: string;
  // The project's done lane, so a note's status can be read as completed.
  doneLane: string;
}

export const VaultTaskMapper = {
  parseTask(
    content: string,
    notePath: string,
    context: VaultTaskContext,
  ): TaskData | null {
    const parsed = TaskNoteParser.parse(content);
    if (!parsed) {
      return null;
    }
    // The parsed note guarantees a frontmatter block; read the fields the
    // parser does not surface (completed/created) off it directly.
    const fields = splitFrontmatter(content)?.fields;
    const remoteId = remoteIdFromNotePath(notePath);
    const done = context.doneLane !== '' && parsed.status === context.doneLane;
    const completedField = fields?.get('completed') ?? '';
    return new TaskData(
      // WHY '': the note carries no machine id (dt-20); the action layer
      // composes the uuid from the registry record that resolved this path.
      '',
      notePath,
      {}, // the vault live view knows no mirror handles; the registry owns them
      titleFromNotePath(notePath, remoteId),
      parsed.body,
      parsed.status,
      // A done-lane note is completed by its lane; the stamp is the note's own
      // `completed` value when it has one, '' when the lane is the only signal.
      done ? completedField : null,
      parsed.type,
      // WHY null: the affiliation resolves to the parent's uuid, which needs a
      // registry lookup the pure mapper cannot make. The action layer resolves
      // it; an unresolved parent stays null and the next pass retries.
      null,
      fields?.get('created') ?? null,
      // WHY null: the vault has no honest per-field clock. File mtime is the
      // adapter's concern, not this pure view's.
      null,
    );
  },
};

// The leading `<remoteId>-` prefix of a legacy issue-backed note's stem, or 0
// when the note carries none (a new slug-only note or a captured draft).
function remoteIdFromNotePath(notePath: string): number {
  const match = stemOf(notePath).match(/^(\d+)-/);
  return match === null ? 0 : Number(match[1]);
}
