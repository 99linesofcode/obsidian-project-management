import { projectAffiliationLink } from '../../../domain/affiliation.js';
import { renderFilename } from '../../../domain/note.js';

export interface CapturedTaskNoteInput {
  title: string;
  projectName: string;
  sliceLink: string | null;
  kind: string;
}

export interface CapturedTaskNoteContext {
  syncedAt: string;
  statusName: string;
}

export interface CapturedTaskNote {
  path: string;
  content: string;
}

export const CapturedTaskNoteMapper = {
  map(
    input: CapturedTaskNoteInput,
    context: CapturedTaskNoteContext,
  ): CapturedTaskNote {
    const content = [
      '---',
      'categories: [taken]',
      `labels: [type:${input.kind}]`,
      `status: ${context.statusName}`,
      `affiliation: ${affiliationValue(input)}`,
      `synced: ${context.syncedAt}`,
      '---',
      '',
    ].join('\n');
    return { path: capturedTaskNotePath(input), content };
  },
};

function capturedTaskNotePath(input: CapturedTaskNoteInput): string {
  return `Projecten/${input.projectName}/taken/${renderFilename(input.title)}`;
}

function affiliationValue(input: CapturedTaskNoteInput): string {
  const links = [projectAffiliationLink(input.projectName)];
  if (input.sliceLink !== null) {
    links.push(`[[${input.sliceLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}
