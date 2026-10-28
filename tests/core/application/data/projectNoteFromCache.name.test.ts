import { describe, expect, it } from 'vitest';
import { ConnectionValidationService } from '../../../../src/core/application/services/ConnectionValidationService.js';
import { projectNoteFromCache } from '../../../../src/core/application/data/projectNoteFromCache.js';

const validator = new ConnectionValidationService(new Set(['github']));
const github = { tool: 'github', project: 'https://github.com/acme/widgets' };

// PLC-1 (changed) / NAME-2 — the project name is the top-level `name:` property
// (migrated from `project:`). The folder segment and the home-note filename are
// derived from it; the property is authoritative over the folder segment. The
// retired `project:` key is no longer read (decision 3 was withdrawn).
describe('PLC-1 — a project note names itself from its `name` property', () => {
  it('takes the name from `name`, not from the folder segment', () => {
    const note = projectNoteFromCache(
      'Projecten/Old Folder/_home.md',
      { name: 'New Name', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('New Name');
  });

  it('lets the property win over the folder segment when they disagree', () => {
    const note = projectNoteFromCache(
      'Projecten/Beta/_Acme.md',
      { name: 'Acme', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('Acme');
  });

  it('no longer reads the retired `project` property', () => {
    const note = projectNoteFromCache(
      'Projecten/Beta/_Beta.md',
      { project: 'Old Name', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('Beta');
  });
});
