import { TaskData } from '../shared/TaskData.js';
import { stemOf } from '../shared/stemOf.js';
import { titleFromNotePath } from './TaskNoteMapper.js';
import { TaskNoteParser } from './TaskNoteParser.js';
import { splitFrontmatter } from './splitFrontmatter.js';

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
    return new TaskData({
      id: '',
      notePath: notePath,
      mirrors: {},
      title: titleFromNotePath(notePath, remoteId),
      body: parsed.body,
      status: parsed.status,
      completedAt: done ? completedField : null,
      type: parsed.type,
      parent: null,
      createdAt: fields?.get('created') ?? null,
      updatedAt: null,
    });
  },
};

// The leading `<remoteId>-` prefix of a legacy issue-backed note's stem, or 0
// when the note carries none (a new slug-only note or a captured draft).
function remoteIdFromNotePath(notePath: string): number {
  const match = stemOf(notePath).match(/^(\d+)-/);
  return match === null ? 0 : Number(match[1]);
}
