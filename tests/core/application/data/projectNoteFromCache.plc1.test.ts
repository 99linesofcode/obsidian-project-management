import { describe, expect, it } from 'vitest';
import { ConnectionValidationService } from '../../../../src/core/application/services/ConnectionValidationService.js';
import { projectNoteFromCache } from '../../../../src/core/application/data/projectNoteFromCache.js';

const validator = new ConnectionValidationService(new Set(['github']));
const github = { tool: 'github', project: 'https://github.com/acme/widgets' };

// PLC-1 — the project name is a property. Its home is a top-level `project:`
// key in the project note's YAML frontmatter, beside `connections`:
//
//   ---
//   project: Acme
//   connections:
//     github:
//       tool: github
//       project: https://github.com/acme/widgets
//   ---
//
// The folder segment and the home-note filename (`_<name>.md`, DISC-2) are
// derived from it. The property is authoritative over the folder segment.
describe('PLC-1 — a project note names itself from its `project` property', () => {
  it('takes the name from `project`, not from the folder segment', () => {
    const note = projectNoteFromCache(
      'Projecten/Old Folder/_home.md',
      { project: 'New Name', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('New Name');
  });

  it('lets the property win over the folder segment when they disagree', () => {
    const note = projectNoteFromCache(
      'Projecten/Beta/_Acme.md',
      { project: 'Acme', connections: { github } },
      validator,
    );

    expect(note?.projectName).toBe('Acme');
  });
});
