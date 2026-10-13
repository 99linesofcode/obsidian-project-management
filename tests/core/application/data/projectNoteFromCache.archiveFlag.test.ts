import { describe, expect, it } from 'vitest';
import { ConnectionValidationService } from '../../../../src/core/application/services/ConnectionValidationService.js';
import { projectNoteFromCache } from '../../../../src/core/application/data/projectNoteFromCache.js';

const connectionValidator = new ConnectionValidationService(
  new Set(['github', 'todoist']),
);

const github = { tool: 'github', project: 'https://github.com/acme/widgets' };

function note(path: string) {
  return projectNoteFromCache(
    path,
    { connections: { github } },
    connectionValidator,
  );
}

describe('characterization — the note DTO carries the archive flag (pre-S22)', () => {
  it('derives an archivedAt flag from the folder', () => {
    expect(note('Projecten/Acme Widgets/_home.md')?.archivedAt).toBeNull();
    expect(note('Archief/Acme Widgets/_home.md')?.archivedAt).toBe('');
  });
});

describe('S22 — the note DTO carries no archive flag; the folder is the state', () => {
  it('returns a note without an archivedAt field', () => {
    const active = note('Projecten/Acme Widgets/_home.md');
    const archived = note('Archief/Acme Widgets/_home.md');

    expect(active).not.toHaveProperty('archivedAt');
    expect(archived).not.toHaveProperty('archivedAt');
  });
});
