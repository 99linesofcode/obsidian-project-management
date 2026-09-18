import { describe, expect, it } from 'vitest';
import { AttachProjectAction } from '../../../src/Domain/Actions/AttachProjectAction.js';
import type { AttachProjectData } from '../../../src/Domain/DataTransferObjects/AttachProjectData.js';
import type { ProjectIdentityData } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';

// A fake port at the boundary: records what the action asked for and returns
// a canned identity, so the action's own behaviour is what's under test.
class FakePort implements ProjectManagementPort {
  calls: AttachProjectData[] = [];
  result: ProjectIdentityData | null = null;

  async fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null> {
    this.calls.push(data);
    return this.result;
  }
}

const identity: ProjectIdentityData = {
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Todo' }],
};

describe('AttachProjectAction', () => {
  it('resolves identities for a github project note', async () => {
    // Given — a github note and a port that resolves it
    const port = new FakePort();
    port.result = identity;
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/1',
    };

    // When — the action runs
    const result = await action.execute(data);

    // Then — the port was asked and its identity returned
    expect(port.calls).toEqual([data]);
    expect(result).toBe(identity);
  });

  it('returns null for a non-github provider without calling the port', async () => {
    // Given — a note for a provider this plugin does not handle
    const port = new FakePort();
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'linear',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://linear.app/acme/project/1',
    };

    // When — the action runs
    const result = await action.execute(data);

    // Then — nothing is resolved and the port is never touched
    expect(result).toBeNull();
    expect(port.calls).toEqual([]);
  });

  it('throws a domain error when a github note is missing its board url', async () => {
    // Given — a github note with no board url (a config error)
    const port = new FakePort();
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: '',
    };

    // When/Then — the action refuses with a clear domain error
    await expect(action.execute(data)).rejects.toThrow(/boardUrl/);
    expect(port.calls).toEqual([]);
  });
});
