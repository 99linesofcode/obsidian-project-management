import { describe, expect, it } from 'vitest';
import { SeedTypeLabelsAction } from '../../src/app/SeedTypeLabelsAction.js';
import type { ProjectManagementPort } from '../../src/shared/ProjectManagementPort.js';

// A fake port at the boundary: serves the repository's existing labels and
// records the creates, so the seed action's skip logic is what's under test.
class FakePort implements ProjectManagementPort {
  existing: string[] = [];
  listCalls: string[] = [];
  createCalls: Array<{ repoUrl: string; name: string; color: string }> = [];

  async listRepoLabels(repoUrl: string): Promise<string[]> {
    this.listCalls.push(repoUrl);
    return this.existing;
  }
  async createRepoLabel(
    repoUrl: string,
    name: string,
    color: string,
  ): Promise<void> {
    this.createCalls.push({ repoUrl, name, color });
  }
  async fetchRepoBoards(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createBoardWithStatusField(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectIdentity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProject(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchViewerProjects(): Promise<never> {
    throw new Error('not used in this test');
  }
  async adoptBoard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createIssue(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectDetail(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchTrackedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchLatestIssueActivity(): Promise<never> {
    throw new Error('not used in this test');
  }
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchUnpromotedIssues(): Promise<never> {
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
  async deleteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
  async addLabel(): Promise<never> {
    throw new Error('not used in this test');
  }
  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const labels = ['type: bug', 'type: task'];

describe('SEED — the type-label vocabulary is applied to a repository', () => {
  it('creates the missing labels and skips the existing ones', async () => {
    const port = new FakePort();
    port.existing = ['type: task'];
    const action = new SeedTypeLabelsAction(port);

    await action.execute('acme/widgets', labels);

    // The provider expands the shorthand at the boundary; the action passes it
    // through unchanged.
    expect(port.listCalls).toEqual(['acme/widgets']);
    expect(port.createCalls).toEqual([
      {
        repoUrl: 'acme/widgets',
        name: 'type: bug',
        color: 'ededed',
      },
    ]);
  });

  it('accepts a full repository url unchanged', async () => {
    const port = new FakePort();
    const action = new SeedTypeLabelsAction(port);

    await action.execute('https://github.com/acme/widgets', labels);

    expect(port.listCalls).toEqual(['https://github.com/acme/widgets']);
    expect(port.createCalls.map((call) => call.name)).toEqual(labels);
  });

  it('does nothing for an empty repository input', async () => {
    const port = new FakePort();
    const action = new SeedTypeLabelsAction(port);

    await action.execute('   ', labels);

    expect(port.listCalls).toEqual([]);
    expect(port.createCalls).toEqual([]);
  });
});
