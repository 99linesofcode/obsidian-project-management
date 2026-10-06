import { describe, expect, it } from 'vitest';
import { AttachProjectAction } from '../../src/projects/AttachProjectAction.js';
import type { AttachProjectData } from '../../src/projects/AttachProjectData.js';
import type { ProjectIdentityData } from '../../src/projects/ProjectIdentityData.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';

// A fake port at the boundary: records what the action asked for and returns
// a canned identity, so the action's own behaviour is what's under test.
class FakePort implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  calls: AttachProjectData[] = [];
  result: ProjectIdentityData | null = null;

  async fetchProjectIdentity(
    data: AttachProjectData,
  ): Promise<ProjectIdentityData | null> {
    this.calls.push(data);
    return this.result;
  }

  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchTrackedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchTask(): Promise<never> {
    throw new Error('not used in this test');
  }

  async updateTask(): Promise<never> {
    throw new Error('not used in this test');
  }

  async setTaskState(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }

  async setBoardStatus(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addBoardItem(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }

  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }

  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const identity: ProjectIdentityData = {
  repoUrl: 'https://github.com/acme/widgets',
  repoNodeId: 'R_kgDOAAAA',
  projectNodeId: 'PVT_123',
  statusFieldId: 'PVTF_456',
  statusOptions: [{ id: 'PVTSSF_1', name: 'Unshaped' }],
};

describe('ATT-1 — attach resolves the repo, board and lane vocabulary', () => {
  it('resolves the repo, board and lane vocabulary for a github project note', async () => {
    const port = new FakePort();
    port.result = identity;
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/1',
    };

    const result = await action.execute(data);

    expect(port.calls).toEqual([data]);
    expect(result).toBe(identity);
    expect(result?.repoUrl).toBe('https://github.com/acme/widgets');
    expect(result?.statusOptions).toEqual([
      { id: 'PVTSSF_1', name: 'Unshaped' },
    ]);
  });

  it('returns null for a non-github provider without calling the port', async () => {
    const port = new FakePort();
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'linear',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://linear.app/acme/project/1',
    };

    const result = await action.execute(data);

    expect(result).toBeNull();
    expect(port.calls).toEqual([]);
  });

  it('throws a domain error when a github note is missing its board url', async () => {
    const port = new FakePort();
    const action = new AttachProjectAction(port);
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: '',
    };

    await expect(action.execute(data)).rejects.toThrow(/boardUrl/);
    expect(port.calls).toEqual([]);
  });
});
