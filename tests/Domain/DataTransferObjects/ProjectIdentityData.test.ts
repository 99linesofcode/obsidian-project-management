import { describe, expect, it } from 'vitest';
import type { AttachProjectData } from '../../../src/Domain/DataTransferObjects/AttachProjectData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';

// The DTOs are plain type contracts, so there is no runtime behaviour to
// protect. These tests pin the shape the rest of the core depends on: the
// input a note's frontmatter maps onto, and the identity the port returns.
describe('AttachProjectData', () => {
  it('carries the pm, repo url and board url from a note', () => {
    // Given — a note's sync frontmatter
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/1',
    };

    // When/Then — the fields are readable as authored
    expect(data.pm).toBe('github');
    expect(data.repoUrl).toBe('https://github.com/acme/widgets');
    expect(data.boardUrl).toBe('https://github.com/orgs/acme/projects/1');
  });
});

describe('ProjectIdentityData', () => {
  it('carries the resolved github identities', () => {
    // Given — the identities resolved for a project
    const data: ProjectIdentityData = {
      repoUrl: 'https://github.com/acme/widgets',
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Todo' },
        { id: 'PVTSSF_2', name: 'Done' },
      ],
    };

    // When/Then — the fields are readable as authored
    expect(data.repoUrl).toBe('https://github.com/acme/widgets');
    expect(data.repoNodeId).toBe('R_kgDOAAAA');
    expect(data.projectNodeId).toBe('PVT_123');
    expect(data.statusFieldId).toBe('PVTF_456');
    expect(data.statusOptions).toEqual([
      { id: 'PVTSSF_1', name: 'Todo' },
      { id: 'PVTSSF_2', name: 'Done' },
    ]);
  });
});
