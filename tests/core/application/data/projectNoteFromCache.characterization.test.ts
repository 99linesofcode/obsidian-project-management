import { describe, expect, it } from 'vitest';
import { ConnectionValidationService } from '../../../../src/core/application/services/ConnectionValidationService.js';
import { projectNoteFromCache } from '../../../../src/core/application/data/projectNoteFromCache.js';

const validator = new ConnectionValidationService(new Set(['github']));
const github = { tool: 'github', project: 'https://github.com/acme/widgets' };

// Characterization for S17c: today the cache read names the project from the
// folder segment and ignores a `project` property on the note. Passes today;
// PLC-1 changes the name source to that property.
describe('characterization — the cache read names the project from the folder (today)', () => {
  it('keys the note by its folder even when the note carries a project property', () => {
    const note = projectNoteFromCache(
      'Projecten/Old Folder/_home.md',
      { project: 'New Name', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('Old Folder');
  });
});
